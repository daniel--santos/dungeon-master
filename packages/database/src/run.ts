import {
  type HarnessKey,
  type Run,
  type RunError,
  type RunListItem,
  type RunResult,
  type RunStatus,
  type WorkspaceKind,
} from "@dungeon-master/contracts";
import {
  checkRunCreation,
  checkRunTransition,
  checkTaskTransition,
  isPreExecutionRunStatus,
  isTerminalRunStatus,
  type RunCreationRejection,
  type RunTransitionRejection,
  type TaskTransitionRejection,
  taskStatusForRunTransition,
} from "@dungeon-master/domain";
import {
  type EventsLogger,
  requireTerminalStatusWrite,
  sanitizeJson,
} from "@dungeon-master/events";
import { and, asc, count, desc, eq, inArray, type SQL, sql } from "drizzle-orm";

import { recordDomainEvent } from "./activity.js";
import { findAgentRow } from "./agent.js";
import type { Database } from "./client.js";
import type { DatabaseExecutor } from "./dashboard-event.js";
import { findExecutionProfileRow, toExecutionProfileSnapshot } from "./execution-profile.js";
import { findHarnessRow } from "./harness.js";
import { newId } from "./ids.js";
import { buildLoadoutSnapshot, findLoadoutRow } from "./loadout.js";
import { failed, ok, type PageInput, type PageResult, type Result } from "./result.js";
import { projects } from "./schema/project.js";
import { type RunRow, runs } from "./schema/run.js";
import { runSteps } from "./schema/run-step.js";
import { taskDependencies, tasks } from "./schema/task.js";
import { insertRunEvent, type RunEventInput } from "./run-event.js";
import { persistRunResultOutputs } from "./run-result-outputs.js";
import { captureWorkflowVersion } from "./workflow.js";
import { releaseWorkspaceLock } from "./workspace-lock.js";

/**
 * Run: a tentativa concreta de realizar uma Task.
 *
 * **A fila é esta tabela.** `status = 'QUEUED'` é o que `claimNextQueuedRun`
 * reclama com `FOR UPDATE SKIP LOCKED`. Uma tabela de fila separada precisaria
 * de uma segunda verdade sobre o mesmo fato, e as duas divergiriam no primeiro
 * crash entre o `INSERT` na fila e o `UPDATE` no Run.
 */

export function toRun(row: RunRow, projectId: string | null): Run {
  return {
    id: row.id,
    taskId: row.taskId,
    projectId,
    status: row.status,
    harnessKey: row.harnessKey,
    harnessVersion: row.harnessVersion,
    harnessSessionId: row.harnessSessionId,
    modelKey: row.modelKey,
    executionMode: row.executionMode,
    workspacePath: row.workspacePath,
    workflowVersionId: row.workflowVersionId,
    resumedFromRunId: row.resumedFromRunId,
    loadoutId: row.loadoutId,
    loadoutVersion: row.loadoutVersion,
    loadoutSnapshot: row.loadoutSnapshot,
    executionProfileSnapshot: row.executionProfileSnapshot,
    prompt: row.prompt,
    attempt: row.attempt,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
    result: row.result,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// --------------------------------------------------------------------------
// Falhas de regra
// --------------------------------------------------------------------------

export type RunWriteFailure =
  | { readonly code: "LOADOUT_NOT_FOUND"; readonly loadoutId: string }
  | { readonly code: "EXECUTION_PROFILE_NOT_FOUND"; readonly executionProfileId: string }
  | { readonly code: "EXECUTION_PROFILE_DISABLED"; readonly executionProfileId: string }
  | { readonly code: "HARNESS_DISABLED"; readonly harnessId: string }
  | { readonly code: "LOADOUT_BROKEN"; readonly loadoutId: string; readonly missing: string }
  | { readonly code: "RUN_NOT_ALLOWED"; readonly rejection: RunCreationRejection }
  | { readonly code: "TASK_TRANSITION_REJECTED"; readonly rejection: TaskTransitionRejection }
  | { readonly code: "RUN_TRANSITION_REJECTED"; readonly rejection: RunTransitionRejection }
  | { readonly code: "RUN_ALREADY_FINISHED"; readonly status: RunStatus }
  | { readonly code: "LOADOUT_REQUIRED" }
  | { readonly code: "RESUME_SOURCE_NOT_FOUND"; readonly runId: string }
  | { readonly code: "RESUME_SOURCE_WITHOUT_SESSION"; readonly runId: string }
  | { readonly code: "RESUME_UNSUPPORTED"; readonly harnessKey: string }
  | {
      /** A Task aponta para um Workflow que não existe mais para este usuário. */
      readonly code: "WORKFLOW_NOT_FOUND";
      readonly workflowId: string;
    };

// --------------------------------------------------------------------------
// Leitura
// --------------------------------------------------------------------------

export async function findRunRow(
  db: DatabaseExecutor,
  input: { userId: string; runId: string },
): Promise<RunRow | null> {
  const [row] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, input.runId), eq(runs.userId, input.userId)));

  return row ?? null;
}

export async function getRun(
  db: DatabaseExecutor,
  input: { userId: string; runId: string },
): Promise<Run | null> {
  const [row] = await db
    .select({ run: runs, projectId: tasks.projectId })
    .from(runs)
    .innerJoin(tasks, eq(tasks.id, runs.taskId))
    .where(and(eq(runs.id, input.runId), eq(runs.userId, input.userId)));

  return row === undefined ? null : toRun(row.run, row.projectId);
}

export interface RunFilters {
  taskId?: string | undefined;
  projectId?: string | undefined;
  harnessKey?: HarnessKey | undefined;
  status?: readonly RunStatus[] | undefined;
}

export interface ListRunsInput extends PageInput {
  userId: string;
  filters?: RunFilters;
}

/**
 * A listagem, do Run mais recente para o mais antigo.
 *
 * O desempate por `id` é obrigatório e vem na mesma direção: sem ele, dois Runs
 * criados no mesmo milissegundo poderiam trocar de lugar entre uma página e a
 * seguinte, e um apareceria duas vezes ou nenhuma.
 *
 * O título da Task sai na mesma junção que já traz o `projectId`. Ele custa uma
 * coluna e poupa uma leitura por linha na tabela da web; o `total` do rodapé
 * também passa a considerar o filtro por Harness, que antes era aplicado só
 * sobre a página recebida.
 */
export async function listRuns(
  db: DatabaseExecutor,
  input: ListRunsInput,
): Promise<PageResult<RunListItem>> {
  const filters = input.filters ?? {};
  const conditions: SQL[] = [eq(runs.userId, input.userId)];

  if (filters.taskId !== undefined) conditions.push(eq(runs.taskId, filters.taskId));
  if (filters.projectId !== undefined) conditions.push(eq(tasks.projectId, filters.projectId));
  if (filters.harnessKey !== undefined) conditions.push(eq(runs.harnessKey, filters.harnessKey));
  if (filters.status !== undefined && filters.status.length > 0) {
    conditions.push(inArray(runs.status, [...filters.status]));
  }

  const where = and(...conditions);

  const rows = await db
    .select({ run: runs, projectId: tasks.projectId, taskTitle: tasks.title })
    .from(runs)
    .innerJoin(tasks, eq(tasks.id, runs.taskId))
    .where(where)
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db
    .select({ total: count() })
    .from(runs)
    .innerJoin(tasks, eq(tasks.id, runs.taskId))
    .where(where);

  return {
    items: rows.map((row) => ({ ...toRun(row.run, row.projectId), taskTitle: row.taskTitle })),
    total: counted?.total ?? 0,
  };
}

// --------------------------------------------------------------------------
// Transição, com a Task junto
// --------------------------------------------------------------------------

export interface ApplyRunStatusInput {
  userId: string;
  run: RunRow;
  to: RunStatus;
  /** Escrito junto da transição, quando houver. */
  patch?: {
    harnessVersion?: string | null;
    harnessSessionId?: string | null;
    workspacePath?: string | null;
    result?: RunResult | null;
    error?: RunError | null;
  };
}

/**
 * Move o Run e leva a Task junto, na mesma transação.
 *
 * Task e Run não têm transição 1:1 (documento técnico, seção 36): quem traduz
 * uma máquina na outra é `taskStatusForRun`, em `@dungeon-master/domain`. Aqui
 * só se aplica o que ele decidiu, e as duas escritas mais o diário mais o
 * evento de dashboard saem juntos ou não saem.
 *
 * A Task só é movida se a aresta existir e ela ainda não estiver no destino: um
 * Run indo de `PREPARING` para `RUNNING` mantém a Task em `RUNNING`, e insistir
 * na transição daria `INVALID_TRANSITION` num caminho que está correto.
 *
 * **Toda checagem acontece antes da primeira escrita.** Uma recusa devolvida
 * depois de o Run já ter sido atualizado sairia da transação sem exceção, e o
 * COMMIT gravaria metade da mudança: Run terminado com a Task ainda em
 * `RUNNING`. Aqui, quando a função devolve `failed`, nada foi escrito.
 *
 * Exportada para os repositórios que movem o Run dentro da própria transação
 * — o gate de aprovação, que o leva a `WAITING_APPROVAL` e o devolve a
 * `QUEUED` —, e não para a API: as portas públicas continuam sendo
 * `transitionRun` e `writeRunTerminalStatus`.
 */
export async function applyRunStatus(
  db: DatabaseExecutor,
  input: ApplyRunStatusInput,
): Promise<Result<RunRow, RunWriteFailure>> {
  const { run, to } = input;

  const check = checkRunTransition(run.status, to);
  if (!check.ok) {
    return failed<RunWriteFailure>({ code: "RUN_TRANSITION_REJECTED", rejection: check.rejection });
  }

  const agora = new Date();
  const patch = input.patch ?? {};

  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, run.taskId), eq(tasks.userId, input.userId)));

  if (task === undefined) throw new Error(`A Task ${run.taskId} do Run ${run.id} sumiu.`);

  // O veredito que decide o destino da Task é o que **vai** ficar gravado: o do
  // patch, quando ele traz um, e o que já estava quando não traz.
  const resultado = patch.result === undefined ? run.result : patch.result;

  // post-mortem #7 (08/09/2026): as filhas eram lidas só depois de `alvo`, e
  // `taskStatusForRunTransition` decidia sem elas. Uma Task mãe com subtarefa
  // aberta recebia `COMPLETED` como alvo e `checkTaskTransition` recusava logo
  // abaixo com `CHILDREN_NOT_SETTLED`: o Run terminava bem e nunca gravava o
  // desfecho. A leitura subiu para antes da decisão, pelo índice
  // `task_parent_idx`, e o mesmo valor serve às duas.
  const filhas = await db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.userId, input.userId), eq(tasks.parentTaskId, task.id)));

  const alvo = taskStatusForRunTransition({
    from: run.status,
    to,
    resultStatus: resultado?.status ?? null,
    children: filhas,
  });
  const moveTask = alvo !== null && alvo !== task.status;

  if (moveTask) {
    const dependencias = await db
      .select({ id: tasks.id, status: tasks.status })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
      .where(and(eq(taskDependencies.userId, input.userId), eq(taskDependencies.taskId, task.id)));

    const taskCheck = checkTaskTransition({
      from: task.status,
      to: alvo,
      children: filhas,
      dependencies: dependencias,
    });

    if (!taskCheck.ok) {
      return failed<RunWriteFailure>({
        code: "TASK_TRANSITION_REJECTED",
        rejection: taskCheck.rejection,
      });
    }
  }

  const [atualizado] = await db
    .update(runs)
    .set({
      status: to,
      ...(to === "RUNNING" && run.startedAt === null ? { startedAt: agora } : {}),
      ...(isTerminalRunStatus(to) ? { finishedAt: agora } : {}),
      ...(patch.harnessVersion === undefined ? {} : { harnessVersion: patch.harnessVersion }),
      ...(patch.harnessSessionId === undefined ? {} : { harnessSessionId: patch.harnessSessionId }),
      ...(patch.workspacePath === undefined ? {} : { workspacePath: patch.workspacePath }),
      // post-mortem #8 (08/09/2026): `result` era gravado cru enquanto `error`
      // logo abaixo já passava pelo sanitizador, e o irmão
      // `applyRunStepTransition` sanitizava os dois. O `summary` do agente é
      // exatamente onde um token aparece por acidente (eco de um `git remote
      // -v`, de um `curl`, de um `env`), e daqui ele circula: volta em
      // `GET /runs/{id}`, é reinjetado no prompt de todo Run seguinte da Task
      // por `latestResultSummary` e entra no prompt do Distiller por
      // `loadRunTranscripts`. A coluna é append-only na prática: uma
      // credencial que entrar fica.
      ...(patch.result === undefined
        ? {}
        : {
            result: patch.result === null ? null : (sanitizeJson(patch.result) as RunResult),
          }),
      ...(patch.error === undefined
        ? {}
        : { error: patch.error === null ? null : (sanitizeJson(patch.error) as RunError) }),
    })
    .where(and(eq(runs.id, run.id), eq(runs.userId, input.userId)))
    .returning();

  if (atualizado === undefined) throw new Error("A atualização de run não devolveu linha.");

  await recordDomainEvent(db, {
    userId: input.userId,
    projectId: task.projectId,
    taskId: task.id,
    taskTitle: task.title,
    type: "run.status_changed",
    payload: {
      runId: atualizado.id,
      taskId: task.id,
      projectId: task.projectId,
      from: run.status,
      to,
      attempt: atualizado.attempt,
    },
  });

  if (moveTask && alvo !== null) {
    await db
      .update(tasks)
      .set({
        status: alvo,
        ...(alvo === "COMPLETED" ? { completedAt: agora } : {}),
      })
      .where(and(eq(tasks.id, task.id), eq(tasks.userId, input.userId)));

    await recordDomainEvent(db, {
      userId: input.userId,
      projectId: task.projectId,
      taskId: task.id,
      taskTitle: task.title,
      type: "task.status_changed",
      payload: {
        taskId: task.id,
        projectId: task.projectId,
        from: task.status,
        to: alvo,
        runId: atualizado.id,
      },
    });
  }

  return ok(atualizado);
}

// --------------------------------------------------------------------------
// Criação
// --------------------------------------------------------------------------

export interface CreateRunInput {
  userId: string;
  taskId: string;
  /** Só pode faltar com `resumeFromRunId`, de onde o Loadout é copiado. */
  loadoutId?: string | undefined;
  /** Sobrepõe o ExecutionProfile do Loadout, sem alterar o Loadout. */
  executionProfileId?: string | undefined;
  /** Ausente monta o prompt a partir do título e da descrição da Task. */
  prompt?: string | undefined;
  /**
   * Retoma a sessão do harness deste Run.
   *
   * A retomada é sempre um Run **novo**, com `attempt` maior: um Run é uma
   * tentativa concreta, e reabrir a tentativa antiga apagaria o que ela já
   * contou. O vínculo fica em `resumed_from_run_id`, e é de lá que o Worker lê
   * o `harness_session_id` a passar para a CLI.
   */
  resumeFromRunId?: string | undefined;
}

/**
 * Monta o prompt padrão a partir da Task.
 *
 * O título sozinho quase nunca basta, e pedir ao usuário que reescreva a
 * descrição da Task no campo de prompt seria pedir a mesma coisa duas vezes.
 */
export function defaultRunPrompt(task: { title: string; description: string | null }): string {
  const descricao = task.description?.trim() ?? "";
  return descricao === "" ? task.title : `${task.title}\n\n${descricao}`;
}

/**
 * Cria um Run já em `QUEUED` e leva a Task junto.
 *
 * O Run nasce em `CREATED` e vai a `QUEUED` na mesma transação, em vez de
 * nascer direto em `QUEUED`: a aresta `CREATED → QUEUED` da máquina de estados
 * é percorrida de verdade, e o log de `run.status_changed` conta a história
 * desde o começo em vez de começar no meio.
 */
export async function createRun(
  db: Database,
  input: CreateRunInput,
): Promise<Result<Run, RunWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    // A linha da Task é travada antes de qualquer leitura: `attempt` é
    // `max + 1`, e duas criações simultâneas sem a trava calculariam o mesmo
    // número e a segunda quebraria no índice único.
    const travada = await tx.execute<{ id: string }>(
      sql`select ${tasks.id} from ${tasks}
          where ${tasks.id} = ${input.taskId} and ${tasks.userId} = ${input.userId}
          for update`,
    );
    if (travada.rows.length === 0) return null;

    const [task] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.userId, input.userId)));

    if (task === undefined) return null;

    const [project] =
      task.projectId === null
        ? []
        : await tx
            .select()
            .from(projects)
            .where(and(eq(projects.id, task.projectId), eq(projects.userId, input.userId)));

    const dependencias = await tx
      .select({ id: tasks.id, status: tasks.status })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
      .where(and(eq(taskDependencies.userId, input.userId), eq(taskDependencies.taskId, task.id)));

    const podeRodar = checkRunCreation({
      taskStatus: task.status,
      projectId: task.projectId,
      projectStatus: project?.status ?? "ARCHIVED",
      projectWorkspacePath: project?.workspacePath ?? null,
      dependencies: dependencias,
    });

    if (!podeRodar.ok) {
      return failed<RunWriteFailure>({ code: "RUN_NOT_ALLOWED", rejection: podeRodar.rejection });
    }

    // A retomada é resolvida antes do Loadout porque é ela que o fornece
    // quando o corpo não traz nenhum: "retomar a Expedição" na interface é um
    // botão só, sem escolher equipamento de novo.
    let origem: RunRow | null = null;
    if (input.resumeFromRunId !== undefined) {
      origem = await findRunRow(tx, { userId: input.userId, runId: input.resumeFromRunId });
      if (origem === null) {
        return failed<RunWriteFailure>({
          code: "RESUME_SOURCE_NOT_FOUND",
          runId: input.resumeFromRunId,
        });
      }
      if (origem.harnessSessionId === null || origem.harnessSessionId === "") {
        // Sem id de sessão não há o que retomar: o Run de origem nunca chegou a
        // ter uma conversa com o harness, e mandar `--resume` sem id faria a
        // CLI abrir uma sessão nova fingindo continuidade.
        return failed<RunWriteFailure>({
          code: "RESUME_SOURCE_WITHOUT_SESSION",
          runId: origem.id,
        });
      }
      if (!origem.loadoutSnapshot.harness.capabilities.resume) {
        return failed<RunWriteFailure>({
          code: "RESUME_UNSUPPORTED",
          harnessKey: origem.harnessKey,
        });
      }
    }

    const loadoutId = input.loadoutId ?? origem?.loadoutId;
    if (loadoutId === undefined) {
      return failed<RunWriteFailure>({ code: "LOADOUT_REQUIRED" });
    }

    const loadout = await findLoadoutRow(tx, { userId: input.userId, loadoutId });
    if (loadout === null) {
      return failed<RunWriteFailure>({ code: "LOADOUT_NOT_FOUND", loadoutId });
    }

    const agent = await findAgentRow(tx, { userId: input.userId, agentId: loadout.agentId });
    if (agent === null) {
      return failed<RunWriteFailure>({
        code: "LOADOUT_BROKEN",
        loadoutId: loadout.id,
        missing: "agent",
      });
    }

    const harness = await findHarnessRow(tx, {
      userId: input.userId,
      harnessId: loadout.harnessId,
    });
    if (harness === null) {
      return failed<RunWriteFailure>({
        code: "LOADOUT_BROKEN",
        loadoutId: loadout.id,
        missing: "harness",
      });
    }
    if (!harness.enabled) {
      return failed<RunWriteFailure>({ code: "HARNESS_DISABLED", harnessId: harness.id });
    }

    // A ordem é a da especificidade: o que o corpo pediu, depois o perfil que o
    // Run de origem de fato usou, e só então o do Loadout. Retomar com um
    // perfil diferente do original mudaria o ambiente no meio da conversa.
    const executionProfileId =
      input.executionProfileId ??
      origem?.executionProfileSnapshot.executionProfileId ??
      loadout.executionProfileId;
    const profile = await findExecutionProfileRow(tx, { userId: input.userId, executionProfileId });
    if (profile === null) {
      return failed<RunWriteFailure>({ code: "EXECUTION_PROFILE_NOT_FOUND", executionProfileId });
    }
    if (!profile.enabled) {
      return failed<RunWriteFailure>({ code: "EXECUTION_PROFILE_DISABLED", executionProfileId });
    }

    const capturedAt = new Date();
    const loadoutSnapshot = await buildLoadoutSnapshot(tx, {
      loadout,
      agent,
      harness,
      capturedAt,
    });

    // A captura congelada (planejamento v0.4, Fase 4): a definição vigente do
    // Workflow da Task vira uma versão imutável **nesta transação**, e é ela
    // que o Run referencia. Editar o Workflow depois não alcança este Run.
    const captured =
      task.workflowId === null
        ? null
        : await captureWorkflowVersion(tx, { userId: input.userId, workflowId: task.workflowId });
    if (task.workflowId !== null && captured === null) {
      return failed<RunWriteFailure>({ code: "WORKFLOW_NOT_FOUND", workflowId: task.workflowId });
    }

    const [ultimo] = await tx
      .select({ maior: sql<number>`coalesce(max(${runs.attempt}), 0)` })
      .from(runs)
      .where(eq(runs.taskId, task.id));

    const attempt = Number(ultimo?.maior ?? 0) + 1;

    const [criado] = await tx
      .insert(runs)
      .values({
        id: newId(),
        userId: input.userId,
        taskId: task.id,
        status: "CREATED",
        harnessKey: harness.key,
        modelKey: loadoutSnapshot.model?.key ?? null,
        executionMode: profile.mode,
        loadoutId: loadout.id,
        loadoutVersion: loadout.version,
        loadoutSnapshot,
        executionProfileSnapshot: toExecutionProfileSnapshot(profile, capturedAt),
        ...(origem === null ? {} : { resumedFromRunId: origem.id }),
        ...(captured === null ? {} : { workflowVersionId: captured.version.id }),
        prompt: input.prompt ?? defaultRunPrompt(task),
        attempt,
      })
      .returning();

    if (criado === undefined) throw new Error("A inserção em run não devolveu linha.");

    // Os RunSteps nascem em `PENDING` junto do Run: um Run com versão e sem
    // steps seria um Run que o motor não sabe por onde começar.
    if (captured !== null && captured.steps.length > 0) {
      await tx.insert(runSteps).values(
        captured.steps.map((step) => ({
          id: newId(),
          userId: input.userId,
          runId: criado.id,
          workflowStepId: step.id,
          key: step.key,
          name: step.name,
          type: step.type,
          position: step.position,
          status: "PENDING" as const,
          attempt: 0,
        })),
      );
    }

    await recordDomainEvent(tx, {
      userId: input.userId,
      projectId: task.projectId,
      taskId: task.id,
      taskTitle: task.title,
      type: "run.created",
      payload: {
        runId: criado.id,
        taskId: task.id,
        projectId: task.projectId,
        loadoutId: loadout.id,
        loadoutVersion: loadout.version,
        harnessKey: harness.key,
        executionMode: profile.mode,
        attempt,
        ...(origem === null ? {} : { resumedFromRunId: origem.id }),
        ...(captured === null
          ? {}
          : {
              workflowVersionId: captured.version.id,
              workflowVersion: captured.version.version,
              stepCount: captured.steps.length,
            }),
      },
    });

    const enfileirado = await applyRunStatus(tx, {
      userId: input.userId,
      run: criado,
      to: "QUEUED",
    });

    if (!enfileirado.ok) {
      // `checkRunCreation` já garantiu Task em `READY`/`FAILED` com dependências
      // `COMPLETED`, e as duas arestas para `QUEUED` existem. Chegar aqui é
      // defeito, não estado: lançar aborta a transação e desfaz o Run inserido,
      // em vez de deixar um Run em `CREATED` que ninguém nunca vai reclamar.
      throw new Error(
        `O Run recém-criado da Task ${task.id} não pôde ser enfileirado: ` +
          JSON.stringify(enfileirado.failure),
      );
    }

    return ok(toRun(enfileirado.value, task.projectId));
  });
}

// --------------------------------------------------------------------------
// Fila
// --------------------------------------------------------------------------

export interface ClaimedRun {
  readonly run: Run;
  /** O workspace em que o Run vai rodar. Nulo é impossível: a criação exigiu. */
  readonly project: {
    readonly id: string;
    readonly workspaceKind: WorkspaceKind;
    readonly workspacePath: string | null;
  };
  readonly task: { readonly id: string; readonly title: string };
}

/**
 * Reclama o Run mais antigo da fila e o leva a `PREPARING`.
 *
 * `FOR UPDATE SKIP LOCKED` é o que faz dois workers pegarem Runs diferentes em
 * vez de um esperar o outro: a linha já travada é pulada, não disputada. É o
 * padrão de fila em PostgreSQL do planejamento v0.4, seção 3.5.
 *
 * A Task vai junto para `RUNNING`, porque `PREPARING` já é trabalho em curso do
 * ponto de vista de quem olha o quadro.
 *
 * Runs com `cancel_requested_at` marcado são pulados: a API só deixa esse campo
 * preenchido em `QUEUED` no instante entre o pedido e a transição imediata, mas
 * reclamar um Run que alguém acabou de cancelar seria subir processo para
 * matá-lo em seguida.
 */
export async function claimNextQueuedRun(
  db: Database,
  input: { userId?: string; claimedBy?: string } = {},
): Promise<ClaimedRun | null> {
  return await db.transaction(async (tx) => {
    const escopo = input.userId === undefined ? sql`` : sql` and ${runs.userId} = ${input.userId}`;

    const candidato = await tx.execute<{ id: string }>(
      sql`select ${runs.id} from ${runs}
          where ${runs.status} = 'QUEUED' and ${runs.cancelRequestedAt} is null${escopo}
          order by ${runs.createdAt} asc, ${runs.id} asc
          for update skip locked
          limit 1`,
    );

    const id = candidato.rows[0]?.id;
    if (id === undefined) return null;

    const [row] = await tx.select().from(runs).where(eq(runs.id, id));
    if (row === undefined) return null;

    // A marca de dono sai na **mesma transação** do `PREPARING`. Gravá-la
    // depois deixaria uma janela em que o Run já está em preparação e ninguém
    // o reclama como seu — que é exatamente o estado que a reconciliação de
    // partida trata como órfão.
    if (input.claimedBy !== undefined) {
      await tx.update(runs).set({ claimedBy: input.claimedBy }).where(eq(runs.id, row.id));
      row.claimedBy = input.claimedBy;
    }

    const aplicado = await applyRunStatus(tx, {
      userId: row.userId,
      run: row,
      to: "PREPARING",
    });

    if (!aplicado.ok) {
      // A máquina de estados recusou uma transição que a consulta garantiu ser
      // possível: é defeito, não estado. Abortar a transação devolve o Run à
      // fila em vez de deixá-lo num limbo.
      throw new Error(
        `Run ${id} em QUEUED recusou a ida para PREPARING: ${JSON.stringify(aplicado.failure)}`,
      );
    }

    const [contexto] = await tx
      .select({
        taskId: tasks.id,
        taskTitle: tasks.title,
        projectId: projects.id,
        workspaceKind: projects.workspaceKind,
        workspacePath: projects.workspacePath,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(eq(tasks.id, row.taskId));

    if (contexto === undefined) {
      throw new Error(`O Run ${id} aponta para uma Task sem Project: não há onde executar.`);
    }

    return {
      run: toRun(aplicado.value, contexto.projectId),
      project: {
        id: contexto.projectId,
        workspaceKind: contexto.workspaceKind,
        workspacePath: contexto.workspacePath,
      },
      task: { id: contexto.taskId, title: contexto.taskTitle },
    };
  });
}

/** Quantos Runs esperam na fila. Usada pelo worker para decidir se dorme. */
export async function countQueuedRuns(
  db: DatabaseExecutor,
  input: { userId?: string } = {},
): Promise<number> {
  const conditions: SQL[] = [eq(runs.status, "QUEUED")];
  if (input.userId !== undefined) conditions.push(eq(runs.userId, input.userId));

  const [row] = await db
    .select({ total: count() })
    .from(runs)
    .where(and(...conditions));

  return row?.total ?? 0;
}

// --------------------------------------------------------------------------
// Transições públicas
// --------------------------------------------------------------------------

export interface TransitionRunInput {
  userId: string;
  runId: string;
  to: RunStatus;
  patch?: ApplyRunStatusInput["patch"];
  /** Eventos gravados na mesma transação da transição. */
  events?: readonly RunEventInput[];
}

/**
 * Move o Run para um estado **não terminal**.
 *
 * O terminal tem porta própria (`writeRunTerminalStatus`), porque a falha dele
 * precisa virar `TerminalStatusWriteError` e não uma recusa comum.
 */
export async function transitionRun(
  db: Database,
  input: TransitionRunInput,
): Promise<Result<Run, RunWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const row = await lockRunRow(tx, input);
    if (row === null) return null;

    const aplicado = await applyRunStatus(tx, {
      userId: input.userId,
      run: row,
      to: input.to,
      ...(input.patch === undefined ? {} : { patch: input.patch }),
    });

    if (!aplicado.ok) return aplicado;

    for (const event of input.events ?? []) {
      await insertRunEvent(tx, { userId: input.userId, runId: row.id, event });
    }

    const [task] = await tx
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, row.taskId));

    return ok(toRun(aplicado.value, task?.projectId ?? null));
  });
}

/** Trava a linha do Run para o resto da transação. */
export async function lockRunRow(
  db: DatabaseExecutor,
  input: { userId: string; runId: string },
): Promise<RunRow | null> {
  const [row] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, input.runId), eq(runs.userId, input.userId)))
    .for("update");

  return row ?? null;
}

export interface WriteRunTerminalStatusInput {
  userId: string;
  runId: string;
  /** Precisa ser um dos quatro terminais. */
  status: RunStatus;
  result?: RunResult | null;
  error?: RunError | null;
  harnessVersion?: string | null;
  harnessSessionId?: string | null;
  /** Eventos gravados na mesma transação do status. */
  events?: readonly RunEventInput[];
  logger?: EventsLogger;
}

/**
 * Grava o status terminal do Run: **tudo ou nada**.
 *
 * Na mesma transação saem o Run, a transição da Task, a linha de `activity`, o
 * `dashboard_event`, a liberação da trava de workspace e — quando há `result`
 * — as `ProposedTask`s dos `discoveredTasks` e os `KnowledgeCandidate`s dos
 * `knowledgeCandidates` (Fase 5; documento técnico, seção 21). Uma escrita
 * parcial aqui deixaria o pior estado possível: um Run terminado com a Task
 * ainda em `RUNNING`, um repositório travado por um processo que já morreu, ou
 * um resultado gravado cujas propostas se perderam em silêncio.
 *
 * Qualquer falha vira `TerminalStatusWriteError` (adaptado do Archon,
 * planejamento v0.4, seção 13.2). O tipo próprio existe porque a fronteira de
 * recuperação precisa distinguir este caso de um Run que apenas falhou: nenhum
 * resultado comum pode ser reportado pelo mesmo canal que acabou de falhar.
 *
 * @throws TerminalStatusWriteError
 */
export async function writeRunTerminalStatus(
  db: Database,
  input: WriteRunTerminalStatusInput,
): Promise<Result<Run, RunWriteFailure> | null> {
  if (!isTerminalRunStatus(input.status)) {
    throw new Error(
      `writeRunTerminalStatus só aceita estado terminal; recebi ${input.status}. ` +
        "Use transitionRun para os demais.",
    );
  }

  return await requireTerminalStatusWrite(
    db.transaction(async (tx) => {
      const row = await lockRunRow(tx, input);
      if (row === null) return null;

      const aplicado = await applyRunStatus(tx, {
        userId: input.userId,
        run: row,
        to: input.status,
        patch: {
          ...(input.result === undefined ? {} : { result: input.result }),
          ...(input.error === undefined ? {} : { error: input.error }),
          ...(input.harnessVersion === undefined ? {} : { harnessVersion: input.harnessVersion }),
          ...(input.harnessSessionId === undefined
            ? {}
            : { harnessSessionId: input.harnessSessionId }),
        },
      });

      if (!aplicado.ok) return aplicado;

      for (const event of input.events ?? []) {
        await insertRunEvent(tx, { userId: input.userId, runId: row.id, event });
      }

      // O Run acabou: o repositório precisa voltar a estar livre no mesmo
      // COMMIT. Liberar depois deixaria a janela em que a trava aponta para um
      // processo que já não existe.
      await releaseWorkspaceLock(tx, { userId: input.userId, runId: row.id });

      const [task] = await tx
        .select({ projectId: tasks.projectId })
        .from(tasks)
        .where(eq(tasks.id, row.taskId));

      // O resultado alimenta o domínio aqui, e não num job depois: uma
      // proposta ou um candidato que commitasse separado do desfecho poderia
      // se perder sem ninguém notar (CLAUDE.md, seção 9).
      if (input.result !== undefined && input.result !== null) {
        if (task?.projectId === undefined || task.projectId === null) {
          // A criação do Run exigiu um Project; chegar aqui é defeito.
          throw new Error(
            `A Task ${row.taskId} do Run ${row.id} não tem Project: não há onde gravar ` +
              "as propostas e os candidatos do resultado.",
          );
        }
        await persistRunResultOutputs(tx, {
          userId: input.userId,
          runId: row.id,
          taskId: row.taskId,
          projectId: task.projectId,
          // O que alimenta o domínio é o resultado **já gravado**, que
          // `applyRunStatus` sanitizou (post-mortem #8), e não o cru que
          // chegou: senão a mesma credencial que sai da coluna `run.result`
          // entraria de novo pelo texto das ProposedTasks e dos
          // KnowledgeCandidates.
          result: aplicado.value.result ?? input.result,
          ...(input.logger === undefined ? {} : { logger: input.logger }),
        });
      }

      return ok(toRun(aplicado.value, task?.projectId ?? null));
    }),
    {
      runId: input.runId,
      site: `run.terminal_status_${input.status.toLowerCase()}`,
      ...(input.logger === undefined ? {} : { logger: input.logger }),
    },
  );
}

/**
 * Marca o pedido de cancelamento.
 *
 * **Pedir não é cancelar.** A marca em `cancel_requested_at` é o que o worker
 * observa para matar a árvore de processos; quem transiciona para `CANCELLED` é
 * quem confirmou o término (planejamento v0.4, Fase 2A).
 *
 * A exceção é o Run que ainda não subiu nada: em `CREATED` e `QUEUED` não há
 * árvore a confirmar, então a transição sai aqui mesmo e a Task volta a
 * `READY` na mesma transação. Deixar para o worker significaria esperar o
 * próximo ciclo dele para desfazer algo que nunca começou.
 *
 * Idempotente: pedir de novo devolve o mesmo Run sem gravar um segundo fato.
 */
export async function requestRunCancellation(
  db: Database,
  input: { userId: string; runId: string },
): Promise<Result<Run, RunWriteFailure> | null> {
  return await db.transaction(async (tx) => {
    const row = await lockRunRow(tx, input);
    if (row === null) return null;

    const [task] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, row.taskId), eq(tasks.userId, input.userId)));

    if (task === undefined) throw new Error(`A Task ${row.taskId} do Run ${row.id} sumiu.`);

    if (row.status === "CANCELLED") return ok(toRun(row, task.projectId));

    if (isTerminalRunStatus(row.status)) {
      return failed<RunWriteFailure>({ code: "RUN_ALREADY_FINISHED", status: row.status });
    }

    let atual = row;

    if (row.cancelRequestedAt === null) {
      const [marcado] = await tx
        .update(runs)
        .set({ cancelRequestedAt: new Date() })
        .where(and(eq(runs.id, row.id), eq(runs.userId, input.userId)))
        .returning();

      if (marcado === undefined) throw new Error("A marcação de cancelamento não devolveu linha.");
      atual = marcado;

      await recordDomainEvent(tx, {
        userId: input.userId,
        projectId: task.projectId,
        taskId: task.id,
        taskTitle: task.title,
        type: "run.cancel_requested",
        payload: {
          runId: atual.id,
          taskId: task.id,
          projectId: task.projectId,
          status: atual.status,
        },
      });
    }

    if (!isPreExecutionRunStatus(atual.status)) {
      return ok(toRun(atual, task.projectId));
    }

    const aplicado = await applyRunStatus(tx, {
      userId: input.userId,
      run: atual,
      to: "CANCELLED",
    });

    if (!aplicado.ok) return aplicado;

    await releaseWorkspaceLock(tx, { userId: input.userId, runId: atual.id });

    return ok(toRun(aplicado.value, task.projectId));
  });
}

// --------------------------------------------------------------------------
// O que o Worker precisa e a API não
// --------------------------------------------------------------------------

export interface UpdateRunExecutionFieldsInput {
  userId: string;
  runId: string;
  harnessVersion?: string;
  harnessSessionId?: string;
  workspacePath?: string;
}

/**
 * Grava campos de execução **sem** mexer no status.
 *
 * Existe porque nem todo fato de um Run é uma transição: o worktree é criado
 * enquanto o Run está em `PREPARING`, e o id de sessão do harness costuma
 * aparecer com o Run já em `RUNNING`. Passar esses dois por `transitionRun`
 * pediria uma aresta `RUNNING → RUNNING`, que a máquina de estados não tem — e
 * com razão, porque ela não é uma transição.
 *
 * Devolve a linha, e não o contrato `Run`: o `projectId` do contrato vem de uma
 * junção com `task`, e inventar um `null` aqui seria afirmar que a Task não tem
 * Project. Quem chama é o Worker, que quer os campos, não a projeção da API.
 */
export async function updateRunExecutionFields(
  db: DatabaseExecutor,
  input: UpdateRunExecutionFieldsInput,
): Promise<RunRow | null> {
  const values = {
    ...(input.harnessVersion === undefined ? {} : { harnessVersion: input.harnessVersion }),
    ...(input.harnessSessionId === undefined ? {} : { harnessSessionId: input.harnessSessionId }),
    ...(input.workspacePath === undefined ? {} : { workspacePath: input.workspacePath }),
  };

  if (Object.keys(values).length === 0) return await findRunRow(db, input);

  const [row] = await db
    .update(runs)
    .set(values)
    .where(and(eq(runs.id, input.runId), eq(runs.userId, input.userId)))
    .returning();

  return row ?? null;
}

/**
 * Quais destes Runs têm cancelamento pedido.
 *
 * O Worker pergunta pelos Runs que ele mesmo tem em voo, e não pela tabela
 * inteira: quem não é dele não é dele para matar. Uma consulta só por tique,
 * com a lista de ids em `IN`, custa menos que uma leitura por Run.
 */
export async function listCancelRequestedRunIds(
  db: DatabaseExecutor,
  input: { userId: string; runIds: readonly string[] },
): Promise<string[]> {
  if (input.runIds.length === 0) return [];

  const rows = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.userId, input.userId),
        inArray(runs.id, [...input.runIds]),
        sql`${runs.cancelRequestedAt} is not null`,
      ),
    );

  return rows.map((row) => row.id);
}

/**
 * Runs que ficaram em execução sem um Worker vivo por trás.
 *
 * `PREPARING` e `RUNNING` são estados que só um Worker sustenta. Um Run nesses
 * estados cujo `claimed_by` não é o do processo atual é rastro de um Worker que
 * morreu: o processo do agente foi embora junto, e ninguém mais vai escrever o
 * desfecho dele.
 *
 * O `claimed_by` nulo entra na conta porque um Run reclamado por uma versão
 * anterior do sistema — antes desta coluna existir — tem exatamente a mesma
 * natureza de órfão.
 */
export async function listOrphanRunRows(
  db: DatabaseExecutor,
  input: { userId?: string; workerId: string },
): Promise<RunRow[]> {
  const conditions: SQL[] = [
    inArray(runs.status, ["PREPARING", "RUNNING"]),
    sql`(${runs.claimedBy} is null or ${runs.claimedBy} <> ${input.workerId})`,
  ];
  if (input.userId !== undefined) conditions.push(eq(runs.userId, input.userId));

  return await db
    .select()
    .from(runs)
    .where(and(...conditions))
    .orderBy(asc(runs.createdAt), asc(runs.id));
}

/** O último Run de uma Task, para a tela de detalhe. */
export async function findLatestRunForTask(
  db: DatabaseExecutor,
  input: { userId: string; taskId: string },
): Promise<Run | null> {
  const [row] = await db
    .select({ run: runs, projectId: tasks.projectId })
    .from(runs)
    .innerJoin(tasks, eq(tasks.id, runs.taskId))
    .where(and(eq(runs.userId, input.userId), eq(runs.taskId, input.taskId)))
    .orderBy(desc(runs.attempt))
    .limit(1);

  return row === undefined ? null : toRun(row.run, row.projectId);
}

/** Os Runs de uma Task, da primeira tentativa para a última. */
export async function listRunsForTask(
  db: DatabaseExecutor,
  input: { userId: string; taskId: string },
): Promise<Run[]> {
  const rows = await db
    .select({ run: runs, projectId: tasks.projectId })
    .from(runs)
    .innerJoin(tasks, eq(tasks.id, runs.taskId))
    .where(and(eq(runs.userId, input.userId), eq(runs.taskId, input.taskId)))
    .orderBy(asc(runs.attempt));

  return rows.map((row) => toRun(row.run, row.projectId));
}
