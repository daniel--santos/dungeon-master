import { type AchievementScope, parseCondition } from "@dungeon-master/achievements";
import type {
  AchievementReviewStatus,
  ForgedAchievement,
  ForgedAchievementProvenance,
} from "@dungeon-master/contracts";
import { sanitizeCredentials } from "@dungeon-master/events";
import { escapeXmlTags, type ForgedAchievementInput } from "@dungeon-master/knowledge";
import { and, desc, eq } from "drizzle-orm";

import { achievementNaturalKey } from "./achievement.js";
import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { failed, ok, type Result } from "./result.js";
import {
  type AchievementDefinitionRow,
  achievementDefinitions,
  achievementUnlocks,
} from "./schema/achievement.js";
import { runs } from "./schema/run.js";

/**
 * As Conquistas forjadas (planejamento v0.4, Fase 2.5C; documento técnico,
 * questão aberta 11, decidida: passam pelo Selo da Guilda).
 *
 * Uma forjada é uma linha de `achievement_definition` com `origin = FORGED`
 * e `review_status`. Nasce `PENDING_REVIEW`, invisível: o projetor e o Hall
 * só leem definições com a coluna nula ou `APPROVED`. Aprovar grava o
 * desbloqueio na hora — o resultado notável já aconteceu, e o cursor do
 * projetor já passou por ele — com a `condition` do vocabulário fechado
 * gravada na linha, para que `dm achievements rebuild` reproduza o mesmo
 * desbloqueio a partir dos fatos duráveis.
 */

export type ForgedAchievementWriteFailure =
  | {
      /** O CAS perdeu: a forjada já foi aprovada ou descartada. */
      readonly code: "FORGED_ALREADY_REVIEWED";
      readonly achievement: ForgedAchievement;
    }
  | {
      /** Uma forjada descartada não é renomeada. */
      readonly code: "FORGED_DISCARDED";
      readonly achievement: ForgedAchievement;
    }
  | {
      /** A definição existe, mas não é forjada. */
      readonly code: "NOT_FORGED";
      readonly origin: string;
    };

function forgedProvenanceOf(row: AchievementDefinitionRow): ForgedAchievementProvenance {
  return (
    row.forgedProvenance ?? {
      kind: "VICTORY_STREAK",
      detail: "",
      projectId: null,
      runId: null,
      taskId: null,
      distillationRunId: null,
      harnessSessionId: null,
    }
  );
}

export function toForgedAchievement(row: AchievementDefinitionRow): ForgedAchievement {
  return {
    id: row.id,
    reviewStatus: row.reviewStatus ?? "PENDING_REVIEW",
    name: row.nameTheme,
    description: row.descriptionTheme,
    flavor: row.flavor ?? "",
    plainName: row.namePlain,
    plainDescription: row.descriptionPlain,
    icon: row.icon,
    rarity: row.rarity,
    provenance: forgedProvenanceOf(row),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** O escopo que a condição amarra: a Task do nêmesis, a Guilda, ou o Project. */
function scopeOf(input: ForgedAchievementInput): { scopeType: AchievementScope; scopeId: string } {
  switch (input.kind) {
    case "NEMESIS_DEFEATED":
      return { scopeType: "TASK", scopeId: input.taskId };
    case "FIRST_HARNESS_VICTORY": {
      const condition = input.condition as { filter?: { "run.harness"?: string } };
      return { scopeType: "HARNESS", scopeId: condition.filter?.["run.harness"] ?? "" };
    }
    default:
      return { scopeType: "PROJECT", scopeId: input.projectId };
  }
}

/**
 * Grava a forjada em revisão e emite `achievement.forged`.
 *
 * A condição passa pelo schema das Conquistas antes de entrar: uma condição
 * torta seria uma linha que o projetor ignora com aviso a cada passe, para
 * sempre. Os textos já vêm sanitizados do Distiller; o `sanitizeCredentials`
 * é a mesma rede que todo payload atravessa.
 */
export async function createForgedAchievement(
  db: DatabaseExecutor,
  input: { userId: string; input: ForgedAchievementInput },
): Promise<{ id: string }> {
  const forged = input.input;
  const condition = parseCondition(forged.condition);
  if (!condition.ok) {
    throw new Error(`A condição da forjada não passa no schema: ${condition.error}`);
  }

  const id = newId();
  const scope = scopeOf(forged);
  const provenance: ForgedAchievementProvenance = {
    kind: forged.kind,
    detail: forged.detail,
    projectId: forged.projectId,
    runId: forged.runId,
    taskId: forged.taskId,
    distillationRunId: forged.distillationRunId,
    harnessSessionId: forged.provenance.harnessSessionId,
  };

  await db.insert(achievementDefinitions).values({
    id,
    userId: input.userId,
    origin: "FORGED",
    naturalKey: achievementNaturalKey("FORGED", id),
    catalogKey: null,
    templateKey: null,
    catalogVersion: null,
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    nameTheme: sanitizeCredentials(forged.name),
    namePlain: sanitizeCredentials(forged.plainName),
    descriptionTheme: sanitizeCredentials(forged.description),
    descriptionPlain: sanitizeCredentials(forged.plainDescription),
    flavor: sanitizeCredentials(forged.flavor),
    icon: forged.icon,
    rarity: forged.rarity,
    tiers: null,
    tierRarities: null,
    hidden: false,
    condition: condition.value,
    provenance: {
      runId: forged.runId,
      taskId: forged.taskId,
      createdAt: new Date().toISOString(),
    },
    reviewStatus: "PENDING_REVIEW",
    reviewedAt: null,
    forgedProvenance: provenance,
    effectiveFrom: null,
  });

  await appendDashboardEvent(db, {
    userId: input.userId,
    type: "achievement.forged",
    payload: {
      definitionId: id,
      name: forged.name,
      kind: forged.kind,
      projectId: forged.projectId,
      runId: forged.runId,
      taskId: forged.taskId,
      distillationRunId: forged.distillationRunId,
      reviewStatus: "PENDING_REVIEW",
    },
  });

  return { id };
}

export async function findForgedRow(
  db: DatabaseExecutor,
  input: { userId: string; definitionId: string; lock?: boolean },
): Promise<AchievementDefinitionRow | null> {
  const consulta = db
    .select()
    .from(achievementDefinitions)
    .where(
      and(
        eq(achievementDefinitions.id, input.definitionId),
        eq(achievementDefinitions.userId, input.userId),
      ),
    );
  const [row] = input.lock === true ? await consulta.for("update") : await consulta;
  return row ?? null;
}

/** As forjadas, da mais recente para a mais antiga. Sem filtro, as em revisão. */
export async function listForgedAchievements(
  db: DatabaseExecutor,
  input: { userId: string; reviewStatus?: AchievementReviewStatus | undefined },
): Promise<ForgedAchievement[]> {
  const rows = await db
    .select()
    .from(achievementDefinitions)
    .where(
      and(
        eq(achievementDefinitions.userId, input.userId),
        eq(achievementDefinitions.origin, "FORGED"),
        eq(achievementDefinitions.reviewStatus, input.reviewStatus ?? "PENDING_REVIEW"),
      ),
    )
    .orderBy(desc(achievementDefinitions.createdAt), desc(achievementDefinitions.id));

  return rows.map(toForgedAchievement);
}

export interface RenameForgedInput {
  userId: string;
  definitionId: string;
  patch: {
    name?: string | undefined;
    description?: string | undefined;
    flavor?: string | undefined;
  };
}

function normalizar(text: string): string {
  return escapeXmlTags(sanitizeCredentials(text)).trim();
}

function patchDeTexto(patch: RenameForgedInput["patch"]): Partial<AchievementDefinitionRow> {
  const values: Partial<AchievementDefinitionRow> = {};
  if (patch.name !== undefined && normalizar(patch.name).length > 0) {
    values.nameTheme = normalizar(patch.name);
  }
  if (patch.description !== undefined && normalizar(patch.description).length > 0) {
    values.descriptionTheme = normalizar(patch.description);
  }
  if (patch.flavor !== undefined && normalizar(patch.flavor).length > 0) {
    values.flavor = normalizar(patch.flavor);
  }
  return values;
}

/**
 * Reescreve o texto do tema. Só o do tema: a versão sóbria é do código e
 * descreve a condição, que não muda. Vale em revisão e depois de aprovada;
 * uma descartada não é renomeada.
 */
export async function renameForgedAchievement(
  db: Database,
  input: RenameForgedInput,
): Promise<Result<ForgedAchievement, ForgedAchievementWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const row = await findForgedRow(tx, { ...input, lock: true });
    if (row === null) return null;
    if (row.origin !== "FORGED") {
      return failed<ForgedAchievementWriteFailure>({ code: "NOT_FORGED", origin: row.origin });
    }
    if (row.reviewStatus === "DISCARDED") {
      return failed<ForgedAchievementWriteFailure>({
        code: "FORGED_DISCARDED",
        achievement: toForgedAchievement(row),
      });
    }

    const values = patchDeTexto(input.patch);
    if (Object.keys(values).length === 0) return ok(toForgedAchievement(row));

    const [atualizada] = await tx
      .update(achievementDefinitions)
      .set(values)
      .where(eq(achievementDefinitions.id, row.id))
      .returning();
    if (atualizada === undefined) throw new Error("A atualização da forjada não devolveu linha.");
    return ok(toForgedAchievement(atualizada));
  });
}

export type ApproveForgedInput = RenameForgedInput;

/**
 * Aprova a forjada: `APPROVED`, e o desbloqueio gravado na mesma transação.
 *
 * O CAS é `review_status = 'PENDING_REVIEW'`. O desbloqueio usa o instante
 * do Run notável, não o da aprovação — é o mesmo princípio do projetor: a
 * crônica registra quando o fato aconteceu. A unicidade de
 * `(definition_id, user_id, tier)` deixa o projetor passar por cima depois
 * sem desbloquear duas vezes, e a reconstrução rederiva o mesmo desbloqueio
 * da condição gravada.
 */
export async function approveForgedAchievement(
  db: Database,
  input: ApproveForgedInput,
): Promise<Result<ForgedAchievement, ForgedAchievementWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const row = await findForgedRow(tx, { ...input, lock: true });
    if (row === null) return null;
    if (row.origin !== "FORGED") {
      return failed<ForgedAchievementWriteFailure>({ code: "NOT_FORGED", origin: row.origin });
    }
    if (row.reviewStatus !== "PENDING_REVIEW") {
      return failed<ForgedAchievementWriteFailure>({
        code: "FORGED_ALREADY_REVIEWED",
        achievement: toForgedAchievement(row),
      });
    }

    const agora = new Date();
    const [aprovada] = await tx
      .update(achievementDefinitions)
      .set({ ...patchDeTexto(input.patch), reviewStatus: "APPROVED", reviewedAt: agora })
      .where(
        and(
          eq(achievementDefinitions.id, row.id),
          eq(achievementDefinitions.reviewStatus, "PENDING_REVIEW"),
        ),
      )
      .returning();

    if (aprovada === undefined) {
      const atual = await findForgedRow(tx, input);
      return failed<ForgedAchievementWriteFailure>({
        code: "FORGED_ALREADY_REVIEWED",
        achievement: toForgedAchievement(atual ?? row),
      });
    }

    const provenance = forgedProvenanceOf(aprovada);
    let unlockedAt = agora;
    if (provenance.runId !== null) {
      const [run] = await tx
        .select({ finishedAt: runs.finishedAt })
        .from(runs)
        .where(and(eq(runs.id, provenance.runId), eq(runs.userId, input.userId)));
      if (run?.finishedAt) unlockedAt = run.finishedAt;
    }

    const [unlock] = await tx
      .insert(achievementUnlocks)
      .values({
        id: newId(),
        definitionId: aprovada.id,
        userId: input.userId,
        tier: 1,
        runId: provenance.runId,
        taskId: provenance.taskId,
        unlockedAt,
      })
      .onConflictDoNothing({
        target: [
          achievementUnlocks.definitionId,
          achievementUnlocks.userId,
          achievementUnlocks.tier,
        ],
      })
      .returning({ id: achievementUnlocks.id });

    if (unlock !== undefined) {
      await appendDashboardEvent(tx, {
        userId: input.userId,
        type: "achievement.unlocked",
        payload: {
          unlockId: unlock.id,
          definitionId: aprovada.id,
          key: null,
          origin: "FORGED",
          name: { theme: aprovada.nameTheme, plain: aprovada.namePlain },
          description: { theme: aprovada.descriptionTheme, plain: aprovada.descriptionPlain },
          icon: aprovada.icon,
          rarity: aprovada.rarity,
          flavor: aprovada.flavor,
          tier: 1,
          tierLabel: null,
          runId: provenance.runId,
          taskId: provenance.taskId,
          unlockedAt: unlockedAt.toISOString(),
        },
      });
    }

    return ok(toForgedAchievement(aprovada));
  });
}

/** Descarta a forjada em revisão. O mesmo CAS; a linha fica, para o rate limit e a proveniência. */
export async function discardForgedAchievement(
  db: Database,
  input: { userId: string; definitionId: string },
): Promise<Result<ForgedAchievement, ForgedAchievementWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const row = await findForgedRow(tx, { ...input, lock: true });
    if (row === null) return null;
    if (row.origin !== "FORGED") {
      return failed<ForgedAchievementWriteFailure>({ code: "NOT_FORGED", origin: row.origin });
    }
    if (row.reviewStatus !== "PENDING_REVIEW") {
      return failed<ForgedAchievementWriteFailure>({
        code: "FORGED_ALREADY_REVIEWED",
        achievement: toForgedAchievement(row),
      });
    }

    const [descartada] = await tx
      .update(achievementDefinitions)
      .set({ reviewStatus: "DISCARDED", reviewedAt: new Date() })
      .where(
        and(
          eq(achievementDefinitions.id, row.id),
          eq(achievementDefinitions.reviewStatus, "PENDING_REVIEW"),
        ),
      )
      .returning();

    if (descartada === undefined) {
      const atual = await findForgedRow(tx, input);
      return failed<ForgedAchievementWriteFailure>({
        code: "FORGED_ALREADY_REVIEWED",
        achievement: toForgedAchievement(atual ?? row),
      });
    }

    return ok(toForgedAchievement(descartada));
  });
}
