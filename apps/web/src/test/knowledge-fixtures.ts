import type {
  DistillationRunRecord,
  ForgedAchievementRecord,
  KnowledgeCandidateRecord,
  KnowledgeItemRecord,
  ProjectSummaryRecord,
} from "@/lib/api-types";
import { RUN, TASK } from "@/test/execution-fixtures";
import { PROJECT_ID } from "@/test/proposal-fixtures";

/**
 * Registros do Grimório e da forja para os testes de componente (Fase 6B).
 *
 * Um item em revisão vindo de uma Expedição, com um candidato fundido; um
 * item ativo; o resumo corrente; um lote encerrado; e uma forjada na forja.
 * O conteúdo traz quebras de linha e um `<script>` de propósito: a tela tem
 * de renderizar isso como texto.
 */

const NOW = "2026-09-08T12:00:00.000Z";
const LATER = "2026-09-08T12:30:00.000Z";

export const BATCH_ID = "0199f6f6-0000-7000-8000-000000000001";
export const CANDIDATE_ID = "0199f5f5-0000-7000-8000-000000000001";
export const MERGED_CANDIDATE_ID = "0199f5f5-0000-7000-8000-000000000002";

export const PENDING_ITEM: KnowledgeItemRecord = {
  id: "0199f7f7-0000-7000-8000-000000000001",
  projectId: PROJECT_ID,
  type: "FACT",
  status: "PENDING_REVIEW",
  title: "A sala norte alaga depois da chuva",
  content:
    "Depois da chuva o piso da sala norte fica sob água.\nO caminho seguro é pela galeria leste.\n<script>alert(1)</script>",
  provenance: {
    candidateId: CANDIDATE_ID,
    runId: RUN.id,
    taskId: TASK.id,
    distillationRunId: BATCH_ID,
    harnessSessionId: "sess-escriba-1",
    usage: {
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    mergedCandidateIds: [MERGED_CANDIDATE_ID],
    coveredItemIds: [],
  },
  version: 1,
  reviewedAt: null,
  reviewNote: null,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

export const PENDING_DECISION: KnowledgeItemRecord = {
  ...PENDING_ITEM,
  id: "0199f7f7-0000-7000-8000-000000000002",
  type: "DECISION",
  title: "Entrar sempre pela galeria leste",
  content: "Decidido: a galeria leste é a entrada padrão da masmorra.",
  provenance: { ...PENDING_ITEM.provenance, candidateId: null, mergedCandidateIds: [] },
};

export const ACTIVE_ITEM: KnowledgeItemRecord = {
  ...PENDING_ITEM,
  id: "0199f7f7-0000-7000-8000-000000000003",
  type: "PROCEDURE",
  status: "ACTIVE",
  title: "Como abrir o portão sem a chave",
  content: "Três batidas, uma pausa, duas batidas.",
  provenance: { ...PENDING_ITEM.provenance, mergedCandidateIds: [] },
  version: 2,
  reviewedAt: LATER,
  reviewNote: "Confirmado na segunda incursão.",
  updatedAt: LATER,
};

export const SUMMARY_ITEM: KnowledgeItemRecord = {
  ...PENDING_ITEM,
  id: "0199f7f7-0000-7000-8000-000000000004",
  type: "SUMMARY",
  status: "ACTIVE",
  title: "O que a Torre do Norte já sabe",
  content: "Uma masmorra que alaga, um portão que abre com ritmo, uma galeria que salva.",
  provenance: {
    candidateId: null,
    runId: null,
    taskId: null,
    distillationRunId: BATCH_ID,
    harnessSessionId: null,
    usage: null,
    mergedCandidateIds: [],
    coveredItemIds: [ACTIVE_ITEM.id],
  },
  version: 3,
  reviewedAt: null,
  reviewNote: null,
  updatedAt: LATER,
};

export const SUMMARY: ProjectSummaryRecord = {
  projectId: PROJECT_ID,
  item: SUMMARY_ITEM,
  activeItemCount: 1,
  promotedSinceSummary: 2,
};

export const CANDIDATE: KnowledgeCandidateRecord = {
  id: CANDIDATE_ID,
  projectId: PROJECT_ID,
  taskId: TASK.id,
  runId: RUN.id,
  title: "A sala norte alaga",
  content: "Depois da chuva o piso fica sob água.",
  kind: "gotcha",
  status: "PROMOTED",
  decision: "PROMOTE",
  reason: "Novidade útil para a próxima incursão.",
  knowledgeItemId: PENDING_ITEM.id,
  distillationRunId: BATCH_ID,
  processedAt: NOW,
  createdAt: NOW,
};

export const MERGED_CANDIDATE: KnowledgeCandidateRecord = {
  ...CANDIDATE,
  id: MERGED_CANDIDATE_ID,
  title: "O piso da sala norte fica molhado",
  status: "MERGED",
  decision: "MERGE",
  reason: "Repete a Página sobre a sala norte.",
};

export const REJECTED_CANDIDATE: KnowledgeCandidateRecord = {
  ...CANDIDATE,
  id: "0199f5f5-0000-7000-8000-000000000003",
  title: "Hoje choveu",
  status: "REJECTED",
  decision: "REJECT",
  reason: "Efêmero: não serve para a próxima incursão.",
  knowledgeItemId: null,
};

export const BATCH: DistillationRunRecord = {
  id: BATCH_ID,
  projectId: PROJECT_ID,
  status: "SUCCEEDED",
  trigger: "MANUAL",
  loadoutId: "0199a1a1-0000-7000-8000-000000000001",
  harnessSessionId: "sess-escriba-1",
  usage: {
    inputTokens: 1200,
    outputTokens: 300,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  },
  candidateCount: 3,
  promoted: 1,
  rejected: 1,
  merged: 1,
  summaryRegenerated: true,
  forgedAchievementId: null,
  error: null,
  startedAt: NOW,
  finishedAt: "2026-09-08T12:00:42.000Z",
};

export const FORGED: ForgedAchievementRecord = {
  id: "0199f8f8-0000-7000-8000-000000000001",
  reviewStatus: "PENDING_REVIEW",
  name: "Domador do Deadlock",
  description: "Derrotar de vez uma criatura reaberta três vezes. A plateia já tinha ido embora.",
  flavor:
    "Três reaberturas. A arquibancada apostou na quarta e perdeu. Anota: teimoso, porém eficaz.",
  plainName: "Defeito reaberto resolvido",
  plainDescription:
    'Concluir a Task "Deadlock no worker", um BUG reaberto 3 vezes, com um Run bem-sucedido.',
  icon: "skull",
  rarity: "EPIC",
  provenance: {
    kind: "NEMESIS_DEFEATED",
    detail: 'Task BUG "Deadlock no worker" reaberta 3 vezes concluída pelo Run.',
    projectId: PROJECT_ID,
    runId: RUN.id,
    taskId: TASK.id,
    distillationRunId: BATCH_ID,
    harnessSessionId: "sess-escriba-1",
  },
  reviewedAt: null,
  createdAt: NOW,
};

/** Uma resposta paginada do Grimório, com o total do servidor. */
export function knowledgePage(items: readonly KnowledgeItemRecord[]) {
  return { items: [...items], page: 1, pageSize: 25, total: items.length };
}

/** Uma resposta paginada de candidatos. */
export function candidatePage(items: readonly KnowledgeCandidateRecord[]) {
  return { items: [...items], page: 1, pageSize: 100, total: items.length };
}
