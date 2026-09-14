import {
  type DelegationTaskStrategy,
  type DiagnosticEvent,
  type RunCreated,
  type RunResultStatus,
  type RunStatus,
  TASK_TITLE_MAX_LENGTH,
  type UsageSummary,
} from "@dungeon-master/contracts";
import { allowsAutomation } from "@dungeon-master/domain";
import { sanitizeCredentials } from "@dungeon-master/events";
import { and, eq } from "drizzle-orm";

import { recordDomainEvent } from "./activity.js";
import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { findLoadoutRow } from "./loadout.js";
import { failed, ok, type Result } from "./result.js";
import { insertRunEvent } from "./run-event.js";
import { applyRunStepTransition, findRunStepRow } from "./run-step.js";
import {
  applyRunStatus,
  createRunWithin,
  findChildRunRowByStep,
  findRunRow,
  lockRunRow,
  type RunWriteFailure,
} from "./run.js";
import { loadouts } from "./schema/execution.js";
import { projects } from "./schema/project.js";
import { type RunRow, runs } from "./schema/run.js";
import { tasks } from "./schema/task.js";

/**
 * A delegação Agent-to-Agent (planejamento v0.4, Fase 9B).
 *
 * Duas portas de entrada, um caminho só:
 *
 * - **O step `delegate` do Workflow** (`openDelegation`): abre o Run filho,
 *   leva o step e o Run mãe a `WAITING_CHILD` na **mesma transação**, e o
 *   Worker solta o Run. O desfecho do filho devolve a mãe à fila
 *   (`wakeParentAfterChildOutcome`, em `run.ts`), e o motor assenta o passo
 *   ao reler o filho pela chave do step — nunca abre um segundo.
 * - **A ferramenta `delegate_task`** (`createDelegatedRun`): o agente da mãe
 *   está vivo e espera com `await_run`; a mãe continua `RUNNING`, e o filho é
 *   só um Run a mais com `parent_run_id`.
 *
 * O filho passa pelas **mesmas recusas** de `POST /runs` — disjuntores,
 * orçamentos, política de partida, capability matching — porque nasce por
 * `createRunWithin`. A profundidade máxima é regra do domínio.
 */

export type DelegationFailure =
  | RunWriteFailure
  | {
      /** O `loadoutRef` não é o id nem o nome de nenhum Loadout do usuário. */
      readonly code: "LOADOUT_REF_NOT_FOUND";
      readonly loadoutRef: string;
    }
  | {
      /** O Run mãe não está em `RUNNING`: não há de onde delegar. */
      readonly code: "PARENT_NOT_RUNNING";
      readonly parentRunId: string;
      readonly status: RunStatus;
    }
  | {
      /** O step do Run mãe não existe ou não está em `RUNNING`. */
      readonly code: "PARENT_STEP_NOT_RUNNING";
      readonly parentRunId: string;
      readonly stepKey: string;
    }
  | {
      /** O nível de autonomia do Project não libera `DELEGATE` (só a ferramenta exige). */
      readonly code: "DELEGATION_NOT_ALLOWED";
      readonly autonomyLevel: number;
    };

/** O que o motor e a ferramenta precisam saber de um Run filho. */
export interface ChildRunView {
  readonly id: string;
  readonly taskId: string;
  readonly status: RunStatus;
  readonly loadoutName: string;
  readonly resultStatus: RunResultStatus | null;
  readonly summary: string | null;
  readonly usage: UsageSummary | null;
  readonly error: { readonly code?: string | undefined; readonly message: string } | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O `usage` do resultado como `UsageSummary`, ou nulo quando não há número. */
function toUsageSummary(usage: unknown): UsageSummary | null {
  if (typeof usage !== "object" || usage === null) return null;
  const u = usage as Record<string, unknown>;
  const numero = (chave: string): number | undefined => {
    const valor = u[chave];
    return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? valor : undefined;
  };
  const inputTokens = numero("inputTokens");
  const outputTokens = numero("outputTokens");
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    numero("totalTokens") === undefined
  ) {
    return null;
  }
  const custo = numero("costUsd");
  return {
    inputTokens: inputTokens ?? numero("totalTokens") ?? 0,
    outputTokens: outputTokens ?? 0,
    cacheReadInputTokens: numero("cacheReadInputTokens") ?? 0,
    cacheCreationInputTokens: numero("cacheCreationInputTokens") ?? 0,
    ...(custo === undefined ? {} : { costUsd: custo }),
  };
}

export function toChildRunView(row: RunRow): ChildRunView {
  const resultado = row.result;
  const erro = row.error;
  return {
    id: row.id,
    taskId: row.taskId,
    status: row.status,
    loadoutName: row.loadoutSnapshot.name,
    resultStatus: resultado?.status ?? null,
    summary: resultado?.summary ?? null,
    usage: toUsageSummary(resultado?.usage),
    error:
      erro === null
        ? null
        : { ...(erro.code === undefined ? {} : { code: erro.code }), message: erro.message },
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/** O Loadout pelo id ou pelo nome exato. O id ganha quando os dois casam. */
export async function resolveLoadoutRef(
  db: DatabaseExecutor,
  input: { userId: string; loadoutRef: string },
): Promise<{ id: string; name: string } | null> {
  const ref = input.loadoutRef.trim();
  if (UUID_PATTERN.test(ref)) {
    const porId = await findLoadoutRow(db, { userId: input.userId, loadoutId: ref });
    if (porId !== null) return { id: porId.id, name: porId.name };
  }
  const [porNome] = await db
    .select({ id: loadouts.id, name: loadouts.name })
    .from(loadouts)
    .where(and(eq(loadouts.userId, input.userId), eq(loadouts.name, ref)));
  return porNome ?? null;
}

export interface CreateDelegatedRunInput {
  userId: string;
  /** O Run mãe, já travado por quem chama. */
  parent: RunRow;
  /** A chave do step `delegate`; ausente na delegação pela ferramenta. */
  parentStepKey?: string | undefined;
  loadoutRef: string;
  prompt: string;
  taskStrategy: DelegationTaskStrategy;
  /**
   * Exige o nível de autonomia que libera `DELEGATE` (a ferramenta). O step
   * do Workflow não exige: quem escreveu o Ritual já decidiu delegar.
   */
  requireDelegateLevel?: boolean | undefined;
  now?: Date | undefined;
}

/** Um título de Task a partir do prompt delegado: a primeira linha, no teto. */
function tituloDaTaskFilha(prompt: string): string {
  const primeira = sanitizeCredentials(prompt)
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .find((linha) => linha.length > 0);
  const base = `Delegação: ${primeira ?? "trabalho delegado"}`;
  return base.length <= TASK_TITLE_MAX_LENGTH
    ? base
    : `${base.slice(0, TASK_TITLE_MAX_LENGTH - 1)}…`;
}

/**
 * Cria o Run filho dentro da transação de quem chama.
 *
 * `SAME` abre o filho na Task da mãe, que está em `RUNNING` por ela; `CHILD`
 * cria antes uma Task filha (`createdBy = DELEGATION`, mãe = a Task da mãe)
 * e o filho roda nela. O Run nasce por `createRunWithin` com
 * `createdBy = DELEGATION`, `parent_run_id` e `parent_step_key`, e passa
 * pelas mesmas recusas de `POST /runs`.
 */
export async function createDelegatedRun(
  tx: DatabaseExecutor,
  input: CreateDelegatedRunInput,
): Promise<Result<RunCreated, DelegationFailure>> {
  const { parent } = input;
  const now = input.now ?? new Date();

  if (parent.status !== "RUNNING") {
    return failed<DelegationFailure>({
      code: "PARENT_NOT_RUNNING",
      parentRunId: parent.id,
      status: parent.status,
    });
  }

  const [task] = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, parent.taskId), eq(tasks.userId, input.userId)));
  if (task === undefined) throw new Error(`A Task ${parent.taskId} do Run ${parent.id} sumiu.`);

  if (input.requireDelegateLevel === true) {
    const [project] =
      task.projectId === null
        ? []
        : await tx
            .select({ autonomyLevel: projects.autonomyLevel })
            .from(projects)
            .where(and(eq(projects.id, task.projectId), eq(projects.userId, input.userId)));
    const nivel = project?.autonomyLevel ?? 0;
    if (!allowsAutomation(nivel, "DELEGATE")) {
      return failed<DelegationFailure>({ code: "DELEGATION_NOT_ALLOWED", autonomyLevel: nivel });
    }
  }

  const loadout = await resolveLoadoutRef(tx, {
    userId: input.userId,
    loadoutRef: input.loadoutRef,
  });
  if (loadout === null) {
    return failed<DelegationFailure>({
      code: "LOADOUT_REF_NOT_FOUND",
      loadoutRef: input.loadoutRef,
    });
  }

  // ---------------------------------------------------------- a Task filha
  let taskId = task.id;
  if (input.taskStrategy === "CHILD") {
    if (task.projectId === null) {
      throw new Error(`A Task ${task.id} do Run ${parent.id} não tem Project.`);
    }
    const [filha] = await tx
      .insert(tasks)
      .values({
        id: newId(),
        userId: input.userId,
        projectId: task.projectId,
        parentTaskId: task.id,
        title: tituloDaTaskFilha(input.prompt),
        description: sanitizeCredentials(input.prompt),
        kind: task.kind,
        priority: task.priority,
        status: "READY",
        createdBy: "DELEGATION",
      })
      .returning();
    if (filha === undefined) throw new Error("A inserção em task não devolveu linha.");
    taskId = filha.id;

    await recordDomainEvent(tx, {
      userId: input.userId,
      projectId: filha.projectId,
      taskId: filha.id,
      taskTitle: filha.title,
      type: "task.created",
      payload: {
        taskId: filha.id,
        projectId: filha.projectId,
        parentTaskId: filha.parentTaskId,
        workflowId: filha.workflowId,
        status: filha.status,
        kind: filha.kind,
        createdBy: filha.createdBy,
        parentRunId: parent.id,
        ...(input.parentStepKey === undefined ? {} : { parentStepKey: input.parentStepKey }),
      },
    });
  }

  const criado = await createRunWithin(tx, {
    userId: input.userId,
    taskId,
    loadoutId: loadout.id,
    prompt: input.prompt,
    createdBy: "DELEGATION",
    parentRunId: parent.id,
    ...(input.parentStepKey === undefined ? {} : { parentStepKey: input.parentStepKey }),
  });
  if (criado === null) {
    throw new Error(`A Task ${taskId} sumiu entre a checagem e a criação do Run filho.`);
  }
  if (!criado.ok) return criado;

  const diagnostico: DiagnosticEvent = {
    type: "Diagnostic",
    timestamp: now.toISOString(),
    harness: criado.value.harnessKey,
    level: "INFO",
    source: "RUNTIME",
    code: "DELEGATED_FROM",
    message:
      `Run filho aberto pelo Run ${parent.id}` +
      (input.parentStepKey === undefined
        ? " pela ferramenta de delegação."
        : ` no passo ${input.parentStepKey}.`) +
      ` Loadout "${loadout.name}"; Task ${taskId === task.id ? "da mãe" : "filha"}.`,
  };
  await insertRunEvent(tx, {
    userId: input.userId,
    runId: criado.value.id,
    event: { type: diagnostico.type, timestamp: now, payload: diagnostico },
  });

  return ok(criado.value);
}

export interface OpenDelegationInput {
  userId: string;
  parentRunId: string;
  stepKey: string;
  loadoutRef: string;
  prompt: string;
  taskStrategy: DelegationTaskStrategy;
}

export interface OpenedDelegation {
  readonly child: ChildRunView;
  /** `false` quando o step já tinha um filho e nada foi escrito. */
  readonly created: boolean;
}

/**
 * O step `delegate` abrindo o Run filho: tudo ou nada.
 *
 * Trava o Run mãe, exige mãe e step em `RUNNING`, reencontra um filho que já
 * exista para o step (e não escreve nada), ou cria o filho e leva step e Run
 * a `WAITING_CHILD` no mesmo COMMIT — com `DELEGATION_STARTED` no diário e
 * `delegation.started` no painel. Devolve `null` quando o Run não existe.
 */
export async function openDelegation(
  db: Database,
  input: OpenDelegationInput,
): Promise<Result<OpenedDelegation, DelegationFailure> | null> {
  return await db.transaction(async (tx) => {
    const parent = await lockRunRow(tx, { userId: input.userId, runId: input.parentRunId });
    if (parent === null) return null;

    const existente = await findChildRunRowByStep(tx, {
      userId: input.userId,
      parentRunId: parent.id,
      parentStepKey: input.stepKey,
    });
    if (existente !== null) return ok({ child: toChildRunView(existente), created: false });

    if (parent.status !== "RUNNING") {
      return failed<DelegationFailure>({
        code: "PARENT_NOT_RUNNING",
        parentRunId: parent.id,
        status: parent.status,
      });
    }
    const step = await findRunStepRow(tx, {
      userId: input.userId,
      runId: parent.id,
      stepKey: input.stepKey,
    });
    if (step === null || step.status !== "RUNNING") {
      return failed<DelegationFailure>({
        code: "PARENT_STEP_NOT_RUNNING",
        parentRunId: parent.id,
        stepKey: input.stepKey,
      });
    }

    const agora = new Date();
    const criado = await createDelegatedRun(tx, {
      userId: input.userId,
      parent,
      parentStepKey: input.stepKey,
      loadoutRef: input.loadoutRef,
      prompt: input.prompt,
      taskStrategy: input.taskStrategy,
      now: agora,
    });
    if (!criado.ok) return criado;

    const stepMoved = await applyRunStepTransition(tx, {
      userId: input.userId,
      runId: parent.id,
      stepKey: input.stepKey,
      from: "RUNNING",
      to: "WAITING_CHILD",
    });
    if (stepMoved === null || !stepMoved.ok) {
      throw new Error(
        `O RunStep ${step.id} recusou a espera pelo filho: ${JSON.stringify(stepMoved?.failure ?? null)}`,
      );
    }
    const runMoved = await applyRunStatus(tx, {
      userId: input.userId,
      run: parent,
      to: "WAITING_CHILD",
    });
    if (!runMoved.ok) {
      throw new Error(
        `O Run ${parent.id} recusou a espera pelo filho: ${JSON.stringify(runMoved.failure)}`,
      );
    }

    const diagnostico: DiagnosticEvent = {
      type: "Diagnostic",
      timestamp: agora.toISOString(),
      harness: parent.harnessKey,
      level: "INFO",
      source: "RUNTIME",
      code: "DELEGATION_STARTED",
      message:
        `Passo «${step.name}» (${step.key}) delegou ao Run filho ${criado.value.id} ` +
        `com o Loadout "${criado.value.loadoutSnapshot.name}"; o Run espera o desfecho dele.`,
    };
    await insertRunEvent(tx, {
      userId: input.userId,
      runId: parent.id,
      event: { type: diagnostico.type, timestamp: agora, payload: diagnostico },
    });

    const [task] = await tx
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, parent.taskId));
    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "delegation.started",
      payload: {
        runId: parent.id,
        childRunId: criado.value.id,
        childTaskId: criado.value.taskId,
        stepKey: step.key,
        taskId: parent.taskId,
        projectId: task?.projectId ?? null,
        loadoutId: criado.value.loadoutId,
        taskStrategy: input.taskStrategy,
      },
    });

    const filho = await findRunRow(tx, { userId: input.userId, runId: criado.value.id });
    if (filho === null) throw new Error("O Run filho recém-criado não foi reencontrado.");
    return ok({ child: toChildRunView(filho), created: true });
  });
}

/** O filho de um step `delegate`, como o motor o vê ao reclamar o Run mãe. */
export async function findChildRunByStep(
  db: DatabaseExecutor,
  input: { userId: string; parentRunId: string; parentStepKey: string },
): Promise<ChildRunView | null> {
  const row = await findChildRunRowByStep(db, input);
  return row === null ? null : toChildRunView(row);
}

/**
 * Um filho pelo id, **só se for filho deste Run mãe**: é o que `await_run`
 * consulta, e um id de outro Run recebe "não encontrado", nunca o Run.
 */
export async function findChildRunOf(
  db: DatabaseExecutor,
  input: { userId: string; parentRunId: string; childRunId: string },
): Promise<ChildRunView | null> {
  const [row] = await db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.userId, input.userId),
        eq(runs.id, input.childRunId),
        eq(runs.parentRunId, input.parentRunId),
      ),
    );
  return row === undefined ? null : toChildRunView(row);
}
