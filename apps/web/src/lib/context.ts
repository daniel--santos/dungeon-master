import type {
  ContextExclusionReason,
  ContextItemKind,
  ContextItemReason,
  ContextSectionKind,
  RunContextStatus,
} from "@dungeon-master/contracts";
import type { GlossaryKey } from "@dungeon-master/glossary";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  BookMarked,
  Feather,
  Gavel,
  ListChecks,
  Package,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";

import { api } from "@/lib/api";
import type { ContextItemRecord, RunContextRecord } from "@/lib/api-types";
import { fail } from "@/lib/problem";
import { runKeys } from "@/lib/runs";

/**
 * As provisões da Expedição (Fase 7C): o registro do Context Engine para um
 * Run, e a ponte entre os enums dele e o que a tela mostra.
 *
 * Mesma disciplina de `lib/knowledge-domain.ts`: nenhum label escrito, só
 * **chaves** de glossário resolvidas no ponto de render, e todo mapa é um
 * `Record<Enum, …>` para que um valor novo no contrato vire erro de
 * compilação em vez de uma linha sem nome.
 *
 * O contexto é congelado por desenho: montado uma vez quando o Worker reclama
 * o Run, o mesmo texto vale para todos os passos e para qualquer retomada
 * (documento técnico, seção 20.1). A web só lê; não existe edição.
 */

/** A cor das provisões: o mesmo eixo dos acentos do canvas, no matiz do ciano. */
export const CONTEXT_COLOR = "oklch(0.72 0.13 200)";

/* -------------------------------------------------------------- leitura */

/**
 * Lê o contexto de um Run. `null` é "ainda não montado".
 *
 * A API responde `404` enquanto o Worker não reclamou o Run, e para Runs de
 * antes do Context Engine. Não é erro: é um estado do painel, e virar erro
 * pintaria de vermelho toda Expedição na fila.
 */
export async function fetchRunContext(runId: string): Promise<RunContextRecord | null> {
  const { data, error, response } = await api.GET("/api/v1/runs/{id}/context", {
    params: { path: { id: runId } },
  });
  if (data !== undefined) return data;
  if (response.status === 404) return null;
  return fail(error, response.status, "Não foi possível ler o contexto");
}

/**
 * O contexto de um Run, relido enquanto ele não existe e o Run está de pé.
 *
 * A transição de `404` para `200` acontece no claim do Worker, que não passa
 * por esta aba; enquanto o Run está vivo e o contexto não veio, a query se
 * repete no mesmo ritmo da query do Run. Depois de montado, o registro não
 * muda mais, e a query para de reler.
 */
export function useRunContext(
  runId: string,
  live: boolean,
): UseQueryResult<RunContextRecord | null> {
  return useQuery({
    queryKey: runKeys.context(runId),
    queryFn: () => fetchRunContext(runId),
    refetchInterval: (query) => (query.state.data === null && live ? 3_000 : false),
  });
}

/* ---------------------------------------------------------------- status */

/** O estado do painel: os quatro do contrato mais "ainda não montado" (o `404`). */
export type ContextPanelStatus = RunContextStatus | "PENDING";

interface ContextStatusPresentation {
  readonly label: GlossaryKey;
  readonly hint: GlossaryKey;
  readonly dot: string;
  readonly dim: boolean;
  readonly pulse: boolean;
}

export const CONTEXT_STATUS: Record<ContextPanelStatus, ContextStatusPresentation> = {
  PENDING: {
    label: "context.status.pending",
    hint: "context.pending.hint",
    dot: "var(--muted-foreground)",
    dim: true,
    pulse: true,
  },
  ASSEMBLED: {
    label: "context.status.assembled",
    hint: "context.description",
    dot: CONTEXT_COLOR,
    dim: false,
    pulse: false,
  },
  EMPTY: {
    label: "context.status.empty",
    hint: "context.empty.hint",
    dot: "var(--muted-foreground)",
    dim: true,
    pulse: false,
  },
  DISABLED: {
    label: "context.status.disabled",
    hint: "context.disabled.hint",
    dot: "var(--muted-foreground)",
    dim: true,
    pulse: false,
  },
  FAILED: {
    label: "context.status.failed",
    hint: "context.failed.hint",
    dot: "var(--destructive)",
    dim: false,
    pulse: false,
  },
};

/* ---------------------------------------------------------------- seções */

interface ContextSectionPresentation {
  readonly label: GlossaryKey;
  readonly icon: LucideIcon;
}

/** As seis seções, na ordem em que o montador as escreve no texto. */
export const CONTEXT_SECTION: Record<ContextSectionKind, ContextSectionPresentation> = {
  SUMMARY: { label: "context.section.summary", icon: Feather },
  DECISIONS: { label: "context.section.decisions", icon: Gavel },
  KNOWLEDGE: { label: "context.section.knowledge", icon: BookMarked },
  LINEAGE: { label: "context.section.lineage", icon: ListChecks },
  ARTIFACTS: { label: "context.section.artifacts", icon: Package },
  SKILLS: { label: "context.section.skills", icon: WandSparkles },
};

export const CONTEXT_SECTION_KINDS = Object.keys(CONTEXT_SECTION) as readonly ContextSectionKind[];

/* --------------------------------------------------------------- motivos */

export const CONTEXT_REASON: Record<ContextItemReason, GlossaryKey> = {
  PROJECT_SUMMARY: "context.reason.projectSummary",
  RECENT_DECISION: "context.reason.recentDecision",
  FTS_MATCH: "context.reason.ftsMatch",
  PARENT_TASK: "context.reason.parentTask",
  DEPENDENCY: "context.reason.dependency",
  PRIOR_RUN_ARTIFACT: "context.reason.priorRunArtifact",
  PARENT_TASK_ARTIFACT: "context.reason.parentTaskArtifact",
  LOADOUT_SKILL: "context.reason.loadoutSkill",
};

export const CONTEXT_EXCLUSION: Record<ContextExclusionReason, GlossaryKey> = {
  SECTION_BUDGET: "context.excluded.sectionBudget",
  TOTAL_BUDGET: "context.excluded.totalBudget",
};

/* ---------------------------------------------------------------- origem */

/**
 * Para onde um item aponta.
 *
 * O `id` de um item é o da entidade de origem, e o `kind` diz qual: uma
 * Página do Grimório abre na gaveta (`?item=`), uma Task na tela dela, um
 * artefato na Expedição que o produziu (`<runId>:<posição>`). Uma skill é
 * configuração do Loadout e não tem tela própria.
 */
export type ContextItemOrigin =
  | { readonly kind: "knowledge"; readonly projectId: string; readonly itemId: string }
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "run"; readonly runId: string }
  | null;

export function contextItemOrigin(item: ContextItemRecord, projectId: string): ContextItemOrigin {
  const kind: ContextItemKind = item.kind;
  switch (kind) {
    case "KNOWLEDGE_ITEM":
      return { kind: "knowledge", projectId, itemId: item.id };
    case "TASK":
      return { kind: "task", taskId: item.id };
    case "ARTIFACT": {
      const runId = item.id.split(":")[0] ?? "";
      return runId === "" ? null : { kind: "run", runId };
    }
    case "SKILL":
      return null;
  }
}

/** A chave do link de origem, para o label "Abrir …" do item. */
export const CONTEXT_ORIGIN_LABEL: Record<Exclude<ContextItemOrigin, null>["kind"], GlossaryKey> = {
  knowledge: "context.open.knowledge",
  task: "context.open.task",
  run: "context.open.run",
};

/** Quanto do orçamento foi usado, entre 0 e 100, para a barra. */
export function budgetPercent(used: number, total: number): number {
  if (total <= 0) return used > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
}
