import type { AchievementReviewStatus, NotableResultKind } from "@dungeon-master/contracts";
import type { GlossaryKey } from "@dungeon-master/glossary";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";

import { achievementKeys } from "@/lib/achievements";
import { api } from "@/lib/api";
import type {
  ForgedAchievementListRecord,
  ForgedAchievementRecord,
  RenameForgedAchievementBody,
} from "@/lib/api-types";
import { ApiError, fail, problemMessage } from "@/lib/problem";

/**
 * As Conquistas forjadas em revisão (Fase 2.5C, entregue na 6B).
 *
 * O Distiller propõe uma Conquista a partir de um resultado notável e ela
 * nasce `PENDING_REVIEW`, invisível para o Hall e para o projetor. Só o
 * usuário a torna visível: aprovar grava o desbloqueio na mesma transação;
 * reescrever muda só o texto do tema; descartar deixa a linha para o rate
 * limit contar. Aprovar e descartar são um CAS, como toda decisão do sistema:
 * quem perde a corrida recebe `409` com a forjada atual em `achievement`.
 */

export const forgedKeys = {
  all: ["achievements", "forged"] as const,
  list: (reviewStatus: AchievementReviewStatus | undefined) =>
    ["achievements", "forged", reviewStatus ?? "PENDING_REVIEW"] as const,
};

export const FORGED_STATUS_LABEL: Record<AchievementReviewStatus, GlossaryKey> = {
  PENDING_REVIEW: "forged.status.pendingReview",
  APPROVED: "forged.status.approved",
  DISCARDED: "forged.status.discarded",
};

export const NOTABLE_KIND_LABEL: Record<NotableResultKind, GlossaryKey> = {
  NEMESIS_DEFEATED: "forged.kind.nemesisDefeated",
  VICTORY_STREAK: "forged.kind.victoryStreak",
  FIRST_HARNESS_VICTORY: "forged.kind.firstHarnessVictory",
  DURATION_RECORD: "forged.kind.durationRecord",
};

/** As forjadas num estado. Sem filtro, as em revisão, que é o que a forja mostra. */
export function useForgedAchievements(
  reviewStatus?: AchievementReviewStatus,
): UseQueryResult<ForgedAchievementListRecord> {
  return useQuery({
    queryKey: forgedKeys.list(reviewStatus),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/achievements/forged", {
        params: { query: reviewStatus === undefined ? {} : { reviewStatus } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler a forja");
      return data;
    },
  });
}

/** A `achievement` que vem no `409`, validada na borda. */
const ConflictForgedSchema = z.object({
  id: z.string(),
  reviewStatus: z.enum(["PENDING_REVIEW", "APPROVED", "DISCARDED"]),
  name: z.string(),
  description: z.string(),
  flavor: z.string(),
  plainName: z.string(),
  plainDescription: z.string(),
  icon: z.string(),
  rarity: z.enum(["COMMON", "RARE", "EPIC", "LEGENDARY"]),
  provenance: z.object({
    kind: z.enum([
      "NEMESIS_DEFEATED",
      "VICTORY_STREAK",
      "FIRST_HARNESS_VICTORY",
      "DURATION_RECORD",
    ]),
    detail: z.string(),
    projectId: z.string().nullable(),
    runId: z.string().nullable(),
    taskId: z.string().nullable(),
    distillationRunId: z.string().nullable(),
    harnessSessionId: z.string().nullable(),
  }),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
});

export function readConflictForged(problem: unknown): ForgedAchievementRecord | null {
  if (typeof problem !== "object" || problem === null) return null;
  const parsed = ConflictForgedSchema.safeParse((problem as { achievement?: unknown }).achievement);
  return parsed.success ? parsed.data : null;
}

/** O CAS perdeu: outra decisão chegou antes. `achievement` é o estado atual. */
export class ForgedConflictError extends ApiError {
  readonly achievement: ForgedAchievementRecord;

  constructor(message: string, achievement: ForgedAchievementRecord) {
    super(message, 409);
    this.name = "ForgedConflictError";
    this.achievement = achievement;
  }
}

function decisionFailure(error: unknown, status: number, fallback: string): never {
  if (status === 409) {
    const achievement = readConflictForged(error);
    if (achievement !== null) {
      throw new ForgedConflictError(
        problemMessage(error, status, "Outra decisão chegou antes"),
        achievement,
      );
    }
  }
  fail(error, status, fallback);
}

/**
 * Aprovar muda a forja, a grade do Hall (a carta aparece desbloqueada) e a
 * Crônica (o desbloqueio sai na mesma transação). Invalidar o prefixo das
 * Conquistas cobre os três.
 */
function invalidateForged(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: achievementKeys.all });
}

export interface ApproveForgedInput {
  readonly id: string;
  readonly body?: RenameForgedAchievementBody;
}

export function useApproveForgedAchievement() {
  const queryClient = useQueryClient();
  const refresh = () => {
    invalidateForged(queryClient);
  };

  return useMutation({
    mutationFn: async ({ id, body }: ApproveForgedInput): Promise<ForgedAchievementRecord> => {
      const { data, error, response } = await api.POST("/api/v1/achievements/{id}/approve", {
        params: { path: { id } },
        body: body ?? {},
      });
      if (data !== undefined) return data;
      decisionFailure(error, response.status, "Não foi possível aprovar");
    },
    onSuccess: refresh,
    onError: (error: Error) => {
      if (error instanceof ForgedConflictError) refresh();
    },
  });
}

export interface RenameForgedInput {
  readonly id: string;
  readonly body: RenameForgedAchievementBody;
}

export function useRenameForgedAchievement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, body }: RenameForgedInput): Promise<ForgedAchievementRecord> => {
      const { data, error, response } = await api.POST("/api/v1/achievements/{id}/rename", {
        params: { path: { id } },
        body,
      });
      if (data !== undefined) return data;
      decisionFailure(error, response.status, "Não foi possível reescrever");
    },
    onSuccess: () => {
      invalidateForged(queryClient);
    },
  });
}

export function useDiscardForgedAchievement() {
  const queryClient = useQueryClient();
  const refresh = () => {
    invalidateForged(queryClient);
  };

  return useMutation({
    mutationFn: async (id: string): Promise<ForgedAchievementRecord> => {
      const { data, error, response } = await api.POST("/api/v1/achievements/{id}/discard", {
        params: { path: { id } },
      });
      if (data !== undefined) return data;
      decisionFailure(error, response.status, "Não foi possível descartar");
    },
    onSuccess: refresh,
    onError: (error: Error) => {
      if (error instanceof ForgedConflictError) refresh();
    },
  });
}
