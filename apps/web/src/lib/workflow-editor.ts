import type { ValidationIssue } from "@dungeon-master/contracts";
import { parse as parseYaml, stringify as stringifyYaml, YAMLParseError } from "yaml";

import type { WorkflowDefinitionBody } from "@/lib/api-types";

/**
 * O editor de texto de um Workflow (Fase 4C).
 *
 * Não há editor visual (fora de escopo por padrão, CLAUDE.md seção 12): a
 * definição é escrita em JSON ou YAML e a API só recebe JSON, então a
 * conversão acontece aqui, no cliente, antes do corpo sair. Este módulo é
 * puro — sem React, sem rede — para o teste provar a conversão e o mapeamento
 * dos erros de `422` sem montar nada.
 */

export const DEFINITION_FORMATS = ["yaml", "json"] as const;

export type DefinitionFormat = (typeof DEFINITION_FORMATS)[number];

export type ParseOutcome =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string };

/**
 * Lê o texto no formato pedido.
 *
 * YAML é um superconjunto de JSON, mas JSON é lido pelo `JSON.parse` de
 * propósito: a mensagem de erro dele aponta a posição no texto do jeito que
 * quem escreveu JSON espera, e um `{` sem fechar não vira um documento YAML
 * válido por acidente.
 */
export function parseDefinitionText(text: string, format: DefinitionFormat): ParseOutcome {
  if (text.trim() === "") return { ok: false, message: "A definição está vazia." };

  try {
    const value: unknown = format === "json" ? JSON.parse(text) : parseYaml(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, message: "A definição precisa ser um objeto com `name` e `steps`." };
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, message: describeParseError(error, format) };
  }
}

function describeParseError(error: unknown, format: DefinitionFormat): string {
  if (error instanceof YAMLParseError) {
    const at = error.linePos?.[0];
    const where = at === undefined ? "" : ` (linha ${String(at.line)}, coluna ${String(at.col)})`;
    return `YAML inválido${where}: ${error.message.split("\n")[0] ?? ""}`;
  }
  if (error instanceof SyntaxError) {
    return `${format === "json" ? "JSON" : "YAML"} inválido: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * O que a API recebe: o objeto lido, com a forma mínima conferida.
 *
 * A validação inteira é do schema Zod do servidor, que devolve `errors[]` com
 * step e campo. Aqui só se garante que existe um `name` e um array de `steps`,
 * porque sem isso o mapeamento dos issues não teria onde procurar a chave do
 * step.
 */
export function toDefinitionBody(value: unknown): WorkflowDefinitionBody | null {
  if (typeof value !== "object" || value === null) return null;
  const fields = value as Record<string, unknown>;
  if (typeof fields["name"] !== "string" || !Array.isArray(fields["steps"])) return null;
  return value as WorkflowDefinitionBody;
}

/** A definição como texto, no formato pedido. */
export function stringifyDefinition(value: unknown, format: DefinitionFormat): string {
  return format === "json"
    ? `${JSON.stringify(value, null, 2)}\n`
    : stringifyYaml(value, { lineWidth: 0 });
}

/**
 * Converte o texto de um formato para o outro, ou devolve `null` se o texto
 * atual não for legível — aí o editor troca o formato e mantém o texto como
 * está, em vez de apagar o que o usuário escreveu.
 */
export function convertDefinitionText(
  text: string,
  from: DefinitionFormat,
  to: DefinitionFormat,
): string | null {
  if (from === to) return text;
  const parsed = parseDefinitionText(text, from);
  return parsed.ok ? stringifyDefinition(parsed.value, to) : null;
}

/** Um issue do `422`, já ligado ao step que ele aponta. */
export interface DefinitionIssue {
  /** Índice em `steps`, ou `null` quando o issue é da raiz. */
  readonly stepIndex: number | null;
  /** A chave do step, quando o texto tem uma. */
  readonly stepKey: string | null;
  /** O caminho do campo dentro do step (`dependsOn.0`), ou da raiz (`name`). */
  readonly field: string;
  readonly message: string;
}

/**
 * Liga cada issue de `errors[]` ao step que ele aponta.
 *
 * O caminho vem em notação de ponto — `steps.2.dependsOn.0` — e o número
 * depois de `steps` é o índice; a chave sai do próprio documento que o
 * usuário escreveu, para a mensagem dizer "o step `execute`" e não "o step 3".
 */
export function mapDefinitionIssues(
  issues: readonly ValidationIssue[],
  value: unknown,
): readonly DefinitionIssue[] {
  const steps = readSteps(value);

  return issues.map((issue) => {
    const segments = issue.path === "" ? [] : issue.path.split(".");
    if (segments[0] !== "steps" || segments[1] === undefined || !/^\d+$/.test(segments[1])) {
      return { stepIndex: null, stepKey: null, field: issue.path, message: issue.message };
    }

    const stepIndex = Number(segments[1]);
    const step = steps[stepIndex];
    const key = typeof step?.["key"] === "string" ? step["key"] : null;
    return {
      stepIndex,
      stepKey: key,
      field: segments.slice(2).join("."),
      message: issue.message,
    };
  });
}

function readSteps(value: unknown): readonly Record<string, unknown>[] {
  if (typeof value !== "object" || value === null) return [];
  const steps = (value as Record<string, unknown>)["steps"];
  if (!Array.isArray(steps)) return [];
  return steps.map((step) =>
    typeof step === "object" && step !== null ? (step as Record<string, unknown>) : {},
  );
}

/**
 * Onde o issue aponta, em uma linha: `execute · dependsOn.0` ou `steps.3`.
 *
 * Separado da mensagem porque a tela desenha os dois com pesos diferentes.
 */
export function describeIssueLocation(issue: DefinitionIssue): string {
  if (issue.stepIndex === null) return issue.field === "" ? "definição" : issue.field;
  const step = issue.stepKey ?? `steps.${String(issue.stepIndex)}`;
  return issue.field === "" ? step : `${step} · ${issue.field}`;
}
