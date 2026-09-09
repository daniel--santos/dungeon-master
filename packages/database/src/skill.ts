import type { Skill, SkillDetail, SkillVersion } from "@dungeon-master/contracts";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";

import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { IN_USE_SAMPLE_LIMIT, type RegistryWriteFailure } from "./registry.js";
import { failed, ok, type PageInput, type PageResult, type Result } from "./result.js";
import { loadoutSkills } from "./schema/execution.js";
import { type SkillRow, skills, skillVersions, type SkillVersionRow } from "./schema/registry.js";

/**
 * Skill: o registro e a pilha de versões (planejamento v0.4, Fase 8A).
 *
 * Publicar é **append-only**: uma versão nova é inserida com o número seguinte
 * e a anterior nunca é tocada. A linha da Skill é travada durante a publicação
 * para dois `POST` simultâneos não calcularem o mesmo número, e o
 * `expectedLatestVersion` opcional é o CAS de quem editou a partir de uma
 * versão que leu: perder a corrida vira `409`, não sobrescrita.
 */

export function toSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    latestVersion: row.latestVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toSkillVersion(row: SkillVersionRow): SkillVersion {
  return {
    id: row.id,
    skillId: row.skillId,
    version: row.version,
    content: row.content,
    changelog: row.changelog,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function findSkillRow(
  db: DatabaseExecutor,
  input: { userId: string; skillId: string },
): Promise<SkillRow | null> {
  const [row] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.id, input.skillId), eq(skills.userId, input.userId)));

  return row ?? null;
}

export async function findSkillVersionRow(
  db: DatabaseExecutor,
  input: { userId: string; skillId: string; version: number },
): Promise<SkillVersionRow | null> {
  const [row] = await db
    .select()
    .from(skillVersions)
    .where(
      and(
        eq(skillVersions.userId, input.userId),
        eq(skillVersions.skillId, input.skillId),
        eq(skillVersions.version, input.version),
      ),
    );

  return row ?? null;
}

export interface ListSkillsInput extends PageInput {
  userId: string;
}

export async function listSkills(
  db: DatabaseExecutor,
  input: ListSkillsInput,
): Promise<PageResult<Skill>> {
  const where = eq(skills.userId, input.userId);

  const rows = await db
    .select()
    .from(skills)
    .where(where)
    .orderBy(asc(skills.name), asc(skills.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(skills).where(where);

  return { items: rows.map(toSkill), total: counted?.total ?? 0 };
}

export async function getSkillDetail(
  db: DatabaseExecutor,
  input: { userId: string; skillId: string },
): Promise<SkillDetail | null> {
  const row = await findSkillRow(db, input);
  if (row === null) return null;

  const latest = await findSkillVersionRow(db, {
    userId: input.userId,
    skillId: row.id,
    version: row.latestVersion,
  });
  if (latest === null) {
    // `latest_version` aponta para uma versão que não existe: defeito, não estado.
    throw new Error(
      `A Skill ${row.id} diz estar na versão ${String(row.latestVersion)}, que não existe.`,
    );
  }

  return { ...toSkill(row), latest: toSkillVersion(latest) };
}

async function nameTaken(
  db: DatabaseExecutor,
  input: { userId: string; name: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: skills.id })
    .from(skills)
    .where(and(eq(skills.userId, input.userId), eq(skills.name, input.name)));

  return row !== undefined;
}

export interface CreateSkillInput {
  userId: string;
  name: string;
  description?: string | null;
  content?: string;
  changelog?: string | null;
}

/**
 * Insere a Skill e a versão 1 na mesma transação, sem evento.
 *
 * É a peça que `createSkill` e a resolução da forma curta compartilham: quem
 * chama já travou o que precisava e decide se emite `registry.changed`.
 */
export async function insertSkillWithFirstVersion(
  db: DatabaseExecutor,
  input: CreateSkillInput,
): Promise<{ skill: SkillRow; version: SkillVersionRow }> {
  const [skill] = await db
    .insert(skills)
    .values({
      id: newId(),
      userId: input.userId,
      name: input.name,
      description: input.description ?? null,
      latestVersion: 1,
    })
    .returning();

  if (skill === undefined) throw new Error("A inserção em skill não devolveu linha.");

  const [version] = await db
    .insert(skillVersions)
    .values({
      id: newId(),
      userId: input.userId,
      skillId: skill.id,
      version: 1,
      content: input.content ?? "",
      changelog: input.changelog ?? null,
    })
    .returning();

  if (version === undefined) throw new Error("A inserção em skill_version não devolveu linha.");

  return { skill, version };
}

export async function createSkill(
  db: Database,
  input: CreateSkillInput,
): Promise<Result<SkillDetail, RegistryWriteFailure>> {
  return await db.transaction(async (tx) => {
    if (await nameTaken(tx, input)) {
      return failed<RegistryWriteFailure>({ code: "NAME_TAKEN", name: input.name });
    }

    const { skill, version } = await insertSkillWithFirstVersion(tx, input);

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "skill", id: skill.id, action: "created" },
    });

    return ok({ ...toSkill(skill), latest: toSkillVersion(version) });
  });
}

export interface UpdateSkillPatch {
  name?: string;
  description?: string | null;
}

export async function updateSkill(
  db: Database,
  input: { userId: string; skillId: string; patch: UpdateSkillPatch },
): Promise<Result<Skill, RegistryWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findSkillRow(tx, input);
    if (current === null) return null;

    const { patch } = input;

    if (patch.name !== undefined && patch.name !== current.name) {
      if (await nameTaken(tx, { userId: input.userId, name: patch.name })) {
        return failed<RegistryWriteFailure>({ code: "NAME_TAKEN", name: patch.name });
      }
    }

    const changed: string[] = [];
    const values: UpdateSkillPatch = {};

    if (patch.name !== undefined && patch.name !== current.name) {
      values.name = patch.name;
      changed.push("name");
    }
    if (patch.description !== undefined && patch.description !== current.description) {
      values.description = patch.description;
      changed.push("description");
    }

    if (changed.length === 0) return ok(toSkill(current));

    const [row] = await tx
      .update(skills)
      .set(values)
      .where(and(eq(skills.id, input.skillId), eq(skills.userId, input.userId)))
      .returning();

    if (row === undefined) throw new Error("A atualização de skill não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "skill", id: row.id, action: "updated", changed },
    });

    return ok(toSkill(row));
  });
}

export interface PublishSkillVersionInput {
  userId: string;
  skillId: string;
  content: string;
  changelog?: string | null;
  /** CAS: recusa se a mais recente já não for esta. */
  expectedLatestVersion?: number;
}

/**
 * Publica a versão seguinte. Append-only.
 *
 * A linha da Skill é travada com `FOR UPDATE` antes de ler `latest_version`:
 * sem a trava, duas publicações simultâneas leriam o mesmo número e a segunda
 * quebraria no índice único em vez de virar a versão seguinte.
 */
export async function publishSkillVersion(
  db: Database,
  input: PublishSkillVersionInput,
): Promise<Result<SkillVersion, RegistryWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(skills)
      .where(and(eq(skills.id, input.skillId), eq(skills.userId, input.userId)))
      .for("update");

    if (current === undefined) return null;

    if (
      input.expectedLatestVersion !== undefined &&
      input.expectedLatestVersion !== current.latestVersion
    ) {
      return failed<RegistryWriteFailure>({
        code: "SKILL_VERSION_CONFLICT",
        skillId: current.id,
        expectedLatestVersion: input.expectedLatestVersion,
        latestVersion: current.latestVersion,
      });
    }

    const version = current.latestVersion + 1;

    const [inserted] = await tx
      .insert(skillVersions)
      .values({
        id: newId(),
        userId: input.userId,
        skillId: current.id,
        version,
        content: input.content,
        changelog: input.changelog ?? null,
      })
      .returning();

    if (inserted === undefined) throw new Error("A inserção em skill_version não devolveu linha.");

    await tx
      .update(skills)
      .set({ latestVersion: version })
      .where(and(eq(skills.id, current.id), eq(skills.userId, input.userId)));

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "skill", id: current.id, action: "updated", version },
    });

    return ok(toSkillVersion(inserted));
  });
}

export interface ListSkillVersionsInput extends PageInput {
  userId: string;
  skillId: string;
}

export async function listSkillVersions(
  db: DatabaseExecutor,
  input: ListSkillVersionsInput,
): Promise<PageResult<SkillVersion>> {
  const where = and(
    eq(skillVersions.userId, input.userId),
    eq(skillVersions.skillId, input.skillId),
  );

  const rows = await db
    .select()
    .from(skillVersions)
    .where(where)
    .orderBy(desc(skillVersions.version))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(skillVersions).where(where);

  return { items: rows.map(toSkillVersion), total: counted?.total ?? 0 };
}

/**
 * Apaga a Skill e as versões dela.
 *
 * Recusa enquanto algum Loadout a referencia: a junção é `restrict`, e a
 * checagem aqui existe para o `409` nomear os Loadouts. Runs antigos não
 * impedem: o snapshot deles carrega o conteúdo da versão efetiva.
 */
export async function deleteSkill(
  db: Database,
  input: { userId: string; skillId: string },
): Promise<Result<null, RegistryWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findSkillRow(tx, input);
    if (current === null) return null;

    const emUso = await tx
      .select({ loadoutId: loadoutSkills.loadoutId })
      .from(loadoutSkills)
      .where(and(eq(loadoutSkills.userId, input.userId), eq(loadoutSkills.skillId, input.skillId)))
      .limit(IN_USE_SAMPLE_LIMIT);

    if (emUso.length > 0) {
      return failed<RegistryWriteFailure>({
        code: "IN_USE_BY_LOADOUT",
        loadoutIds: emUso.map((row) => row.loadoutId),
      });
    }

    await tx
      .delete(skills)
      .where(and(eq(skills.id, input.skillId), eq(skills.userId, input.userId)));

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "registry.changed",
      payload: { kind: "skill", id: input.skillId, action: "deleted" },
    });

    return ok(null);
  });
}

/** Quantas Skills um usuário tem. Usado pelo seed e por testes. */
export async function countSkills(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(skills)
    .where(eq(skills.userId, input.userId));
  return row?.total ?? 0;
}
