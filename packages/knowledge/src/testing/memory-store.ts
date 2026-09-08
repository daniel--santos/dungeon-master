import type { KnowledgeItemStatus, KnowledgeItemType } from "@dungeon-master/contracts";

import type { NotableFacts } from "../forge.js";
import type { KnowledgeStore, LockedProjectStore, LockOutcome } from "../ports.js";
import type { SummaryTriggerFacts } from "../summary-trigger.js";
import type {
  ApplyDecisionsInput,
  ApplyDecisionsResult,
  DistillCandidate,
  DistillationRunFinish,
  DistillationRunStart,
  ForgedAchievementInput,
  ProjectContext,
  RunTranscript,
  UpsertSummaryInput,
} from "../types.js";

/**
 * O store em memória: a semântica do banco sem o banco.
 *
 * O que ele reproduz é o que o Distiller depende: o lock por Project (um
 * lote por vez, `acquired: false` para o segundo), a transação (uma exceção
 * no callback desfaz o que o callback escreveu), o recall por substring no
 * lugar do FTS, e o resumo corrente único por Project. O que ele não
 * reproduz — índices, `NOTIFY`, o CAS da revisão — é assunto dos testes com
 * PostgreSQL embutido em `@dungeon-master/database` e no Worker.
 */

export interface MemoryCandidate extends DistillCandidate {
  projectId: string;
  status: "PENDING" | "PROMOTED" | "REJECTED" | "MERGED";
  decision: "PROMOTE" | "REJECT" | "MERGE" | null;
  decidedBy: "LLM" | "RULE" | null;
  reason: string | null;
  knowledgeItemId: string | null;
  distillationRunId: string | null;
}

export interface MemoryItem {
  id: string;
  projectId: string;
  type: KnowledgeItemType;
  status: KnowledgeItemStatus;
  title: string;
  content: string;
  createdAt: string;
  provenance: {
    candidateId: string | null;
    distillationRunId: string | null;
    mergedCandidateIds: string[];
    coveredItemIds: string[];
  };
  version: number;
}

export interface MemoryDistillationRun extends DistillationRunStart {
  id: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  finish: Omit<DistillationRunFinish, "id"> | null;
}

export interface MemoryForged extends ForgedAchievementInput {
  id: string;
  reviewStatus: "PENDING_REVIEW";
}

export interface MemoryKnowledgeStoreOptions {
  readonly projects?: readonly ProjectContext[];
  readonly candidates?: readonly Omit<
    MemoryCandidate,
    "status" | "decision" | "decidedBy" | "reason" | "knowledgeItemId" | "distillationRunId"
  >[];
  readonly items?: readonly Omit<MemoryItem, "provenance" | "version">[];
  readonly transcripts?: readonly RunTranscript[];
  readonly notable?: Partial<NotableFacts>;
  /** Fatos extras do gatilho do resumo, por cima dos derivados do estado. */
  readonly summaryFacts?: Partial<SummaryTriggerFacts>;
  /** Faz a porta indicada lançar, para o caminho de falha. */
  readonly failOn?: {
    readonly applyDecisions?: Error;
    readonly recall?: Error;
    readonly upsertSummary?: Error;
    readonly createForged?: Error;
    readonly loadRunTranscripts?: Error;
  };
}

export interface MemoryKnowledgeStore extends KnowledgeStore {
  readonly candidates: MemoryCandidate[];
  readonly items: MemoryItem[];
  readonly runs: MemoryDistillationRun[];
  readonly forged: MemoryForged[];
  /** Quantas vezes o lock foi tentado e quantas foi conseguido. */
  readonly locks: { attempts: number; acquired: number };
  /** Segura o lock de um Project de fora, como faria outro lote. */
  holdLock(projectId: string): () => void;
}

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

function palavras(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 4),
  );
}

export function createMemoryKnowledgeStore(
  options: MemoryKnowledgeStoreOptions = {},
): MemoryKnowledgeStore {
  const projects = new Map((options.projects ?? []).map((project) => [project.id, project]));
  const candidates: MemoryCandidate[] = (options.candidates ?? []).map((candidate) => ({
    ...candidate,
    status: "PENDING",
    decision: null,
    decidedBy: null,
    reason: null,
    knowledgeItemId: null,
    distillationRunId: null,
  }));
  const items: MemoryItem[] = (options.items ?? []).map((item) => ({
    ...item,
    provenance: {
      candidateId: null,
      distillationRunId: null,
      mergedCandidateIds: [],
      coveredItemIds: [],
    },
    version: 1,
  }));
  const runs: MemoryDistillationRun[] = [];
  const forged: MemoryForged[] = [];
  const transcripts = new Map((options.transcripts ?? []).map((t) => [t.runId, t]));
  const held = new Set<string>();
  const locks = { attempts: 0, acquired: 0 };

  const snapshot = () => ({
    candidates: candidates.map((c) => ({ ...c })),
    items: items.map((i) => ({ ...i, provenance: { ...i.provenance } })),
    forged: forged.map((f) => ({ ...f })),
  });

  const restore = (saved: ReturnType<typeof snapshot>) => {
    candidates.splice(0, candidates.length, ...saved.candidates);
    items.splice(0, items.length, ...saved.items);
    forged.splice(0, forged.length, ...saved.forged);
  };

  const lockedStoreFor = (projectId: string): LockedProjectStore => ({
    loadProject: async () => projects.get(projectId) ?? null,

    listPendingCandidates: async (limit) =>
      candidates
        .filter((c) => c.projectId === projectId && c.status === "PENDING")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, limit)
        .map((c) => ({
          id: c.id,
          runId: c.runId,
          taskId: c.taskId,
          title: c.title,
          content: c.content,
          kind: c.kind,
          createdAt: c.createdAt,
        })),

    loadRunTranscripts: async (runIds) => {
      if (options.failOn?.loadRunTranscripts) throw options.failOn.loadRunTranscripts;
      return runIds
        .map((id) => transcripts.get(id))
        .filter((t): t is RunTranscript => t !== undefined);
    },

    recallSimilarItems: async (text, limit) => {
      if (options.failOn?.recall) throw options.failOn.recall;
      const consulta = palavras(text);
      return items
        .filter((item) => item.projectId === projectId && item.type !== "SUMMARY")
        .filter((item) => item.status === "ACTIVE" || item.status === "PENDING_REVIEW")
        .map((item) => {
          const doItem = palavras(`${item.title} ${item.content}`);
          let comuns = 0;
          for (const word of consulta) if (doItem.has(word)) comuns += 1;
          return { item, comuns };
        })
        .filter(({ comuns }) => comuns > 0)
        .sort((a, b) => b.comuns - a.comuns)
        .slice(0, limit)
        .map(({ item }) => item);
    },

    applyDecisions: async (input: ApplyDecisionsInput): Promise<ApplyDecisionsResult> => {
      if (options.failOn?.applyDecisions) throw options.failOn.applyDecisions;
      const result = { promoted: 0, rejected: 0, merged: 0, createdItemIds: [] as string[] };
      const itemPorCandidato = new Map<string, string>();
      const agora = new Date().toISOString();

      for (const decision of input.decisions) {
        const candidate = candidates.find((c) => c.id === decision.candidateId);
        if (candidate === undefined || candidate.status !== "PENDING") continue;

        const promover = (
          item: { type: KnowledgeItemType; title: string; content: string },
          reason: string,
        ): void => {
          const id = nextId("item");
          items.push({
            id,
            projectId,
            type: item.type,
            status: input.humanReview ? "PENDING_REVIEW" : "ACTIVE",
            title: item.title,
            content: item.content,
            createdAt: agora,
            provenance: {
              candidateId: candidate.id,
              distillationRunId: input.distillationRunId,
              mergedCandidateIds: [],
              coveredItemIds: [],
            },
            version: 1,
          });
          Object.assign(candidate, {
            status: "PROMOTED",
            decision: "PROMOTE",
            decidedBy: decision.decidedBy,
            reason,
            knowledgeItemId: id,
            distillationRunId: input.distillationRunId,
          });
          itemPorCandidato.set(candidate.id, id);
          result.promoted += 1;
          result.createdItemIds.push(id);
        };

        if (decision.decision === "REJECT") {
          Object.assign(candidate, {
            status: "REJECTED",
            decision: "REJECT",
            decidedBy: decision.decidedBy,
            reason: decision.reason,
            distillationRunId: input.distillationRunId,
          });
          result.rejected += 1;
          continue;
        }

        if (decision.decision === "MERGE") {
          const alvoId =
            decision.mergeIntoItemId ??
            (decision.mergeIntoCandidateId === undefined
              ? undefined
              : itemPorCandidato.get(decision.mergeIntoCandidateId));
          const alvo = alvoId === undefined ? undefined : items.find((i) => i.id === alvoId);
          if (alvo === undefined) {
            // Fail-open: o alvo não existe mais; promover em vez de perder.
            promover(
              decision.item ?? { type: "FACT", title: candidate.title, content: candidate.content },
              `${decision.reason} (alvo da mescla não existe; promovido)`,
            );
            continue;
          }
          alvo.provenance.mergedCandidateIds.push(candidate.id);
          Object.assign(candidate, {
            status: "MERGED",
            decision: "MERGE",
            decidedBy: decision.decidedBy,
            reason: decision.reason,
            knowledgeItemId: alvo.id,
            distillationRunId: input.distillationRunId,
          });
          result.merged += 1;
          continue;
        }

        if (decision.item === undefined) {
          // PROMOTE sem item é defeito de quem resolveu; rejeitar por regra
          // deixaria um candidato sumir por um bug, então promova o texto cru.
          promover(
            { type: "FACT", title: candidate.title, content: candidate.content },
            `${decision.reason} (sem item na decisão; promovido o texto cru)`,
          );
          continue;
        }
        promover(decision.item, decision.reason);
      }

      return result;
    },

    summaryFacts: async () => {
      const resumo = items.find(
        (i) => i.projectId === projectId && i.type === "SUMMARY" && i.status !== "ARCHIVED",
      );
      const ativos = items.filter(
        (i) => i.projectId === projectId && i.type !== "SUMMARY" && i.status === "ACTIVE",
      );
      const cobertos = new Set(resumo?.provenance.coveredItemIds ?? []);
      const base: SummaryTriggerFacts = {
        requested: false,
        hasSummary: resumo !== undefined,
        summaryHasContent: resumo !== undefined && resumo.content.trim().length > 0,
        activeItemCount: ativos.length,
        promotedSinceSummary:
          resumo === undefined ? ativos.length : ativos.filter((i) => !cobertos.has(i.id)).length,
        coveredItemsChanged: 0,
      };
      return { ...base, ...options.summaryFacts };
    },

    currentSummary: async () =>
      items.find(
        (i) => i.projectId === projectId && i.type === "SUMMARY" && i.status !== "ARCHIVED",
      ) ?? null,

    listItemsForSummary: async (limit) =>
      items
        .filter((i) => i.projectId === projectId && i.type !== "SUMMARY" && i.status === "ACTIVE")
        .slice(0, limit),

    upsertSummary: async (input: UpsertSummaryInput) => {
      if (options.failOn?.upsertSummary) throw options.failOn.upsertSummary;
      const atual = items.find(
        (i) => i.projectId === projectId && i.type === "SUMMARY" && i.status !== "ARCHIVED",
      );
      if (atual !== undefined) {
        atual.title = input.title;
        atual.content = input.content;
        atual.version += 1;
        atual.provenance.coveredItemIds = [...input.coveredItemIds];
        atual.provenance.distillationRunId = input.distillationRunId;
        return { id: atual.id };
      }
      const id = nextId("summary");
      items.push({
        id,
        projectId,
        type: "SUMMARY",
        status: "ACTIVE",
        title: input.title,
        content: input.content,
        createdAt: new Date().toISOString(),
        provenance: {
          candidateId: null,
          distillationRunId: input.distillationRunId,
          mergedCandidateIds: [],
          coveredItemIds: [...input.coveredItemIds],
        },
        version: 1,
      });
      return { id };
    },

    notableFacts: async () => ({
      projectId,
      projectTitle: projects.get(projectId)?.title ?? projectId,
      runs: [],
      victoryStreak: 0,
      firstVictoryRunIds: [],
      previousBestDurationMs: null,
      previousSuccessCount: 0,
      runsSinceLastForge: null,
      ...options.notable,
    }),

    createForgedAchievement: async (input) => {
      if (options.failOn?.createForged) throw options.failOn.createForged;
      const id = nextId("forged");
      forged.push({ ...input, id, reviewStatus: "PENDING_REVIEW" });
      return { id };
    },
  });

  return {
    candidates,
    items,
    runs,
    forged,
    locks,

    holdLock: (projectId) => {
      held.add(projectId);
      return () => held.delete(projectId);
    },

    createDistillationRun: async (input) => {
      const id = nextId("drun");
      runs.push({ ...input, id, status: "RUNNING", finish: null });
      return { id };
    },

    finishDistillationRun: async (input) => {
      const run = runs.find((r) => r.id === input.id);
      if (run === undefined) throw new Error(`DistillationRun ${input.id} não existe.`);
      const { id: _id, ...finish } = input;
      run.status = input.status;
      run.finish = finish;
    },

    withProjectLock: async <T>(
      projectId: string,
      fn: (locked: LockedProjectStore) => Promise<T>,
    ): Promise<LockOutcome<T>> => {
      locks.attempts += 1;
      if (held.has(projectId)) return { acquired: false };
      held.add(projectId);
      locks.acquired += 1;
      const saved = snapshot();
      try {
        const value = await fn(lockedStoreFor(projectId));
        return { acquired: true, value };
      } catch (error) {
        restore(saved);
        throw error;
      } finally {
        held.delete(projectId);
      }
    },
  };
}

export type { KnowledgeItemStatus, KnowledgeItemType };
