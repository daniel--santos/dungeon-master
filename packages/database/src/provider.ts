import type { HarnessKey, Provider, ProviderKind } from "@dungeon-master/contracts";
import { and, asc, count, eq, type SQL, sql } from "drizzle-orm";

import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { IN_USE_SAMPLE_LIMIT, type RegistryWriteFailure } from "./registry.js";
import { failed, ok, type PageInput, type PageResult, type Result } from "./result.js";
import { models } from "./schema/execution.js";
import { type ProviderRow, providers } from "./schema/registry.js";

/**
 * Provider: quem serve os modelos e como se autentica nele (Fase 8A).
 *
 * Guarda **nomes** de variáveis de ambiente, nunca valores. O preflight só
 * pergunta ao ambiente do processo da API se a variável existe.
 */

export function toProvider(row: ProviderRow): Provider {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    authEnvKeys: row.authEnvKeys,
    harnessKeys: row.harnessKeys,
    docsUrl: row.docsUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findProviderRow(
  db: DatabaseExecutor,
  input: { userId: string; providerId: string },
): Promise<ProviderRow | null> {
  const [row] = await db
    .select()
    .from(providers)
    .where(and(eq(providers.id, input.providerId), eq(providers.userId, input.userId)));

  return row ?? null;
}

/** `harness_keys @> '["KEY"]'`: o Provider declara este Harness. */
function declaresHarness(harnessKey: HarnessKey): SQL {
  return sql`${providers.harnessKeys} @> ${JSON.stringify([harnessKey])}::jsonb`;
}

export interface ListProvidersInput extends PageInput {
  userId: string;
  harnessKey?: HarnessKey | undefined;
}

export async function listProviders(
  db: DatabaseExecutor,
  input: ListProvidersInput,
): Promise<PageResult<Provider>> {
  const conditions: SQL[] = [eq(providers.userId, input.userId)];
  if (input.harnessKey !== undefined) conditions.push(declaresHarness(input.harnessKey));
  const where = and(...conditions);

  const rows = await db
    .select()
    .from(providers)
    .where(where)
    .orderBy(asc(providers.name), asc(providers.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(providers).where(where);

  return { items: rows.map(toProvider), total: counted?.total ?? 0 };
}

/**
 * O primeiro Provider que declara o Harness, em ordem alfabética.
 *
 * É o que o preflight usa quando o Model não aponta para nenhum: melhor um
 * palpite declarado no registro do que nenhuma resposta sobre a credencial.
 */
export async function findProviderForHarness(
  db: DatabaseExecutor,
  input: { userId: string; harnessKey: HarnessKey },
): Promise<ProviderRow | null> {
  const [row] = await db
    .select()
    .from(providers)
    .where(and(eq(providers.userId, input.userId), declaresHarness(input.harnessKey)))
    .orderBy(asc(providers.name), asc(providers.id))
    .limit(1);

  return row ?? null;
}

async function nameTaken(
  db: DatabaseExecutor,
  input: { userId: string; name: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: providers.id })
    .from(providers)
    .where(and(eq(providers.userId, input.userId), eq(providers.name, input.name)));

  return row !== undefined;
}

export interface CreateProviderInput {
  userId: string;
  name: string;
  kind: ProviderKind;
  authEnvKeys?: string[];
  harnessKeys?: HarnessKey[];
  docsUrl?: string | null;
}

export async function createProvider(
  db: Database,
  input: CreateProviderInput,
): Promise<Result<Provider, RegistryWriteFailure>> {
  return await db.transaction(async (tx) => {
    if (await nameTaken(tx, input)) {
      return failed<RegistryWriteFailure>({ code: "NAME_TAKEN", name: input.name });
    }

    const [row] = await tx
      .insert(providers)
      .values({
        id: newId(),
        userId: input.userId,
        name: input.name,
        kind: input.kind,
        authEnvKeys: input.authEnvKeys ?? [],
        harnessKeys: input.harnessKeys ?? [],
        docsUrl: input.docsUrl ?? null,
      })
      .returning();

    if (row === undefined) throw new Error("A inserção em provider não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "provider", id: row.id, action: "created" },
    });

    return ok(toProvider(row));
  });
}

export interface UpdateProviderPatch {
  name?: string;
  kind?: ProviderKind;
  authEnvKeys?: string[];
  harnessKeys?: HarnessKey[];
  docsUrl?: string | null;
}

export async function updateProvider(
  db: Database,
  input: { userId: string; providerId: string; patch: UpdateProviderPatch },
): Promise<Result<Provider, RegistryWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findProviderRow(tx, input);
    if (current === null) return null;

    const { patch } = input;

    if (patch.name !== undefined && patch.name !== current.name) {
      if (await nameTaken(tx, { userId: input.userId, name: patch.name })) {
        return failed<RegistryWriteFailure>({ code: "NAME_TAKEN", name: patch.name });
      }
    }

    const mudou = <T>(atual: T, novo: T | undefined): boolean =>
      novo !== undefined && JSON.stringify(atual) !== JSON.stringify(novo);

    const changed: string[] = [];
    const values: UpdateProviderPatch = {};

    if (mudou(current.name, patch.name)) {
      values.name = patch.name;
      changed.push("name");
    }
    if (mudou(current.kind, patch.kind)) {
      values.kind = patch.kind;
      changed.push("kind");
    }
    if (mudou(current.authEnvKeys, patch.authEnvKeys)) {
      values.authEnvKeys = patch.authEnvKeys;
      changed.push("authEnvKeys");
    }
    if (mudou(current.harnessKeys, patch.harnessKeys)) {
      values.harnessKeys = patch.harnessKeys;
      changed.push("harnessKeys");
    }
    if (mudou(current.docsUrl, patch.docsUrl)) {
      values.docsUrl = patch.docsUrl;
      changed.push("docsUrl");
    }

    if (changed.length === 0) return ok(toProvider(current));

    const [row] = await tx
      .update(providers)
      .set(values)
      .where(and(eq(providers.id, input.providerId), eq(providers.userId, input.userId)))
      .returning();

    if (row === undefined) throw new Error("A atualização de provider não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "provider", id: row.id, action: "updated", changed },
    });

    return ok(toProvider(row));
  });
}

/**
 * Apaga o Provider.
 *
 * Recusa enquanto algum Model aponta para ele: a coluna é `restrict`, e o
 * `409` nomeia os Models a ajustar antes.
 */
export async function deleteProvider(
  db: Database,
  input: { userId: string; providerId: string },
): Promise<Result<null, RegistryWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findProviderRow(tx, input);
    if (current === null) return null;

    const emUso = await tx
      .select({ id: models.id })
      .from(models)
      .where(and(eq(models.userId, input.userId), eq(models.providerId, input.providerId)))
      .limit(IN_USE_SAMPLE_LIMIT);

    if (emUso.length > 0) {
      return failed<RegistryWriteFailure>({
        code: "IN_USE_BY_MODEL",
        modelIds: emUso.map((row) => row.id),
      });
    }

    await tx
      .delete(providers)
      .where(and(eq(providers.id, input.providerId), eq(providers.userId, input.userId)));

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "provider", id: input.providerId, action: "deleted" },
    });

    return ok(null);
  });
}
