import type {
  EnforcementLevel,
  EnvironmentPolicy,
  ExecutionMode,
  ExecutionProfile,
  ExecutionProfileSnapshot,
  NetworkPolicy,
  PermissionPolicy,
  WorkspaceStrategy,
} from "@dungeon-master/contracts";
import { and, asc, eq, ne } from "drizzle-orm";

import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { IN_USE_SAMPLE_LIMIT, type RegistryWriteFailure } from "./registry.js";
import { failed, ok, type Result } from "./result.js";
import { executionProfiles, type ExecutionProfileRow, loadouts } from "./schema/execution.js";

export function toExecutionProfile(row: ExecutionProfileRow): ExecutionProfile {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    workspaceStrategy: row.workspaceStrategy,
    enforcement: row.enforcement,
    permissionPolicy: row.permissionPolicy,
    environmentPolicy: row.environmentPolicy,
    networkPolicy: row.networkPolicy,
    enabled: row.enabled,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A cópia congelada que vai para o Run.
 *
 * Sem ela, editar um perfil reescreveria a história: um Run de ontem passaria
 * a dizer que rodou com a política de hoje.
 */
export function toExecutionProfileSnapshot(
  row: ExecutionProfileRow,
  capturedAt: Date = new Date(),
): ExecutionProfileSnapshot {
  return {
    executionProfileId: row.id,
    name: row.name,
    mode: row.mode,
    workspaceStrategy: row.workspaceStrategy,
    enforcement: row.enforcement,
    permissionPolicy: row.permissionPolicy,
    environmentPolicy: row.environmentPolicy,
    networkPolicy: row.networkPolicy,
    capturedAt: capturedAt.toISOString(),
  };
}

/** Políticas usadas quando a criação não diz nada. */
export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = {
  workspaceWrite: true,
  commandExecution: "ALLOWLIST",
  allowedCommands: [],
  deniedCommands: [],
};

/**
 * Só `PATH`, e nada mais.
 *
 * O processo do worker carrega o ambiente inteiro do usuário, tokens
 * inclusive. Herdar tudo por padrão entregaria ao agente segredos que nada têm
 * a ver com a Task; sem `PATH`, por outro lado, o harness não encontra as
 * próprias ferramentas. O padrão é o mínimo que funciona.
 */
export const DEFAULT_ENVIRONMENT_POLICY: EnvironmentPolicy = {
  allowedVariables: [],
  inheritPath: true,
};

export const DEFAULT_NETWORK_POLICY: NetworkPolicy = {
  access: "ALL",
  allowedHosts: [],
};

export async function findExecutionProfileRow(
  db: DatabaseExecutor,
  input: { userId: string; executionProfileId: string },
): Promise<ExecutionProfileRow | null> {
  const [row] = await db
    .select()
    .from(executionProfiles)
    .where(
      and(
        eq(executionProfiles.id, input.executionProfileId),
        eq(executionProfiles.userId, input.userId),
      ),
    );

  return row ?? null;
}

export async function listExecutionProfiles(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<ExecutionProfile[]> {
  const rows = await db
    .select()
    .from(executionProfiles)
    .where(eq(executionProfiles.userId, input.userId))
    .orderBy(asc(executionProfiles.name), asc(executionProfiles.id));

  return rows.map(toExecutionProfile);
}

async function nameTaken(
  db: DatabaseExecutor,
  input: { userId: string; name: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: executionProfiles.id })
    .from(executionProfiles)
    .where(and(eq(executionProfiles.userId, input.userId), eq(executionProfiles.name, input.name)));

  return row !== undefined;
}

async function clearOtherDefaults(
  db: DatabaseExecutor,
  input: { userId: string; keepId: string },
): Promise<void> {
  await db
    .update(executionProfiles)
    .set({ isDefault: false })
    .where(and(eq(executionProfiles.userId, input.userId), ne(executionProfiles.id, input.keepId)));
}

export interface CreateExecutionProfileInput {
  userId: string;
  name: string;
  mode: ExecutionMode;
  workspaceStrategy: WorkspaceStrategy;
  enforcement: EnforcementLevel;
  permissionPolicy?: PermissionPolicy;
  environmentPolicy?: EnvironmentPolicy;
  networkPolicy?: NetworkPolicy;
  enabled?: boolean;
  isDefault?: boolean;
}

export async function createExecutionProfile(
  db: Database,
  input: CreateExecutionProfileInput,
): Promise<Result<ExecutionProfile, RegistryWriteFailure>> {
  return await db.transaction(async (tx) => {
    if (await nameTaken(tx, input)) {
      return failed<RegistryWriteFailure>({ code: "NAME_TAKEN", name: input.name });
    }

    const [row] = await tx
      .insert(executionProfiles)
      .values({
        id: newId(),
        userId: input.userId,
        name: input.name,
        mode: input.mode,
        workspaceStrategy: input.workspaceStrategy,
        enforcement: input.enforcement,
        permissionPolicy: input.permissionPolicy ?? DEFAULT_PERMISSION_POLICY,
        environmentPolicy: input.environmentPolicy ?? DEFAULT_ENVIRONMENT_POLICY,
        networkPolicy: input.networkPolicy ?? DEFAULT_NETWORK_POLICY,
        enabled: input.enabled ?? true,
        isDefault: input.isDefault ?? false,
      })
      .returning();

    if (row === undefined) throw new Error("A inserção em execution_profile não devolveu linha.");

    if (row.isDefault) {
      await clearOtherDefaults(tx, { userId: input.userId, keepId: row.id });
    }

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "execution_profile.created",
      payload: { executionProfileId: row.id, name: row.name, mode: row.mode },
    });

    return ok(toExecutionProfile(row));
  });
}

export interface UpdateExecutionProfilePatch {
  name?: string;
  mode?: ExecutionMode;
  workspaceStrategy?: WorkspaceStrategy;
  enforcement?: EnforcementLevel;
  permissionPolicy?: PermissionPolicy;
  environmentPolicy?: EnvironmentPolicy;
  networkPolicy?: NetworkPolicy;
  enabled?: boolean;
  isDefault?: boolean;
}

export async function updateExecutionProfile(
  db: Database,
  input: { userId: string; executionProfileId: string; patch: UpdateExecutionProfilePatch },
): Promise<Result<ExecutionProfile, RegistryWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findExecutionProfileRow(tx, input);
    if (current === null) return null;

    const { patch } = input;

    if (patch.name !== undefined && patch.name !== current.name) {
      if (await nameTaken(tx, { userId: input.userId, name: patch.name })) {
        return failed<RegistryWriteFailure>({ code: "NAME_TAKEN", name: patch.name });
      }
    }

    const changed: string[] = [];
    const values: UpdateExecutionProfilePatch = {};

    // As políticas são objetos e mudam por dentro, então a comparação é do JSON
    // serializado: um `!==` entre dois objetos iguais sempre daria "mudou" e o
    // diário encheria de edições que não editaram nada.
    const mudou = <T>(atual: T, novo: T | undefined): boolean =>
      novo !== undefined && JSON.stringify(atual) !== JSON.stringify(novo);

    if (mudou(current.name, patch.name)) {
      values.name = patch.name;
      changed.push("name");
    }
    if (mudou(current.mode, patch.mode)) {
      values.mode = patch.mode;
      changed.push("mode");
    }
    if (mudou(current.workspaceStrategy, patch.workspaceStrategy)) {
      values.workspaceStrategy = patch.workspaceStrategy;
      changed.push("workspaceStrategy");
    }
    if (mudou(current.enforcement, patch.enforcement)) {
      values.enforcement = patch.enforcement;
      changed.push("enforcement");
    }
    if (mudou(current.permissionPolicy, patch.permissionPolicy)) {
      values.permissionPolicy = patch.permissionPolicy;
      changed.push("permissionPolicy");
    }
    if (mudou(current.environmentPolicy, patch.environmentPolicy)) {
      values.environmentPolicy = patch.environmentPolicy;
      changed.push("environmentPolicy");
    }
    if (mudou(current.networkPolicy, patch.networkPolicy)) {
      values.networkPolicy = patch.networkPolicy;
      changed.push("networkPolicy");
    }
    if (mudou(current.enabled, patch.enabled)) {
      values.enabled = patch.enabled;
      changed.push("enabled");
    }
    if (mudou(current.isDefault, patch.isDefault)) {
      values.isDefault = patch.isDefault;
      changed.push("isDefault");
    }

    if (changed.length === 0) return ok(toExecutionProfile(current));

    const [row] = await tx
      .update(executionProfiles)
      .set(values)
      .where(
        and(
          eq(executionProfiles.id, input.executionProfileId),
          eq(executionProfiles.userId, input.userId),
        ),
      )
      .returning();

    if (row === undefined) {
      throw new Error("A atualização de execution_profile não devolveu linha.");
    }

    if (row.isDefault) {
      await clearOtherDefaults(tx, { userId: input.userId, keepId: row.id });
    }

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "execution_profile.updated",
      payload: { executionProfileId: row.id, changed },
    });

    return ok(toExecutionProfile(row));
  });
}

export async function deleteExecutionProfile(
  db: Database,
  input: { userId: string; executionProfileId: string },
): Promise<Result<null, RegistryWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findExecutionProfileRow(tx, input);
    if (current === null) return null;

    const emUso = await tx
      .select({ id: loadouts.id })
      .from(loadouts)
      .where(
        and(
          eq(loadouts.userId, input.userId),
          eq(loadouts.executionProfileId, input.executionProfileId),
        ),
      )
      .limit(IN_USE_SAMPLE_LIMIT);

    if (emUso.length > 0) {
      return failed<RegistryWriteFailure>({
        code: "IN_USE_BY_LOADOUT",
        loadoutIds: emUso.map((row) => row.id),
      });
    }

    await tx
      .delete(executionProfiles)
      .where(
        and(
          eq(executionProfiles.id, input.executionProfileId),
          eq(executionProfiles.userId, input.userId),
        ),
      );

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "execution_profile.deleted",
      payload: { executionProfileId: input.executionProfileId, name: current.name },
    });

    return ok(null);
  });
}
