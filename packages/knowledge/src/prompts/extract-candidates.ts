// Adapted from TencentDB Agent Memory — MemoryCore/src/core/prompts/l1-extraction.ts@3efcd31
// Copyright (c) 2026 Tencent. Licensed under the MIT License.
// Changes: a estrutura do prompt de extração — princípios gerais (antes
// nenhum que ruim; independente do contexto; mesclar o que é uma coisa só),
// um bloco por tipo com definição e "o que não extrair", a saída como JSON
// estrito com `source_message_ids` — é do original. A "segmentação de
// situação" e a camada de persona saíram; os tipos `persona`/`episodic`/
// `instruction` e os de trabalho viraram os seis fechados da Fase 6 (`FACT`,
// `DECISION`, `DISCOVERY`, `CONSTRAINT`, `PROCEDURE`, `SUMMARY`); a entrada
// deixou de ser uma conversa e virou os candidatos que os agentes já
// escreveram, mais o L0 do Run como contexto de leitura; e o julgamento de
// duplicata do `l1-dedup.ts` entra no mesmo prompt, porque aqui é uma
// chamada por lote. Prompt reescrito em português.

import { escapeXmlTags } from "@dungeon-master/context";
import { z } from "zod";

import type { DistillCandidate, ProjectContext, RunTranscript } from "../types.js";
import {
  candidateKey,
  type CandidatePool,
  DEDUP_JUDGE_RULES,
  formatCandidatePools,
} from "./dedup-judge.js";

/** Os tipos que um candidato pode virar. `SUMMARY` é só do resumo do Project. */
export const DISTILL_ITEM_TYPES = [
  "FACT",
  "DECISION",
  "DISCOVERY",
  "CONSTRAINT",
  "PROCEDURE",
] as const;

export const DISTILL_TITLE_MAX_LENGTH = 200;
export const DISTILL_CONTENT_MAX_LENGTH = 4_000;
export const DISTILL_REASON_MAX_LENGTH = 500;

/** Uma decisão do modelo, como chega na resposta. Tolerante: o fail-open é de quem lê. */
export const DistillDecisionOutputSchema = z.object({
  candidate: z.string().describe("A chave curta do candidato: C1, C2, ..."),
  decision: z.enum(["PROMOTE", "REJECT", "MERGE"]),
  type: z.enum(DISTILL_ITEM_TYPES).optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  mergeInto: z
    .string()
    .optional()
    .describe(
      "Em MERGE: a chave do item (K1...) ou do candidato anterior (C1...) que absorve este.",
    ),
  reason: z.string().optional(),
});

export type DistillDecisionOutput = z.infer<typeof DistillDecisionOutputSchema>;

export const DistillOutputSchema = z.object({
  decisions: z.array(DistillDecisionOutputSchema),
});

export type DistillOutput = z.infer<typeof DistillOutputSchema>;

/**
 * O papel e as regras. O que **não** fazer vem antes do que fazer, porque é
 * onde um modelo com ferramentas erra: ele tende a sair lendo o repositório.
 */
export const DISTILL_SYSTEM_PROMPT = `Você é o Escriba do Grimório de um projeto de software: quem transforma o que os agentes aprenderam em páginas que o próximo agente vai ler.

Você NÃO tem tarefa de código. Não leia arquivos, não rode comandos, não use ferramenta nenhuma: tudo o que você precisa está neste prompt. Responda só com o JSON pedido no fim.

## Princípios

1. Antes nenhum que ruim. Só vira página o que continua verdadeiro fora do Run em que nasceu: uma convenção do projeto, uma armadilha, um comando que funciona, uma decisão tomada. Passo de uma execução, conversa, opinião sem fato e "o que eu fiz" não viram página.
2. Independente do contexto. Reescreva o título e o conteúdo para serem entendidos por alguém que não viu o Run: nada de "isso", "aquele arquivo", "como discutido". Nomeie arquivos, comandos, módulos e valores.
3. Uma coisa só. Dois candidatos que descrevem o mesmo fato viram uma página (veja as regras de duplicata). Um candidato que junta dois fatos independentes continua uma página: não fragmente.
4. Fiel à fonte. Não invente detalhe que o candidato e o contexto não trazem. Na dúvida, mantenha o texto do candidato e classifique.

## Os tipos

- FACT: um fato estável do projeto. "O serviço de pagamentos escuta na porta 8081 em desenvolvimento."
- DECISION: uma escolha tomada, com o porquê quando houver. "Optamos por Drizzle em vez de Prisma porque as migrações são SQL versionado."
- DISCOVERY: uma armadilha ou um comportamento surpreendente, encontrado ao trabalhar. "O Vite morre com exit 0xC0000409 nesta máquina; reexecute antes de suspeitar de regressão."
- CONSTRAINT: uma regra que o projeto impõe. "Toda tabela nasce escopada por user_id."
- PROCEDURE: como fazer algo, em passos. "Para gerar uma migração: edite o schema, rode pnpm db:generate, depois pnpm db:migrate."

Um candidato com kind "decision" é quase sempre DECISION. Os demais kinds ("gotcha", "howto", "convention") são dicas, não ordens.

${DEDUP_JUDGE_RULES}

## Saída

Responda com um único objeto JSON:

{
  "decisions": [
    {
      "candidate": "C1",
      "decision": "PROMOTE" | "REJECT" | "MERGE",
      "type": "FACT" | "DECISION" | "DISCOVERY" | "CONSTRAINT" | "PROCEDURE",
      "title": "título reescrito, curto",
      "content": "conteúdo reescrito, completo, sem depender do Run",
      "mergeInto": "K1",
      "reason": "por quê, em uma linha"
    }
  ]
}

- "type", "title" e "content" são obrigatórios em PROMOTE.
- "mergeInto" é obrigatório em MERGE.
- "reason" é sempre bem-vindo.
- Uma entrada por candidato, na ordem em que eles aparecem. Nenhum candidato fica sem decisão.`;

export interface DistillPromptInput {
  readonly project: ProjectContext;
  readonly pools: readonly CandidatePool<DistillCandidate>[];
  /** O L0 dos Runs, já filtrado do ruído e com teto. Por `runId`. */
  readonly transcripts: ReadonlyMap<string, RunTranscript>;
}

export interface DistillPrompt {
  readonly prompt: string;
  /** Chave curta → id do item do Grimório. */
  readonly itemIdByKey: ReadonlyMap<string, string>;
  /** Chave curta → id do candidato. */
  readonly candidateIdByKey: ReadonlyMap<string, string>;
}

/**
 * O texto de um Run, escapado antes de entrar no prompt.
 *
 * O que o agente escreveu é texto de modelo, e o prompt do Escriba o delimita
 * com `<run-log>`: um `</run-log>` no meio do texto sairia da seção e viraria
 * instrução. O mesmo vale para os candidatos e para os itens do pool, que são
 * a única reinjeção de texto do Grimório num prompt nesta fase — no prompt
 * do próprio Escriba, para julgar duplicata, nunca no de um Run.
 */
function formatTranscript(transcript: RunTranscript | undefined): string {
  if (transcript === undefined) return "";
  const partes: string[] = [];
  if (transcript.summary !== null && transcript.summary.trim().length > 0) {
    partes.push(`Resumo do agente: ${escapeXmlTags(transcript.summary.trim())}`);
  }
  if (transcript.transcript.trim().length > 0) {
    partes.push(`Trecho do Run:\n${escapeXmlTags(transcript.transcript.trim())}`);
  }
  return partes.join("\n");
}

/**
 * O prompt de um lote: o Project, o pool de itens parecidos, e cada
 * candidato com os itens relacionados e o contexto do Run de origem.
 */
export function buildDistillPrompt(input: DistillPromptInput): DistillPrompt {
  const { poolSection, itemIdByKey, keyByItemId } = formatCandidatePools(input.pools);
  const candidateIdByKey = new Map<string, string>();

  const blocos = input.pools.map((pool, index) => {
    const key = candidateKey(index);
    candidateIdByKey.set(key, pool.candidate.id);

    const relacionados = pool.related
      .map((item) => keyByItemId.get(item.id))
      .filter((k): k is string => k !== undefined);

    const contexto = formatTranscript(input.transcripts.get(pool.candidate.runId));

    return [
      `### ${key}`,
      `kind: ${pool.candidate.kind ?? "(sem kind)"}`,
      `Título: ${escapeXmlTags(pool.candidate.title)}`,
      `Conteúdo: ${escapeXmlTags(pool.candidate.content)}`,
      `Itens relacionados: ${relacionados.length === 0 ? "(nenhum)" : relacionados.join(", ")}`,
      ...(contexto.length === 0
        ? []
        : [`<run-log run="${pool.candidate.runId}">`, contexto, "</run-log>"]),
    ].join("\n");
  });

  const projeto = [
    `## Project`,
    `Título: ${input.project.title}`,
    ...(input.project.description === null || input.project.description.trim().length === 0
      ? []
      : [`Descrição: ${input.project.description.trim()}`]),
  ].join("\n");

  const prompt = [
    DISTILL_SYSTEM_PROMPT,
    "",
    "---",
    "",
    projeto,
    "",
    poolSection,
    "",
    `## Candidatos (${String(input.pools.length)})`,
    "",
    "<candidates>",
    blocos.join("\n\n"),
    "</candidates>",
    "",
    "Julgue cada candidato e responda com o JSON.",
  ].join("\n");

  return { prompt, itemIdByKey, candidateIdByKey };
}
