import type {
  Workflow,
  WorkflowDefinition,
  WorkflowStep,
  WorkflowVersion,
  WorkflowVersionDetail,
} from "@dungeon-master/contracts";
import { topologicalOrder } from "@dungeon-master/domain";
import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";

import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { IN_USE_SAMPLE_LIMIT } from "./registry.js";
import { failed, ok, type PageInput, type PageResult, type Result } from "./result.js";
import { runs } from "./schema/run.js";
import {
  type WorkflowRow,
  type WorkflowStepRow,
  type WorkflowVersionRow,
  workflows,
  workflowSteps,
  workflowVersions,
} from "./schema/workflow.js";

/**
 * Workflow: a definição vigente e as versões congeladas dela.
 *
 * A regra central é a **captura congelada** (documento técnico, seção 19.1,
 * item 1): ao criar um Run, a definição vigente vira uma `workflow_version`
 * imutável, e é ela que o Run referencia. Editar o Workflow depois cria, no
 * máximo, uma versão nova para o próximo Run; os Runs em andamento continuam
 * lendo a que capturaram.
 */

export type WorkflowWriteFailure =
  | { readonly code: "NAME_TAKEN"; readonly name: string }
  | {
      /** Alguma versão é referenciada por Runs; apagar quebraria o histórico deles. */
      readonly code: "IN_USE_BY_RUN";
      readonly runIds: readonly string[];
    };

// --------------------------------------------------------------------------
// Conversão
// --------------------------------------------------------------------------

export function toWorkflow(row: WorkflowRow, latestVersion: number | null): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    definition: row.definition,
    latestVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toWorkflowVersion(row: WorkflowVersionRow): WorkflowVersion {
  return {
    id: row.id,
    workflowId: row.workflowId,
    version: row.version,
    definition: row.definition,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toWorkflowStep(row: WorkflowStepRow): WorkflowStep {
  return {
    id: row.id,
    workflowVersionId: row.workflowVersionId,
    key: row.key,
    name: row.name,
    type: row.type,
    position: row.position,
    definition: row.definition,
  };
}

/**
 * JSON canônico: chaves ordenadas em toda profundidade.
 *
 * É o critério de "a definição mudou desde a última versão". Comparar o
 * objeto por igualdade estrutural seria o mesmo que isto, escrito à mão; e
 * comparar `JSON.stringify` cru dependeria da ordem em que o cliente mandou
 * as chaves, o que faria um `PUT` idêntico com chaves reordenadas capturar
 * uma versão nova sem mudança nenhuma.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

// --------------------------------------------------------------------------
// Leitura
// --------------------------------------------------------------------------

/**
 * A maior `version` do Workflow, como subconsulta correlacionada.
 *
 * Os identificadores são escritos à mão, qualificados: numa consulta de tabela
 * única o Drizzle emite as colunas sem o nome da tabela, e um `"id"` solto
 * dentro da subconsulta resolveria para `workflow_version.id`, não para
 * `workflow.id`. O alias `v` deixa os dois lados inequívocos.
 */
const latestVersionOf = sql<number | null>`(
  select max(v."version")
  from "workflow_version" v
  where v."workflow_id" = "workflow"."id"
)`;

export async function findWorkflowRow(
  db: DatabaseExecutor,
  input: { userId: string; workflowId: string },
): Promise<WorkflowRow | null> {
  const [row] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, input.workflowId), eq(workflows.userId, input.userId)));

  return row ?? null;
}

export async function getWorkflow(
  db: DatabaseExecutor,
  input: { userId: string; workflowId: string },
): Promise<Workflow | null> {
  const [row] = await db
    .select({ workflow: workflows, latestVersion: latestVersionOf })
    .from(workflows)
    .where(and(eq(workflows.id, input.workflowId), eq(workflows.userId, input.userId)));

  return row === undefined ? null : toWorkflow(row.workflow, numberOrNull(row.latestVersion));
}

/** `max()` volta como texto pelo driver quando a coluna é `integer`; normaliza. */
function numberOrNull(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

export interface ListWorkflowsInput extends PageInput {
  userId: string;
}

/** A listagem, em ordem alfabética de nome, com desempate por id. */
export async function listWorkflows(
  db: DatabaseExecutor,
  input: ListWorkflowsInput,
): Promise<PageResult<Workflow>> {
  const where = eq(workflows.userId, input.userId);

  const rows = await db
    .select({ workflow: workflows, latestVersion: latestVersionOf })
    .from(workflows)
    .where(where)
    .orderBy(asc(workflows.name), asc(workflows.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(workflows).where(where);

  return {
    items: rows.map((row) => toWorkflow(row.workflow, numberOrNull(row.latestVersion))),
    total: counted?.total ?? 0,
  };
}

// --------------------------------------------------------------------------
// Escrita
// --------------------------------------------------------------------------

async function nameTaken(
  db: DatabaseExecutor,
  input: { userId: string; name: string; exceptWorkflowId?: string },
): Promise<boolean> {
  const conditions = [eq(workflows.userId, input.userId), eq(workflows.name, input.name)];
  if (input.exceptWorkflowId !== undefined) {
    conditions.push(ne(workflows.id, input.exceptWorkflowId));
  }
  const [row] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(and(...conditions));
  return row !== undefined;
}

export interface CreateWorkflowInput {
  userId: string;
  /** Já validada pelo `WorkflowDefinitionSchema`: o repositório confia na forma. */
  definition: WorkflowDefinition;
}

/**
 * Cria o Workflow com a definição vigente. Nenhuma versão nasce aqui: a
 * primeira captura acontece no primeiro Run, que é quando ela passa a
 * importar.
 */
export async function createWorkflow(
  db: Database,
  input: CreateWorkflowInput,
): Promise<Result<Workflow, WorkflowWriteFailure>> {
  return await db.transaction(async (tx) => {
    const { definition } = input;

    if (await nameTaken(tx, { userId: input.userId, name: definition.name })) {
      return failed<WorkflowWriteFailure>({ code: "NAME_TAKEN", name: definition.name });
    }

    const [row] = await tx
      .insert(workflows)
      .values({
        id: newId(),
        userId: input.userId,
        name: definition.name,
        description: definition.description ?? null,
        definition,
      })
      .returning();

    if (row === undefined) throw new Error("A inserção em workflow não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "workflow.created",
      payload: { workflowId: row.id, name: row.name },
    });

    return ok(toWorkflow(row, null));
  });
}

export interface UpdateWorkflowInput {
  userId: string;
  workflowId: string;
  definition: WorkflowDefinition;
}

/**
 * Substitui a definição vigente inteira.
 *
 * Não toca em versão nenhuma: as capturadas são imutáveis, e a próxima só
 * nasce quando um Run pedir e a definição estiver diferente da última.
 */
export async function updateWorkflow(
  db: Database,
  input: UpdateWorkflowInput,
): Promise<Result<Workflow, WorkflowWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findWorkflowRow(tx, input);
    if (current === null) return null;

    const { definition } = input;

    if (
      definition.name !== current.name &&
      (await nameTaken(tx, {
        userId: input.userId,
        name: definition.name,
        exceptWorkflowId: current.id,
      }))
    ) {
      return failed<WorkflowWriteFailure>({ code: "NAME_TAKEN", name: definition.name });
    }

    const [row] = await tx
      .update(workflows)
      .set({
        name: definition.name,
        description: definition.description ?? null,
        definition,
      })
      .where(and(eq(workflows.id, current.id), eq(workflows.userId, input.userId)))
      .returning();

    if (row === undefined) throw new Error("A atualização de workflow não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "workflow.updated",
      payload: { workflowId: row.id, name: row.name },
    });

    const updated = await getWorkflow(tx, input);
    return updated === null ? null : ok(updated);
  });
}

/**
 * Apaga o Workflow e as versões dele.
 *
 * Recusa quando alguma versão é referenciada por Run: o histórico do Run
 * ficaria sem a definição que explica os RunSteps dele. A FK `restrict` de
 * `run.workflow_version_id` é a rede por baixo; aqui a recusa vem com os ids.
 * Tasks que apontavam para o Workflow voltam ao Run simples pelo `set null`.
 */
export async function deleteWorkflow(
  db: Database,
  input: { userId: string; workflowId: string },
): Promise<Result<null, WorkflowWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const current = await findWorkflowRow(tx, input);
    if (current === null) return null;

    const emUso = await tx
      .select({ id: runs.id })
      .from(runs)
      .innerJoin(workflowVersions, eq(workflowVersions.id, runs.workflowVersionId))
      .where(and(eq(runs.userId, input.userId), eq(workflowVersions.workflowId, current.id)))
      .orderBy(desc(runs.createdAt))
      .limit(IN_USE_SAMPLE_LIMIT);

    if (emUso.length > 0) {
      return failed<WorkflowWriteFailure>({
        code: "IN_USE_BY_RUN",
        runIds: emUso.map((row) => row.id),
      });
    }

    await tx
      .delete(workflows)
      .where(and(eq(workflows.id, current.id), eq(workflows.userId, input.userId)));

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "workflow.deleted",
      payload: { workflowId: current.id, name: current.name },
    });

    return ok(null);
  });
}

// --------------------------------------------------------------------------
// Captura congelada
// --------------------------------------------------------------------------

export interface CapturedWorkflowVersion {
  readonly version: WorkflowVersionRow;
  /** Os steps da versão, na ordem topológica. */
  readonly steps: WorkflowStepRow[];
  /** `true` quando uma versão nova foi gravada agora; `false` quando a última já servia. */
  readonly created: boolean;
}

/**
 * Congela a definição vigente numa versão, ou devolve a última se nada mudou.
 *
 * **Contrato para quem cria Run** (e para o motor da Fase 4B, se precisar
 * reler): recebe o executor da transação que está criando o Run, porque a
 * captura e o Run precisam sair no mesmo COMMIT — um Run apontando para uma
 * versão que outra transação desfez seria um Run sem definição.
 *
 * Idempotente por conteúdo: a definição vigente é comparada com a da última
 * versão em JSON canônico; iguais, a última é devolvida com `created: false`.
 * A linha do Workflow é travada durante a comparação, para duas criações de
 * Run simultâneas não gravarem duas versões idênticas com números diferentes.
 *
 * Devolve `null` quando o Workflow não existe para este usuário.
 */
export async function captureWorkflowVersion(
  db: DatabaseExecutor,
  input: { userId: string; workflowId: string },
): Promise<CapturedWorkflowVersion | null> {
  const [workflow] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, input.workflowId), eq(workflows.userId, input.userId)))
    .for("update");

  if (workflow === undefined) return null;

  const [latest] = await db
    .select()
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowId, workflow.id))
    .orderBy(desc(workflowVersions.version))
    .limit(1);

  if (
    latest !== undefined &&
    canonicalJson(latest.definition) === canonicalJson(workflow.definition)
  ) {
    const steps = await listWorkflowStepRows(db, { workflowVersionId: latest.id });
    return { version: latest, steps, created: false };
  }

  const order = topologicalOrder(workflow.definition.steps);
  if (!order.ok) {
    // A definição passou pelo schema ao ser gravada, e o teste de paridade
    // garante que schema e domínio concordam sobre ciclos. Chegar aqui é
    // defeito, e um Run com steps sem ordem não pode nascer.
    throw new Error(
      `A definição do Workflow ${workflow.id} não tem ordem topológica: ${JSON.stringify(order)}.`,
    );
  }

  const [version] = await db
    .insert(workflowVersions)
    .values({
      id: newId(),
      userId: input.userId,
      workflowId: workflow.id,
      version: (latest?.version ?? 0) + 1,
      definition: workflow.definition,
    })
    .returning();

  if (version === undefined) throw new Error("A inserção em workflow_version não devolveu linha.");

  const byKey = new Map(workflow.definition.steps.map((step) => [step.key, step] as const));
  const steps = await db
    .insert(workflowSteps)
    .values(
      order.order.map((key, position) => {
        const step = byKey.get(key)!;
        return {
          id: newId(),
          userId: input.userId,
          workflowVersionId: version.id,
          key: step.key,
          name: step.name,
          type: step.type,
          position,
          definition: step,
        };
      }),
    )
    .returning();

  steps.sort((a, b) => a.position - b.position);

  return { version, steps, created: true };
}

async function listWorkflowStepRows(
  db: DatabaseExecutor,
  input: { workflowVersionId: string },
): Promise<WorkflowStepRow[]> {
  return await db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowVersionId, input.workflowVersionId))
    .orderBy(asc(workflowSteps.position), asc(workflowSteps.key));
}

// --------------------------------------------------------------------------
// Versões
// --------------------------------------------------------------------------

export interface ListWorkflowVersionsInput extends PageInput {
  userId: string;
  workflowId: string;
}

/** As versões de um Workflow, da mais recente para a mais antiga. */
export async function listWorkflowVersions(
  db: DatabaseExecutor,
  input: ListWorkflowVersionsInput,
): Promise<PageResult<WorkflowVersion>> {
  const where = and(
    eq(workflowVersions.userId, input.userId),
    eq(workflowVersions.workflowId, input.workflowId),
  );

  const rows = await db
    .select()
    .from(workflowVersions)
    .where(where)
    .orderBy(desc(workflowVersions.version))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(workflowVersions).where(where);

  return { items: rows.map(toWorkflowVersion), total: counted?.total ?? 0 };
}

export async function findWorkflowVersionRow(
  db: DatabaseExecutor,
  input: { userId: string; workflowVersionId: string },
): Promise<WorkflowVersionRow | null> {
  const [row] = await db
    .select()
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.id, input.workflowVersionId),
        eq(workflowVersions.userId, input.userId),
      ),
    );

  return row ?? null;
}

/** Uma versão com os steps materializados, na ordem topológica. */
export async function getWorkflowVersionDetail(
  db: DatabaseExecutor,
  input: { userId: string; workflowVersionId: string },
): Promise<WorkflowVersionDetail | null> {
  const row = await findWorkflowVersionRow(db, input);
  if (row === null) return null;

  const steps = await listWorkflowStepRows(db, { workflowVersionId: row.id });

  return { ...toWorkflowVersion(row), steps: steps.map(toWorkflowStep) };
}
