// Adapted from TencentDB Agent Memory — MemoryCore/src/core/prompts/scene-extraction.ts@3efcd31
// (o papel do "arquiteto de consolidação": camadas, narrativa em vez de lista,
// integrar em vez de anexar, reescrever) e
// MemoryCore/src/offload_server/prompts/l2-prompt.ts@3efcd31, linhas 9–18
// (os guardrails: agregar, lápide para o que não deu certo, resumo orientado a
// conclusão, só o que aconteceu, tudo com fonte).
// Copyright (c) 2026 Tencent. Licensed under the MIT License.
// Changes: os arquivos de cena e as ferramentas `read`/`write`/`edit` saíram —
// aqui o modelo não toca disco e devolve um único documento como JSON; os
// "scene blocks" viraram os itens ativos do Grimório e o "persona.md" virou o
// Project Summary corrente; o limite de cenas virou o teto de tamanho do
// resumo; os guardrails do L2 (que eram sobre um diagrama Mermaid) viraram
// regras sobre o que o resumo não pode fazer ao consolidar páginas. Prompt
// reescrito em português.

import { z } from "zod";

import { escapeXmlTags } from "../sanitize.js";
import type { ExistingKnowledgeItem, ProjectContext } from "../types.js";
import { itemKey } from "./dedup-judge.js";

export const SUMMARY_TITLE_MAX_LENGTH = 200;
export const SUMMARY_CONTENT_MAX_LENGTH = 12_000;

export const ProjectSummaryOutputSchema = z.object({
  title: z.string().describe("Título do resumo. Curto."),
  content: z.string().describe("O resumo, em Markdown, com as seções pedidas."),
  coveredItems: z
    .array(z.string())
    .describe("As chaves (K1, K2, ...) dos itens que o resumo consolidou."),
});

export type ProjectSummaryOutput = z.infer<typeof ProjectSummaryOutputSchema>;

/**
 * O papel e os guardrails da consolidação.
 *
 * Os guardrails vêm do L2 do TencentDB, adaptados: lá o modelo desenhava um
 * grafo do que já aconteceu; aqui ele escreve o estado atual do Project a
 * partir de páginas revisadas. O que não muda é o que ele não pode fazer:
 * inventar, planejar o futuro, apagar o que não deu certo, perder a fonte.
 */
export const PROJECT_SUMMARY_SYSTEM_PROMPT = `Você é o Escriba do Grimório: quem escreve o resumo corrente de um projeto de software a partir das páginas que o Grimório já tem.

Você NÃO tem tarefa de código. Não leia arquivos, não rode comandos, não use ferramenta nenhuma: tudo o que você precisa está neste prompt. Responda só com o JSON pedido no fim.

## O que o resumo é

Um documento narrativo — não uma lista de páginas — que diz, para quem vai trabalhar no projeto amanhã: o que ele é, como está organizado, o que foi decidido e por quê, o que se sabe que quebra, e como se faz as coisas aqui. As páginas são a matéria-prima; o resumo é a síntese.

## Guardrails (o que você não pode fazer ao consolidar)

1. Só o que as páginas dizem. Nada de inferir, extrapolar ou completar com o que "provavelmente" é assim. Uma afirmação sem página de origem não entra.
2. Só o que aconteceu. Nada de próximos passos, planos ou recomendações: o resumo registra o estado, não o futuro.
3. Agregue, não liste. Páginas que falam da mesma coisa viram um parágrafo; não repita o Grimório página por página.
4. Lápide para o que não deu certo. Uma DISCOVERY sobre uma armadilha ou uma decisão que foi revertida continua no resumo, marcada como tal: é o que impede o próximo agente de cair no mesmo buraco.
5. Conclusão, não cronologia. Cada parágrafo diz o que é verdade agora e o que se concluiu, não a ordem em que as coisas foram descobertas.
6. Integre, não anexe. Quando há um resumo anterior, reescreva-o com as páginas novas dentro; não cole um "Atualização:" no fim.
7. Toda página citada é uma página listada. As chaves em "coveredItems" precisam existir na lista recebida.
8. Tamanho: até ${String(SUMMARY_CONTENT_MAX_LENGTH)} caracteres. Menos é melhor.

## Estrutura do conteúdo (Markdown)

- **Visão**: o que o projeto é, em um parágrafo.
- **Arquitetura e convenções**: como está organizado e as regras que o projeto impõe (FACT, CONSTRAINT).
- **Decisões**: o que foi escolhido e por quê (DECISION). Uma decisão revertida aparece como revertida.
- **Armadilhas conhecidas**: o que quebra e como contornar (DISCOVERY).
- **Como fazer**: os procedimentos que existem (PROCEDURE).

Omita uma seção que ficaria vazia.

## Saída

{
  "title": "Resumo do projeto <nome>",
  "content": "o documento em Markdown",
  "coveredItems": ["K1", "K2"]
}`;

export interface ProjectSummaryPromptInput {
  readonly project: ProjectContext;
  readonly currentSummary: ExistingKnowledgeItem | null;
  readonly items: readonly ExistingKnowledgeItem[];
}

export interface ProjectSummaryPrompt {
  readonly prompt: string;
  readonly itemIdByKey: ReadonlyMap<string, string>;
}

export function buildProjectSummaryPrompt(input: ProjectSummaryPromptInput): ProjectSummaryPrompt {
  const itemIdByKey = new Map<string, string>();

  const paginas = input.items.map((item, index) => {
    const key = itemKey(index);
    itemIdByKey.set(key, item.id);
    return `[${key}] (${item.type}) ${escapeXmlTags(item.title)}\n${escapeXmlTags(item.content)}`;
  });

  const projeto = [
    `## Project`,
    `Título: ${input.project.title}`,
    ...(input.project.description === null || input.project.description.trim().length === 0
      ? []
      : [`Descrição: ${input.project.description.trim()}`]),
  ].join("\n");

  const anterior =
    input.currentSummary === null
      ? "## Resumo anterior\n\n(nenhum: este é o primeiro)"
      : `## Resumo anterior\n\n<project-summary>\n${escapeXmlTags(input.currentSummary.content)}\n</project-summary>`;

  const prompt = [
    PROJECT_SUMMARY_SYSTEM_PROMPT,
    "",
    "---",
    "",
    projeto,
    "",
    anterior,
    "",
    `## Páginas ativas do Grimório (${String(paginas.length)})`,
    "",
    "<knowledge>",
    paginas.join("\n\n"),
    "</knowledge>",
    "",
    "Escreva o resumo corrente e responda com o JSON.",
  ].join("\n");

  return { prompt, itemIdByKey };
}
