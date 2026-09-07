// Adapted from Sandcastle — src/extractStructuredOutput.ts@e99f832 e
// src/run.ts@e99f832 (buildStructuredOutputRetryFeedback)
// Copyright (c) 2026 Matt Pocock. Licensed under the MIT License.
// Changes: a extração deixou de lançar `StructuredOutputError` e passou a
// devolver um resultado discriminado, porque o runtime nunca lança para o
// consumidor — toda falha vira evento. A validação passou a aceitar qualquer
// Standard Schema pela interface mínima declarada em `standard-schema.ts`, sem
// depender de `@standard-schema/spec`. Acrescentada a montagem da instrução do
// prompt, que no Sandcastle é responsabilidade de quem chama (`run()` só
// verifica se a tag aparece no prompt). O contexto de commits, branch e
// worktree saiu: aqui isso vive no evento, não no erro. Textos em português.

/**
 * Resultado estruturado: o bloco `<result>` no texto do agente.
 *
 * O formato é o do Sandcastle porque os três harnesses já são treinados nele
 * pelo ecossistema, e porque um bloco XML no meio do texto sobrevive a
 * qualquer CLI — inclusive às que não têm structured output nativo (documento
 * técnico, seção 30).
 *
 * Duas regras que parecem detalhe e não são:
 *
 * **A última ocorrência vence.** Um agente que erra o schema, percebe e emite
 * o bloco de novo é o caso comum; pegar o primeiro bloco escolheria justamente
 * a versão errada.
 *
 * **A extração conhece cerca de código.** Modelos envolvem JSON em ```json com
 * frequência, e um `JSON.parse` na cerca falha por um motivo que não tem nada a
 * ver com o schema.
 */

import { formatIssues, isStandardSchema, type StandardSchemaIssue } from "./standard-schema.js";
import type { StructuredOutputSpec } from "./execution-request.js";
import { DEFAULT_OUTPUT_TAG } from "./execution-request.js";

export type StructuredOutputFailureReason = "TAG_NOT_FOUND" | "INVALID_JSON" | "SCHEMA_VALIDATION";

export type StructuredOutputResult<T> =
  | { readonly ok: true; readonly value: T; readonly raw: string }
  | {
      readonly ok: false;
      readonly reason: StructuredOutputFailureReason;
      readonly message: string;
      /** O conteúdo bruto encontrado na tag, quando a tag existia. */
      readonly raw?: string;
      readonly issues?: readonly StandardSchemaIssue[];
    };

/**
 * A instrução acrescentada ao prompt.
 *
 * Precisa ser explícita quanto a três coisas que os modelos erram: a tag exata,
 * JSON puro sem cerca, e o bloco por último. A frase sobre reemitir existe
 * porque é o comportamento que a extração "última ocorrência vence" premia.
 */
export function buildStructuredOutputInstruction(tag: string = DEFAULT_OUTPUT_TAG): string {
  return [
    "",
    "---",
    "",
    `Ao terminar, emita o resultado final dentro de um bloco <${tag}>...</${tag}>.`,
    "",
    `- O conteúdo do bloco precisa ser um único objeto JSON válido, sem cerca de código e sem texto ao redor.`,
    `- O bloco é a última coisa da sua resposta.`,
    `- Se precisar corrigir o bloco, emita um novo <${tag}> depois; o último vale.`,
  ].join("\n");
}

/** O prompt com a instrução, quando há schema. Idempotente se a tag já aparece. */
export function applyStructuredOutputInstruction(
  prompt: string,
  spec: StructuredOutputSpec | undefined,
): string {
  if (spec === undefined) return prompt;
  const tag = spec.tag ?? DEFAULT_OUTPUT_TAG;
  if (prompt.includes(`<${tag}>`)) return prompt;
  return prompt + (spec.instruction ?? buildStructuredOutputInstruction(tag));
}

/**
 * O prompt da única retentativa.
 *
 * Curto de propósito: o agente já fez o trabalho na sessão que está sendo
 * retomada, e a única coisa pedida é o bloco corrigido. Mandar de volta o
 * prompt original gastaria tokens e convidaria o agente a refazer as ações.
 */
export function buildStructuredOutputRetryPrompt(
  failure: Extract<StructuredOutputResult<unknown>, { ok: false }>,
  tag: string = DEFAULT_OUTPUT_TAG,
): string {
  const raw = failure.raw === undefined ? "(nenhum bloco correspondente foi emitido)" : failure.raw;
  const detail =
    failure.issues === undefined
      ? failure.message
      : `${failure.message}\n${formatIssues(failure.issues)}`;

  return [
    "Sua resposta anterior não produziu um resultado estruturado válido.",
    "",
    "Problema:",
    detail,
    "",
    "Bloco recebido:",
    raw,
    "",
    `Emita apenas um bloco <${tag}>...</${tag}> corrigido, com JSON válido. Não altere arquivos nem execute comandos.`,
  ].join("\n");
}

/** Extrai e valida o bloco. Nunca lança por conteúdo; só por spec inválida. */
export async function extractStructuredOutput<T>(
  text: string,
  spec: StructuredOutputSpec<T>,
): Promise<StructuredOutputResult<T>> {
  const tag = spec.tag ?? DEFAULT_OUTPUT_TAG;

  if (!isStandardSchema(spec.schema)) {
    throw new TypeError(
      "outputSchema.schema precisa implementar Standard Schema (`~standard`). Zod, Valibot e ArkType implementam.",
    );
  }

  const raw = findLastTagContent(text, tag);
  if (raw === undefined) {
    return {
      ok: false,
      reason: "TAG_NOT_FOUND",
      message: `O bloco <${tag}> não apareceu na saída do agente.`,
    };
  }

  const unwrapped = unwrapFences(raw.trim());

  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapped);
  } catch (cause) {
    return {
      ok: false,
      reason: "INVALID_JSON",
      message: `O conteúdo de <${tag}> não é JSON válido: ${cause instanceof Error ? cause.message : String(cause)}`,
      raw,
    };
  }

  const result = await spec.schema["~standard"].validate(parsed);

  if (result.issues !== undefined) {
    return {
      ok: false,
      reason: "SCHEMA_VALIDATION",
      message: `O conteúdo de <${tag}> não bateu com o schema.`,
      raw,
      issues: result.issues,
    };
  }

  return { ok: true, value: result.value, raw };
}

/**
 * O conteúdo entre o **último** par `<tag>` e `</tag>`.
 *
 * Varredura por índice, não por regex: uma expressão gulosa sobre 64 KB de
 * saída com muitas tags aninhadas tem custo quadrático, e o texto aqui é
 * exatamente isso.
 */
export function findLastTagContent(text: string, tag: string): string | undefined {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;

  let lastContent: string | undefined;
  let searchFrom = 0;

  for (;;) {
    const openIdx = text.indexOf(openTag, searchFrom);
    if (openIdx === -1) break;

    const contentStart = openIdx + openTag.length;
    const closeIdx = text.indexOf(closeTag, contentStart);
    if (closeIdx === -1) break;

    lastContent = text.slice(contentStart, closeIdx);
    searchFrom = closeIdx + closeTag.length;
  }

  return lastContent;
}

/** Tira a cerca de código, quando houver. Devolve o texto intacto quando não. */
export function unwrapFences(text: string): string {
  const fenceMatch = /^```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(text);
  if (fenceMatch?.[1] !== undefined) {
    return fenceMatch[1].trim();
  }
  return text;
}
