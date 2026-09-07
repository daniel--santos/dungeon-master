import type { Harness, HarnessCapabilities, HarnessKey, Model } from "@dungeon-master/contracts";
import { and, asc, eq, ne } from "drizzle-orm";

import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { IN_USE_SAMPLE_LIMIT, type RegistryWriteFailure } from "./registry.js";
import { failed, ok, type Result } from "./result.js";
import { harnesses, type HarnessRow, loadouts, models, type ModelRow } from "./schema/execution.js";

export function toHarness(row: HarnessRow): Harness {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    enabled: row.enabled,
    capabilities: row.capabilities,
    installedVersion: row.installedVersion,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toModel(row: ModelRow): Model {
  return {
    id: row.id,
    harnessId: row.harnessId,
    key: row.key,
    name: row.name,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// --------------------------------------------------------------------------
// Harness: só leitura e o interruptor
// --------------------------------------------------------------------------

/**
 * A ordem do catálogo, e não a alfabética.
 *
 * A tela lista as quatro guildas sempre na mesma ordem, que é a de suporte:
 * Claude Code, Codex e Pi já rodam na Fase 2; Antigravity chega na Fase 3.
 * Ordenar por nome poria Antigravity em primeiro e sugeriria uma prioridade
 * que não existe.
 */
const HARNESS_ORDER: Record<HarnessKey, number> = {
  CLAUDE_CODE: 0,
  CODEX: 1,
  PI: 2,
  ANTIGRAVITY: 3,
};

export async function findHarnessRow(
  db: DatabaseExecutor,
  input: { userId: string; harnessId: string },
): Promise<HarnessRow | null> {
  const [row] = await db
    .select()
    .from(harnesses)
    .where(and(eq(harnesses.id, input.harnessId), eq(harnesses.userId, input.userId)));

  return row ?? null;
}

export async function listHarnesses(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<Harness[]> {
  const rows = await db.select().from(harnesses).where(eq(harnesses.userId, input.userId));

  return rows
    .map(toHarness)
    .sort((left, right) => HARNESS_ORDER[left.key] - HARNESS_ORDER[right.key]);
}

/**
 * Liga ou desliga o Harness. Idempotente: pedir o estado atual não grava fato.
 *
 * É a única escrita de Harness pela API. `capabilities` e `key` são do adapter:
 * editá-los daqui produziria uma promessa que o código não cumpre.
 */
export async function setHarnessEnabled(
  db: Database,
  input: { userId: string; harnessId: string; enabled: boolean },
): Promise<Harness | null> {
  return await db.transaction(async (tx) => {
    const current = await findHarnessRow(tx, input);
    if (current === null) return null;
    if (current.enabled === input.enabled) return toHarness(current);

    const [row] = await tx
      .update(harnesses)
      .set({ enabled: input.enabled })
      .where(and(eq(harnesses.id, input.harnessId), eq(harnesses.userId, input.userId)))
      .returning();

    if (row === undefined) throw new Error("A atualização de harness não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "harness.updated",
      payload: { harnessId: row.id, key: row.key, enabled: row.enabled },
    });

    return toHarness(row);
  });
}

/**
 * Grava o resultado de um preflight.
 *
 * Fora da API de propósito: quem descobre a versão é o adapter do harness, no
 * worker. Está aqui porque a coluna é desta tabela, e um segundo caminho de
 * escrita em `packages/runtime` faria o pacote importar o banco, o que a
 * fronteira proíbe.
 *
 * `capabilities` é opcional e, quando vem, **sobrescreve** o que o `db:seed`
 * declarou. As duas fontes existem por motivos diferentes: a semente precisa
 * responder à interface antes de qualquer Worker ter subido, e o adapter é a
 * verdade sobre o que o código realmente faz. Quando as duas discordam, quem
 * executa ganha — prometer na tela o que o adapter não cumpre é pior que
 * mostrar uma matriz mais modesta.
 */
export async function recordHarnessPreflight(
  db: DatabaseExecutor,
  input: {
    userId: string;
    harnessId: string;
    installedVersion: string | null;
    capabilities?: HarnessCapabilities;
    checkedAt?: Date;
  },
): Promise<void> {
  await db
    .update(harnesses)
    .set({
      installedVersion: input.installedVersion,
      checkedAt: input.checkedAt ?? new Date(),
      ...(input.capabilities === undefined ? {} : { capabilities: input.capabilities }),
    })
    .where(and(eq(harnesses.id, input.harnessId), eq(harnesses.userId, input.userId)));
}

/** O Harness de uma `key`, para o Worker casar adapter com linha do banco. */
export async function findHarnessRowByKey(
  db: DatabaseExecutor,
  input: { userId: string; key: HarnessKey },
): Promise<HarnessRow | null> {
  const [row] = await db
    .select()
    .from(harnesses)
    .where(and(eq(harnesses.key, input.key), eq(harnesses.userId, input.userId)));

  return row ?? null;
}

// --------------------------------------------------------------------------
// Model: CRUD
// --------------------------------------------------------------------------

export async function findModelRow(
  db: DatabaseExecutor,
  input: { userId: string; modelId: string },
): Promise<ModelRow | null> {
  const [row] = await db
    .select()
    .from(models)
    .where(and(eq(models.id, input.modelId), eq(models.userId, input.userId)));

  return row ?? null;
}

export async function listModels(
  db: DatabaseExecutor,
  input: { userId: string; harnessId?: string | undefined },
): Promise<Model[]> {
  const conditions = [eq(models.userId, input.userId)];
  if (input.harnessId !== undefined) conditions.push(eq(models.harnessId, input.harnessId));

  const rows = await db
    .select()
    .from(models)
    .where(and(...conditions))
    .orderBy(asc(models.harnessId), asc(models.name), asc(models.id));

  return rows.map(toModel);
}

/**
 * Deixa só um Model padrão por Harness.
 *
 * Feito por `UPDATE` em vez de um índice parcial único porque a troca precisa
 * ser transparente: marcar um novo padrão desmarca o anterior em vez de falhar
 * pedindo que o usuário desmarque primeiro.
 */
async function clearOtherDefaults(
  db: DatabaseExecutor,
  input: { userId: string; harnessId: string; keepModelId: string },
): Promise<void> {
  await db
    .update(models)
    .set({ isDefault: false })
    .where(
      and(
        eq(models.userId, input.userId),
        eq(models.harnessId, input.harnessId),
        ne(models.id, input.keepModelId),
      ),
    );
}

export interface CreateModelInput {
  userId: string;
  harnessId: string;
  key: string;
  name: string;
  isDefault?: boolean;
}

export async function createModel(
  db: Database,
  input: CreateModelInput,
): Promise<Result<Model, RegistryWriteFailure>> {
  return await db.transaction(async (tx) => {
    const harness = await findHarnessRow(tx, { userId: input.userId, harnessId: input.harnessId });
    if (harness === null) {
      return failed<RegistryWriteFailure>({
        code: "HARNESS_NOT_FOUND",
        harnessId: input.harnessId,
      });
    }

    const [existing] = await tx
      .select({ id: models.id })
      .from(models)
      .where(and(eq(models.harnessId, input.harnessId), eq(models.key, input.key)));

    if (existing !== undefined) {
      return failed<RegistryWriteFailure>({ code: "MODEL_KEY_TAKEN", key: input.key });
    }

    const isDefault = input.isDefault ?? false;

    const [row] = await tx
      .insert(models)
      .values({
        id: newId(),
        userId: input.userId,
        harnessId: input.harnessId,
        key: input.key,
        name: input.name,
        isDefault,
      })
      .returning();

    if (row === undefined) throw new Error("A inserção em model não devolveu linha.");

    if (isDefault) {
      await clearOtherDefaults(tx, {
        userId: input.userId,
        harnessId: input.harnessId,
        keepModelId: row.id,
      });
    }

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "model.created",
      payload: { modelId: row.id, harnessId: row.harnessId, key: row.key, name: row.name },
    });

    return ok(toModel(row));
  });
}

export interface UpdateModelPatch {
  key?: string;
  name?: string;
  isDefault?: boolean;
}

export async function updateModel(
  db: Database,
  input: { userId: string; modelId: string; patch: UpdateModelPatch },
): Promise<Result<Model, RegistryWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findModelRow(tx, input);
    if (current === null) return null;

    const { patch } = input;

    if (patch.key !== undefined && patch.key !== current.key) {
      const [taken] = await tx
        .select({ id: models.id })
        .from(models)
        .where(and(eq(models.harnessId, current.harnessId), eq(models.key, patch.key)));

      if (taken !== undefined) {
        return failed<RegistryWriteFailure>({ code: "MODEL_KEY_TAKEN", key: patch.key });
      }
    }

    const changed: string[] = [];
    const values: UpdateModelPatch = {};

    if (patch.key !== undefined && patch.key !== current.key) {
      values.key = patch.key;
      changed.push("key");
    }
    if (patch.name !== undefined && patch.name !== current.name) {
      values.name = patch.name;
      changed.push("name");
    }
    if (patch.isDefault !== undefined && patch.isDefault !== current.isDefault) {
      values.isDefault = patch.isDefault;
      changed.push("isDefault");
    }

    if (changed.length === 0) return ok(toModel(current));

    const [row] = await tx
      .update(models)
      .set(values)
      .where(and(eq(models.id, input.modelId), eq(models.userId, input.userId)))
      .returning();

    if (row === undefined) throw new Error("A atualização de model não devolveu linha.");

    if (row.isDefault) {
      await clearOtherDefaults(tx, {
        userId: input.userId,
        harnessId: row.harnessId,
        keepModelId: row.id,
      });
    }

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "model.updated",
      payload: { modelId: row.id, harnessId: row.harnessId, changed },
    });

    return ok(toModel(row));
  });
}

/**
 * Apaga o Model.
 *
 * Recusa enquanto algum Loadout aponta para ele. A coluna é `on delete set
 * null`, então o banco aceitaria — e o Loadout passaria a usar em silêncio o
 * Model padrão do Harness, que é uma mudança de comportamento que ninguém
 * pediu. O `409` diz quais Loadouts precisam ser ajustados antes.
 */
export async function deleteModel(
  db: Database,
  input: { userId: string; modelId: string },
): Promise<Result<null, RegistryWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findModelRow(tx, input);
    if (current === null) return null;

    const emUso = await tx
      .select({ id: loadouts.id })
      .from(loadouts)
      .where(and(eq(loadouts.userId, input.userId), eq(loadouts.modelId, input.modelId)))
      .limit(IN_USE_SAMPLE_LIMIT);

    if (emUso.length > 0) {
      return failed<RegistryWriteFailure>({
        code: "IN_USE_BY_LOADOUT",
        loadoutIds: emUso.map((row) => row.id),
      });
    }

    await tx
      .delete(models)
      .where(and(eq(models.id, input.modelId), eq(models.userId, input.userId)));

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "model.deleted",
      payload: { modelId: input.modelId, harnessId: current.harnessId },
    });

    return ok(null);
  });
}
