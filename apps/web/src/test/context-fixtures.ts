import type { RunContextRecord } from "@/lib/api-types";
import { LOADOUT, RUN, TASK } from "@/test/execution-fixtures";
import { ACTIVE_ITEM, PENDING_DECISION, SUMMARY_ITEM } from "@/test/knowledge-fixtures";
import { PROJECT_ID } from "@/test/proposal-fixtures";

/**
 * O registro do Context Engine para os testes de componente (Fase 7C).
 *
 * Cinco seções com item (o resumo, uma Página cortada, a Missão mãe, um
 * artefato e uma skill), uma Página excluída por orçamento; o texto traz as
 * tags XML do bloco e um `<script>` de propósito: a tela tem de renderizar
 * isso como texto. Os títulos de seção são neutros de propósito: a varredura
 * de `labels.test.ts` lê este arquivo, e o título real vem do backend.
 */

const NOW = "2026-09-08T14:00:00.000Z";

export const PARENT_TASK_ID = "0199eeee-0000-7000-8000-000000000009";
export const PRIOR_RUN_ID = "01990000-0000-7000-8000-000000000009";
export const EXCLUDED_ITEM_ID = "0199f7f7-0000-7000-8000-000000000077";

export const RUN_CONTEXT: RunContextRecord = {
  runId: RUN.id,
  taskId: TASK.id,
  projectId: PROJECT_ID,
  status: "ASSEMBLED",
  text: [
    "<context>",
    "<summary>",
    "Uma masmorra que alaga, um portão que abre com ritmo. <script>alert(1)</script>",
    "</summary>",
    "<knowledge>",
    `<knowledge-item id="${ACTIVE_ITEM.id}" type="PROCEDURE">Três batidas… […]</knowledge-item>`,
    "</knowledge>",
    "</context>",
  ].join("\n"),
  query: "sala & norte",
  sections: [
    {
      kind: "SUMMARY",
      title: "Resumo",
      items: [
        {
          id: SUMMARY_ITEM.id,
          kind: "KNOWLEDGE_ITEM",
          title: SUMMARY_ITEM.title,
          reason: "PROJECT_SUMMARY",
          score: null,
          tokens: 240,
          truncated: false,
        },
      ],
      tokens: 240,
      budgetTokens: 2000,
      truncated: false,
    },
    {
      kind: "KNOWLEDGE",
      title: "Relevantes",
      items: [
        {
          id: ACTIVE_ITEM.id,
          kind: "KNOWLEDGE_ITEM",
          title: ACTIVE_ITEM.title,
          reason: "FTS_MATCH",
          score: 0.4256,
          tokens: 1500,
          truncated: true,
        },
      ],
      tokens: 1500,
      budgetTokens: 1700,
      truncated: true,
    },
    {
      kind: "LINEAGE",
      title: "Linhagem",
      items: [
        {
          id: PARENT_TASK_ID,
          kind: "TASK",
          title: "Mapear a masmorra inteira",
          reason: "PARENT_TASK",
          score: null,
          tokens: 90,
          truncated: false,
        },
      ],
      tokens: 90,
      budgetTokens: 700,
      truncated: false,
    },
    {
      kind: "ARTIFACTS",
      title: "Anteriores",
      items: [
        {
          id: `${PRIOR_RUN_ID}:0`,
          kind: "ARTIFACT",
          title: "docs/mapa.md",
          reason: "PRIOR_RUN_ARTIFACT",
          score: null,
          tokens: 40,
          truncated: false,
        },
      ],
      tokens: 40,
      budgetTokens: 300,
      truncated: false,
    },
    {
      kind: "SKILLS",
      title: "Do equipamento",
      items: [
        {
          id: "Testes de plataforma",
          kind: "SKILL",
          title: "Testes de plataforma",
          reason: "LOADOUT_SKILL",
          score: null,
          tokens: 12,
          truncated: false,
        },
      ],
      tokens: 12,
      budgetTokens: 170,
      truncated: false,
    },
  ],
  excluded: [
    {
      section: "KNOWLEDGE",
      item: {
        id: EXCLUDED_ITEM_ID,
        kind: "KNOWLEDGE_ITEM",
        title: PENDING_DECISION.title,
        reason: "FTS_MATCH",
        score: 0.12,
        tokens: 800,
        truncated: false,
      },
      reason: "SECTION_BUDGET",
    },
  ],
  budget: {
    totalTokens: 6000,
    frameTokens: 130,
    summaryMinTokens: 300,
    sections: {
      SUMMARY: 2000,
      DECISIONS: 880,
      KNOWLEDGE: 1700,
      LINEAGE: 700,
      ARTIFACTS: 300,
      SKILLS: 170,
    },
  },
  usage: { estimatedTokens: 2012, itemCount: 5, excludedCount: 1 },
  policy: {
    enabled: true,
    budgetTokens: 6000,
    maxKnowledgeItems: 8,
    maxDecisions: 5,
    maxArtifacts: 10,
    includeProjectSummary: true,
    includeDecisions: true,
    includeParentContext: true,
    includeDependencyContext: true,
    source: {
      loadout: {
        id: LOADOUT.id,
        version: LOADOUT.version,
        knowledgePolicy: LOADOUT.knowledgePolicy,
        contextPolicy: LOADOUT.contextPolicy,
      },
      settings: {
        enabled: true,
        budgetTokens: 6000,
        maxKnowledgeItems: 8,
        maxDecisions: 5,
        maxArtifacts: 10,
      },
    },
  },
  inheritedFromRunId: null,
  error: null,
  assembledAt: NOW,
  createdAt: NOW,
};

export const EMPTY_CONTEXT: RunContextRecord = {
  ...RUN_CONTEXT,
  status: "EMPTY",
  text: "",
  query: null,
  sections: [],
  excluded: [],
  usage: { estimatedTokens: 0, itemCount: 0, excludedCount: 0 },
};

export const DISABLED_CONTEXT: RunContextRecord = {
  ...EMPTY_CONTEXT,
  status: "DISABLED",
  policy: {
    ...RUN_CONTEXT.policy,
    enabled: false,
    source: {
      ...RUN_CONTEXT.policy.source,
      settings: { ...RUN_CONTEXT.policy.source.settings, enabled: false },
    },
  },
};

export const FAILED_CONTEXT: RunContextRecord = {
  ...EMPTY_CONTEXT,
  status: "FAILED",
  error: 'A busca textual falhou: relation "knowledge_item" does not exist <b>x</b>',
};

export const INHERITED_CONTEXT: RunContextRecord = {
  ...RUN_CONTEXT,
  inheritedFromRunId: PRIOR_RUN_ID,
};

/** Uma resposta `404` do cliente gerado: o Run ainda não tem contexto. */
export function notFound() {
  return {
    data: undefined,
    error: {
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "Não existe Run com este id, ou ele ainda não tem contexto montado.",
      instance: `/api/v1/runs/${RUN.id}/context`,
    },
    response: new Response(null, { status: 404 }),
  };
}
