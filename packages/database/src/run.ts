import { fastEstimateTokens } from "@dungeon-master/context";
import {
  type AutonomyLevel,
  type BreakerAdmission,
  type BreakerState,
  type BudgetBreach,
  type CapabilityIssue,
  type DiagnosticEvent,
  type HarnessKey,
  type LoadoutSnapshot,
  type PolicyDecision,
  type RoutingDecision,
  type RuleFacts,
  type Run,
  type RunCreated,
  type RunCreatedBy,
  type RunError,
  type RunListItem,
  type RunResult,
  type RunStatus,
  type WorkspaceKind,
} from "@dungeon-master/contracts";
import {
  admitThroughBreaker,
  checkDelegationDepth,
  checkRunCreation,
  checkRunTransition,
  checkTaskTransition,
  decideApproval,
  isPreExecutionRunStatus,
  isTerminalRunStatus,
  LIVE_RUN_STATUSES,
  matchCapabilities,
  MAX_DELEGATION_DEPTH,
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
import { listPoliciesForDecision } from "./approval-policy.js";
import { routeModelForLoadout } from "./autonomy.js";
import { checkBudgetsForNewRun } from "./budget.js";
import {
  admitRunThroughBreakers,
  feedBreakersWithRunOutcome,
  lockApplicableBreakers,
  markBreakerProbe,
  toBreakerAdmission,
} from "./circuit-breaker.js";
import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { findExecutionProfileRow, toExecutionProfileSnapshot } from "./execution-profile.js";
import { findHarnessRow, findModelRow } from "./harness.js";
import { newId } from "./ids.js";
import { buildLoadoutSnapshot, findLoadoutRow } from "./loadout.js";
import { failed, ok, type PageInput, type PageResult, type Result } from "./result.js";
import { type CircuitBreakerRow } from "./schema/autonomy.js";
import { projects } from "./schema/project.js";
import { type RunRow, runs } from "./schema/run.js";
import { runSteps } from "./schema/run-step.js";
import { taskDependencies, tasks } from "./schema/task.js";
import { insertRunEvent, type RunEventInput } from "./run-event.js";
import { persistRunResultOutputs } from "./run-result-outputs.js";
import { KNOWLEDGE_SCRIBE_LOADOUT_NAME } from "./seed-knowledge.js";
import { readUserSettings } from "./user-setting.js";
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
    createdBy: row.createdBy,
    parentRunId: row.parentRunId,
    parentStepKey: row.parentStepKey,
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
    }
  | {
      /**
       * O capability matching (Fase 8A) achou pelo menos um blocker: o Loadout
       * pede o que o Harness não declara. A lista inteira vai no `409`.
       */
      readonly code: "CAPABILITY_BLOCKED";
      readonly blockers: readonly CapabilityIssue[];
    }
  | {
      /** Um orçamento `BLOCK` está no teto (Fase 9A). O consumo e o teto vão no `409`. */
      readonly code: "BUDGET_EXCEEDED";
      readonly breach: BudgetBreach;
    }
  | {
      /** Um disjuntor `OPEN`, ou `HALF_OPEN` com sondagem em voo, recusou (Fase 9A). */
      readonly code: "BREAKER_OPEN";
      readonly breaker: BreakerAdmission;
    }
  | {
      /** Uma política `RUN_START` com `DENY` casou (Fase 9A). */
      readonly code: "POLICY_DENIED";
      readonly decision: PolicyDecision;
    }
  | {
      /**
       * O auto-despacho (Fase 9B) exigiu `AUTO_APPROVE` da política de partida
       * e a decisão foi revisão humana: o Run não nasce sozinho.
       */
      readonly code: "POLICY_REQUIRES_APPROVAL";
      readonly decision: PolicyDecision;
    }
  | {
      /** O Run mãe de uma delegação (Fase 9B) não existe para este usuário. */
      readonly code: "PARENT_RUN_NOT_FOUND";
      readonly parentRunId: string;
    }
  | {
      /** A cadeia de delegação passaria da profundidade máxima (Fase 9B). */
      readonly code: "DELEGATION_DEPTH_EXCEEDED";
      readonly parentRunId: string;
      readonly parentDepth: number;
      readonly maxDepth: number;
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
  createdBy?: RunCreatedBy | undefined;
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
  if (filters.createdBy !== undefined) conditions.push(eq(runs.createdBy, filters.createdBy));

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

  // Um Run filho na **mesma** Task do Run mãe (Fase 9B, `taskStrategy: SAME`)
  // não move a Task em transição nenhuma: a Task está em `RUNNING` pela mãe, e
  // é o desfecho da mãe que responde por ela. Um filho numa Task filha própria
  // (`CHILD`) é acoplado como qualquer Run.
  const partilhaTaskComMae =
    run.parentRunId !== null && (await parentSharesTask(db, input.userId, run));
  const moveTask = !partilhaTaskComMae && alvo !== null && alvo !== task.status;

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

/** O Run mãe deste Run existe e roda na mesma Task? */
async function parentSharesTask(
  db: DatabaseExecutor,
  userId: string,
  run: Pick<RunRow, "parentRunId" | "taskId">,
): Promise<boolean> {
  if (run.parentRunId === null) return false;
  const [parent] = await db
    .select({ taskId: runs.taskId })
    .from(runs)
    .where(and(eq(runs.id, run.parentRunId), eq(runs.userId, userId)));
  return parent !== undefined && parent.taskId === run.taskId;
}

// --------------------------------------------------------------------------
// Parentesco (Fase 9B)
// --------------------------------------------------------------------------

/**
 * A profundidade de um Run na cadeia de delegação: 0 para um Run sem mãe, 1
 * para o filho dele, e assim por diante. Sobe pela `parent_run_id` até a
 * raiz, com o teto do domínio mais um de folga — uma cadeia mais longa que
 * o permitido é defeito, e não motivo para um laço sem fim.
 */
export async function delegationDepthOf(
  db: DatabaseExecutor,
  input: { userId: string; runId: string },
): Promise<number> {
  let depth = 0;
  let atual: string | null = input.runId;
  while (atual !== null && depth <= MAX_DELEGATION_DEPTH + 1) {
    const [row] = await db
      .select({ parentRunId: runs.parentRunId })
      .from(runs)
      .where(and(eq(runs.id, atual), eq(runs.userId, input.userId)));
    if (row === undefined || row.parentRunId === null) break;
    depth += 1;
    atual = row.parentRunId;
  }
  return depth;
}

/** Os filhos diretos de um Run, do mais antigo ao mais novo. */
export async function listChildRuns(
  db: DatabaseExecutor,
  input: { userId: string; runId: string },
): Promise<Run[]> {
  const rows = await db
    .select({ run: runs, projectId: tasks.projectId })
    .from(runs)
    .innerJoin(tasks, eq(tasks.id, runs.taskId))
    .where(and(eq(runs.userId, input.userId), eq(runs.parentRunId, input.runId)))
    .orderBy(asc(runs.createdAt), asc(runs.id));

  return rows.map((row) => toRun(row.run, row.projectId));
}

/** As linhas dos filhos diretos ainda vivos: o que um cancelamento em cascata alcança. */
export async function listLiveChildRunRows(
  db: DatabaseExecutor,
  input: { userId: string; runId: string },
): Promise<RunRow[]> {
  return await db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.userId, input.userId),
        eq(runs.parentRunId, input.runId),
        inArray(runs.status, [...LIVE_RUN_STATUSES]),
      ),
    )
    .orderBy(asc(runs.createdAt), asc(runs.id));
}

/**
 * O Run filho que um step `delegate` abriu, pela chave do step no Run mãe.
 *
 * É por este par, e não por um id guardado em memória, que o motor reencontra
 * o filho depois de um restart do Worker — nunca abre um segundo. O mais
 * antigo vence se, por defeito, houver dois.
 */
export async function findChildRunRowByStep(
  db: DatabaseExecutor,
  input: { userId: string; parentRunId: string; parentStepKey: string },
): Promise<RunRow | null> {
  const [row] = await db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.userId, input.userId),
        eq(runs.parentRunId, input.parentRunId),
        eq(runs.parentStepKey, input.parentStepKey),
      ),
    )
    .orderBy(asc(runs.createdAt), asc(runs.id))
    .limit(1);

  return row ?? null;
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
  /**
   * Origem e parentesco (Fase 9A). A API cria sempre `USER`; o auto-despacho
   * (9B) passa `POLICY`, e a delegação (9B) passa `DELEGATION` com o Run mãe
   * e o step que abriu este.
   */
  createdBy?: RunCreatedBy | undefined;
  parentRunId?: string | undefined;
  parentStepKey?: string | undefined;
  /**
   * Exige que a política de partida (`RUN_START`) decida `AUTO_APPROVE`: é o
   * auto-despacho (Fase 9B), em que ninguém pediu o Run. Uma decisão de
   * revisão humana recusa com `POLICY_REQUIRES_APPROVAL` antes do `INSERT`.
   * Pela API o campo não existe: quem pediu já aprovou.
   */
  requireAutoApproval?: boolean | undefined;
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
 * O Loadout é o do Escriba do Grimório?
 *
 * É o que decide `requiresStructuredOutput` no capability matching: o Escriba
 * responde JSON validado, e sem `structuredOutput` o lote não tem como ser
 * lido. Vale o escolhido em `knowledge.loadoutId` ou, na falta dele, o
 * semeado pelo nome — a mesma regra de `findKnowledgeScribeLoadout`.
 */
export async function isKnowledgeScribeLoadout(
  db: DatabaseExecutor,
  input: { userId: string; loadout: { id: string; name: string } },
): Promise<boolean> {
  const settings = await readUserSettings(db, { userId: input.userId });
  const escolhido = settings["knowledge.loadoutId"];
  if (escolhido !== null) return escolhido === input.loadout.id;
  return input.loadout.name === KNOWLEDGE_SCRIBE_LOADOUT_NAME;
}

/**
 * Cria um Run já em `QUEUED` e leva a Task junto.
 *
 * O Run nasce em `CREATED` e vai a `QUEUED` na mesma transação, em vez de
 * nascer direto em `QUEUED`: a aresta `CREATED → QUEUED` da máquina de estados
 * é percorrida de verdade, e o log de `run.status_changed` conta a história
 * desde o começo em vez de começar no meio.
 *
 * Antes de inserir, o capability matching (Fase 8A) compara o snapshot
 * resolvido com a matriz do Harness: um blocker recusa a criação com a lista;
 * os avisos voltam junto do Run, e o Worker os recomputa sobre os snapshots
 * congelados para gravá-los como `Diagnostic`.
 *
 * A autonomia controlada (Fase 9A) entra na mesma transação, nesta ordem:
 * os **disjuntores** do Project, do Loadout e do Harness, travados (`OPEN`
 * recusa; `HALF_OPEN` deixa passar uma sondagem); os **orçamentos**
 * aplicáveis, medidos (`BLOCK` no teto recusa; `WARN` avisa); o
 * **roteamento** do Model, quando o Loadout o deixa nulo, com a pressão de
 * orçamento como fato; e a **política de partida** (`DENY` recusa;
 * `AUTO_APPROVE` só vale no nível 3 e, para um Run pedido pela API, é só
 * registro — quem pediu já aprovou). Cada decisão vai ao painel e ao diário
 * do Run. Uma recusa devolve `failed` e commita só o evento que a explica.
 */
export async function createRun(
  db: Database,
  input: CreateRunInput,
): Promise<Result<RunCreated, RunWriteFailure> | null> {
  return await db.transaction(async (tx) => createRunWithin(tx, input));
}

/**
 * `createRun` dentro da transação de quem chama (Fase 9B).
 *
 * Existe porque a delegação e o auto-despacho criam o Run **junto** de outras
 * escritas — o step do Run mãe indo a `WAITING_CHILD`, a Task filha, o evento
 * de despacho — e uma criação que commitasse sozinha poderia deixar um Run
 * na fila cujo passo de origem nunca soube dele. As regras são exatamente as
 * de `createRun`; só a fronteira da transação muda.
 */
export async function createRunWithin(
  tx: DatabaseExecutor,
  input: CreateRunInput,
): Promise<Result<RunCreated, RunWriteFailure> | null> {
  {
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

    // ------------------------------------------------------------ parentesco
    // Um Run filho (Fase 9B) exige a mãe viva para este usuário e uma cadeia
    // dentro da profundidade máxima. Na mesma Task da mãe, a Task está em
    // `RUNNING` por ela, e é isso que o filho exige; numa Task filha própria,
    // vale a regra de sempre.
    let parent: RunRow | null = null;
    if (input.parentRunId !== undefined) {
      parent = await findRunRow(tx, { userId: input.userId, runId: input.parentRunId });
      if (parent === null) {
        return failed<RunWriteFailure>({
          code: "PARENT_RUN_NOT_FOUND",
          parentRunId: input.parentRunId,
        });
      }
      const parentDepth = await delegationDepthOf(tx, {
        userId: input.userId,
        runId: parent.id,
      });
      const profundidade = checkDelegationDepth(parentDepth);
      if (!profundidade.ok) {
        return failed<RunWriteFailure>({
          code: "DELEGATION_DEPTH_EXCEEDED",
          parentRunId: parent.id,
          parentDepth: profundidade.parentDepth,
          maxDepth: profundidade.maxDepth,
        });
      }
    }

    const podeRodar = checkRunCreation({
      taskStatus: task.status,
      projectId: task.projectId,
      projectStatus: project?.status ?? "ARCHIVED",
      projectWorkspacePath: project?.workspacePath ?? null,
      dependencies: dependencias,
      sharesTaskWithParent: parent !== null && parent.taskId === task.id,
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

    if (project === undefined) {
      // `checkRunCreation` exigiu Project ativo com workspace; chegar aqui é defeito.
      throw new Error(`A Task ${task.id} passou na checagem de criação sem Project.`);
    }

    const capturedAt = new Date();
    const agora = capturedAt;
    const prompt = input.prompt ?? defaultRunPrompt(task);
    let loadoutSnapshot: LoadoutSnapshot = await buildLoadoutSnapshot(tx, {
      loadout,
      agent,
      harness,
      capturedAt,
    });

    // ---------------------------------------------------------- disjuntores
    // Travados até o COMMIT: o retrato que decide a admissão não pode
    // envelhecer entre a consulta e a marcação da sondagem.
    const breakers = await lockApplicableBreakers(tx, {
      userId: input.userId,
      projectId: task.projectId,
      loadoutId: loadout.id,
      harnessKey: harness.key,
    });
    const admissao = admitRunThroughBreakers(breakers, agora);
    if (!admissao.admitted) {
      return failed<RunWriteFailure>({ code: "BREAKER_OPEN", breaker: admissao.refused });
    }

    // ----------------------------------------------------------- orçamentos
    const orcamentos = await checkBudgetsForNewRun(tx, {
      userId: input.userId,
      projectId: task.projectId,
      loadoutId: loadout.id,
      now: agora,
    });
    if (orcamentos.blocked !== null) {
      // O evento sai e o `failed` commita só ele: a recusa fica auditável
      // mesmo sem Run.
      await appendDashboardEvent(tx, {
        userId: input.userId,
        type: "budget.exceeded",
        payload: {
          budgetId: orcamentos.blocked.budgetId,
          name: orcamentos.blocked.name,
          taskId: task.id,
          projectId: task.projectId,
          loadoutId: loadout.id,
          limit: orcamentos.blocked.limit,
          limitValue: orcamentos.blocked.limitValue,
          current: orcamentos.blocked.current,
          decidedBy: orcamentos.blocked.decidedBy,
          reason: orcamentos.blocked.reason,
        },
      });
      return failed<RunWriteFailure>({ code: "BUDGET_EXCEEDED", breach: orcamentos.blocked });
    }

    // ---------------------------------------------------------------- fatos
    const facts: RuleFacts = {
      projectId: project.id,
      loadoutId: loadout.id,
      taskKind: task.kind,
      taskPriority: task.priority,
      executionMode: profile.mode,
      harnessKey: harness.key,
      enforcement: profile.enforcement,
      hasCommandTools: (loadoutSnapshot.toolDefinitions ?? []).some(
        (tool) => tool.kind === "COMMAND",
      ),
      estimatedTokens: fastEstimateTokens(prompt),
      budgetPressure: orcamentos.pressure,
    };

    // ----------------------------------------------------------- roteamento
    // Só quando o Loadout deixa o Model nulo: um Model pinado é decisão
    // humana, e o snapshot diz de qualquer jeito quem escolheu.
    let modelRouting: RoutingDecision | null = null;
    if (loadout.modelId === null) {
      modelRouting = await routeModelForLoadout(tx, {
        userId: input.userId,
        loadout,
        facts,
        projectId: task.projectId,
      });
      const escolhido =
        modelRouting.selectedId === null
          ? null
          : await findModelRow(tx, { userId: input.userId, modelId: modelRouting.selectedId });
      loadoutSnapshot = {
        ...loadoutSnapshot,
        model:
          escolhido === null
            ? null
            : { id: escolhido.id, key: escolhido.key, name: escolhido.name },
        modelSelectedBy:
          modelRouting.ruleId !== null
            ? modelRouting.decidedBy
            : escolhido === null
              ? "NONE"
              : "HARNESS_DEFAULT",
        modelSelectionReason: modelRouting.reason,
      };
    } else {
      loadoutSnapshot = {
        ...loadoutSnapshot,
        modelSelectedBy: "LOADOUT",
        modelSelectionReason: "O Loadout pina o Model.",
      };
    }

    // --------------------------------------------------- política de partida
    const policies = await listPoliciesForDecision(tx, {
      userId: input.userId,
      projectId: task.projectId,
    });
    const policyDecision = decideApproval({
      subject: "RUN_START",
      policies,
      facts,
      autonomyLevel: project.autonomyLevel,
      now: agora,
    });
    if (policyDecision.action === "DENY") {
      await appendDashboardEvent(tx, {
        userId: input.userId,
        type: "policy.decided",
        payload: {
          taskId: task.id,
          projectId: task.projectId,
          loadoutId: loadout.id,
          runId: null,
          ...policyDecision,
        },
      });
      return failed<RunWriteFailure>({ code: "POLICY_DENIED", decision: policyDecision });
    }
    if (input.requireAutoApproval === true && policyDecision.action !== "AUTO_APPROVE") {
      // O auto-despacho (Fase 9B) só parte com uma política que autorize e um
      // nível que libere `AUTO_DISPATCH`; revisão humana é "o usuário decide".
      await appendDashboardEvent(tx, {
        userId: input.userId,
        type: "policy.decided",
        payload: {
          taskId: task.id,
          projectId: task.projectId,
          loadoutId: loadout.id,
          runId: null,
          ...policyDecision,
        },
      });
      return failed<RunWriteFailure>({
        code: "POLICY_REQUIRES_APPROVAL",
        decision: policyDecision,
      });
    }

    const report = matchCapabilities({
      snapshot: loadoutSnapshot,
      harnessCapabilities: harness.capabilities,
      executionProfile: { mode: profile.mode },
      intent: {
        resume: origem !== null,
        requiresStructuredOutput: await isKnowledgeScribeLoadout(tx, {
          userId: input.userId,
          loadout,
        }),
      },
    });
    if (report.blockers.length > 0) {
      return failed<RunWriteFailure>({ code: "CAPABILITY_BLOCKED", blockers: report.blockers });
    }

    // A captura congelada (planejamento v0.4, Fase 4): a definição vigente do
    // Workflow da Task vira uma versão imutável **nesta transação**, e é ela
    // que o Run referencia. Editar o Workflow depois não alcança este Run.
    //
    // Um Run filho de uma delegação (Fase 9B) é sempre um Run simples, de um
    // agente só, com o prompt que a mãe lhe deu: na mesma Task da mãe, herdar
    // o Ritual dela faria o filho abrir o mesmo step `delegate` de novo — uma
    // cadeia que só a profundidade máxima interromperia.
    const capturaRitual = task.workflowId !== null && parent === null;
    const captured = capturaRitual
      ? await captureWorkflowVersion(tx, { userId: input.userId, workflowId: task.workflowId! })
      : null;
    if (capturaRitual && captured === null) {
      return failed<RunWriteFailure>({ code: "WORKFLOW_NOT_FOUND", workflowId: task.workflowId! });
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
        createdBy: input.createdBy ?? "USER",
        parentRunId: input.parentRunId ?? null,
        parentStepKey: input.parentStepKey ?? null,
        prompt,
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
        createdBy: criado.createdBy,
        ...(origem === null ? {} : { resumedFromRunId: origem.id }),
        ...(criado.parentRunId === null ? {} : { parentRunId: criado.parentRunId }),
        ...(captured === null
          ? {}
          : {
              workflowVersionId: captured.version.id,
              workflowVersion: captured.version.version,
              stepCount: captured.steps.length,
            }),
      },
    });

    // ------------------------------------------------ sondagens e auditoria
    // A sondagem é marcada só agora porque `probe_run_id` é chave estrangeira;
    // as linhas dos disjuntores continuam travadas desde a consulta.
    let breaker: BreakerAdmission | null = null;
    for (const probe of admissao.probes) {
      const marcado = await markBreakerProbe(tx, {
        userId: input.userId,
        breaker: probe.breaker,
        runId: criado.id,
        now: agora,
      });
      breaker ??= toBreakerAdmission(marcado, probe.admission);
    }

    const diario: { level: DiagnosticEvent["level"]; code: string; message: string }[] = [];

    if (policyDecision.decidedBy !== "DEFAULT") {
      await appendDashboardEvent(tx, {
        userId: input.userId,
        type: "policy.decided",
        payload: {
          taskId: task.id,
          projectId: task.projectId,
          loadoutId: loadout.id,
          runId: criado.id,
          ...policyDecision,
        },
      });
      diario.push({ level: "INFO", code: "POLICY_DECIDED", message: policyDecision.reason });
    }

    for (const aviso of orcamentos.warnings) {
      await appendDashboardEvent(tx, {
        userId: input.userId,
        type: "budget.warned",
        payload: {
          budgetId: aviso.budgetId,
          name: aviso.name,
          taskId: task.id,
          projectId: task.projectId,
          loadoutId: loadout.id,
          runId: criado.id,
          limit: aviso.limit,
          limitValue: aviso.limitValue,
          current: aviso.current,
          decidedBy: aviso.decidedBy,
          reason: aviso.reason,
        },
      });
      diario.push({ level: "WARN", code: "BUDGET_WARNED", message: aviso.reason });
    }

    if (modelRouting !== null && modelRouting.ruleId !== null) {
      diario.push({ level: "INFO", code: "MODEL_ROUTED", message: modelRouting.reason });
    }

    if (breaker !== null) {
      diario.push({
        level: "WARN",
        code: "BREAKER_PROBE",
        message: `${breaker.decidedBy}: ${breaker.reason}`,
      });
    }

    for (const entrada of diario) {
      const evento: DiagnosticEvent = {
        type: "Diagnostic",
        timestamp: agora.toISOString(),
        harness: harness.key,
        level: entrada.level,
        source: "RUNTIME",
        code: entrada.code,
        message: entrada.message,
      };
      await insertRunEvent(tx, {
        userId: input.userId,
        runId: criado.id,
        event: { type: evento.type, timestamp: agora, payload: evento },
      });
    }

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

    return ok({
      ...toRun(enfileirado.value, task.projectId),
      warnings: report.warnings,
      policyDecision,
      modelRouting,
      budgetWarnings: orcamentos.warnings,
      breaker,
    });
  }
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
    /** O nível de autonomia (Fase 9A): decide se a ferramenta de delegação é oferecida. */
    readonly autonomyLevel: AutonomyLevel;
  };
  readonly task: { readonly id: string; readonly title: string };
  /** A profundidade na cadeia de delegação (Fase 9B): 0 sem mãe, 1 filho, 2 neto. */
  readonly delegationDepth: number;
}

/** Um Run da fila que um disjuntor não deixou reclamar (Fase 9B). */
export interface RunClaimDeferral {
  readonly runId: string;
  readonly breakerId: string;
  readonly breakerName: string;
  readonly state: BreakerState;
  readonly reason: string;
}

/** Quantos candidatos a reclamação examina antes de desistir da passada. */
const CLAIM_CANDIDATES = 25;

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
 *
 * **Disjuntores na reclamação (Fase 9B).** O mundo mudou desde o `POST /runs`:
 * um disjuntor pode ter aberto com o Run já na fila. Um Run cujo disjuntor
 * está `OPEN` dentro do cooldown — ou `HALF_OPEN` com outra sondagem em voo —
 * **fica na fila** e o próximo candidato é examinado; `onDeferred` conta ao
 * chamador, que grava um `Diagnostic` uma vez. Um Run que já é a sondagem do
 * disjuntor passa; um `OPEN` com o cooldown vencido toma o Run como sondagem
 * aqui, como a criação faria. Não há `PREPARING → QUEUED`, então a decisão
 * precisa vir **antes** do claim.
 */
export async function claimNextQueuedRun(
  db: Database,
  input: {
    userId?: string;
    claimedBy?: string;
    onDeferred?: ((deferral: RunClaimDeferral) => void) | undefined;
    now?: Date;
  } = {},
): Promise<ClaimedRun | null> {
  return await db.transaction(async (tx) => {
    const escopo = input.userId === undefined ? sql`` : sql` and ${runs.userId} = ${input.userId}`;
    const agora = input.now ?? new Date();

    const candidatos = await tx.execute<{ id: string }>(
      sql`select ${runs.id} from ${runs}
          where ${runs.status} = 'QUEUED' and ${runs.cancelRequestedAt} is null${escopo}
          order by ${runs.createdAt} asc, ${runs.id} asc
          for update skip locked
          limit ${CLAIM_CANDIDATES}`,
    );

    for (const candidato of candidatos.rows) {
      const [row] = await tx.select().from(runs).where(eq(runs.id, candidato.id));
      if (row === undefined) continue;

      const [contexto] = await tx
        .select({
          taskId: tasks.id,
          taskTitle: tasks.title,
          projectId: projects.id,
          workspaceKind: projects.workspaceKind,
          workspacePath: projects.workspacePath,
          autonomyLevel: projects.autonomyLevel,
        })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(eq(tasks.id, row.taskId));

      if (contexto === undefined) {
        throw new Error(`O Run ${row.id} aponta para uma Task sem Project: não há onde executar.`);
      }

      // ---------------------------------------------------------- disjuntores
      const breakers = await lockApplicableBreakers(tx, {
        userId: row.userId,
        projectId: contexto.projectId,
        loadoutId: row.loadoutId,
        harnessKey: row.harnessKey,
      });
      let recusado: RunClaimDeferral | null = null;
      const sondagens: CircuitBreakerRow[] = [];
      for (const breaker of breakers) {
        // O Run que já é a sondagem deste disjuntor é exatamente o que ele
        // espera ver rodar.
        if (breaker.probeRunId === row.id) continue;
        const admission = admitThroughBreaker(
          {
            state: breaker.state,
            openedAt: breaker.openedAt,
            cooldownMs: breaker.cooldownMs,
            probeRunId: breaker.probeRunId,
          },
          agora,
        );
        if (!admission.admit) {
          recusado = {
            runId: row.id,
            breakerId: breaker.id,
            breakerName: breaker.name,
            state: admission.state,
            reason: admission.reason,
          };
          break;
        }
        if (admission.probe) sondagens.push(breaker);
      }
      if (recusado !== null) {
        input.onDeferred?.(recusado);
        continue;
      }
      for (const breaker of sondagens) {
        await markBreakerProbe(tx, { userId: row.userId, breaker, runId: row.id, now: agora });
      }

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
          `Run ${row.id} em QUEUED recusou a ida para PREPARING: ${JSON.stringify(aplicado.failure)}`,
        );
      }

      const delegationDepth =
        row.parentRunId === null
          ? 0
          : await delegationDepthOf(tx, { userId: row.userId, runId: row.id });

      return {
        run: toRun(aplicado.value, contexto.projectId),
        project: {
          id: contexto.projectId,
          workspaceKind: contexto.workspaceKind,
          workspacePath: contexto.workspacePath,
          autonomyLevel: contexto.autonomyLevel,
        },
        task: { id: contexto.taskId, title: contexto.taskTitle },
        delegationDepth,
      };
    }

    return null;
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

      // Os disjuntores aprendem com o desfecho **aqui**, e não num job depois
      // (Fase 9B): um `FAILED` que commitasse sem alimentar o contador
      // deixaria o disjuntor contando uma realidade que já não é a do banco.
      const transicoes = await feedBreakersWithRunOutcome(tx, {
        userId: input.userId,
        run: aplicado.value,
        projectId: task?.projectId ?? null,
      });
      for (const transicao of transicoes) {
        const evento: DiagnosticEvent = {
          type: "Diagnostic",
          timestamp: new Date().toISOString(),
          harness: row.harnessKey,
          level: transicao.to === "OPEN" ? "WARN" : "INFO",
          source: "RUNTIME",
          code: transicao.to === "OPEN" ? "BREAKER_OPENED" : "BREAKER_CLOSED",
          message: `${transicao.decidedBy}: ${transicao.reason}`,
        };
        await insertRunEvent(tx, {
          userId: input.userId,
          runId: row.id,
          event: { type: evento.type, timestamp: new Date(), payload: evento },
        });
      }

      // O Run mãe de uma delegação (Fase 9B) volta à fila na **mesma**
      // transação do desfecho do filho: é o que garante que nenhum filho
      // termina sem acordar quem o esperava.
      await wakeParentAfterChildOutcome(tx, { userId: input.userId, child: aplicado.value });

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
 * Devolve o Run mãe à fila quando o filho que ele esperava terminou (Fase 9B).
 *
 * Chamada na transação do desfecho do filho, com a linha do filho já travada.
 * A mãe é travada em seguida — sempre nesta ordem, filho e depois mãe; o
 * cancelamento em cascata percorre o sentido contrário em transações
 * **separadas**, e é isso que evita o abraço mortal entre os dois.
 *
 * Só age quando a mãe está em `WAITING_CHILD` **por este filho**: o step com
 * a `parent_step_key` do filho em `WAITING_CHILD`. Uma mãe em `RUNNING` — a
 * delegação pela ferramenta, com o agente da mãe vivo esperando `await_run`
 * — não precisa de nada; uma mãe cancelada ou terminada também não. O step
 * continua `WAITING_CHILD`: quem o assenta é o motor, ao reler o filho.
 */
async function wakeParentAfterChildOutcome(
  db: DatabaseExecutor,
  input: { userId: string; child: RunRow },
): Promise<void> {
  const { child } = input;
  if (child.parentRunId === null || child.parentStepKey === null) return;

  const parent = await lockRunRow(db, { userId: input.userId, runId: child.parentRunId });
  if (parent === null || parent.status !== "WAITING_CHILD") return;

  const [step] = await db
    .select({ id: runSteps.id, status: runSteps.status, name: runSteps.name })
    .from(runSteps)
    .where(
      and(
        eq(runSteps.userId, input.userId),
        eq(runSteps.runId, parent.id),
        eq(runSteps.key, child.parentStepKey),
      ),
    );
  if (step === undefined || step.status !== "WAITING_CHILD") return;

  const devolvido = await applyRunStatus(db, { userId: input.userId, run: parent, to: "QUEUED" });
  if (!devolvido.ok) {
    // A aresta `WAITING_CHILD → QUEUED` existe e a Task não se mexe nela;
    // chegar aqui é defeito, e o filho não pode commitar sem acordar a mãe.
    throw new Error(
      `O Run mãe ${parent.id} recusou a volta à fila após o filho ${child.id}: ` +
        JSON.stringify(devolvido.failure),
    );
  }

  const agora = new Date();
  const diagnostico: DiagnosticEvent = {
    type: "Diagnostic",
    timestamp: agora.toISOString(),
    harness: parent.harnessKey,
    level: "INFO",
    source: "RUNTIME",
    code: "DELEGATION_FINISHED",
    message:
      `O Run filho ${child.id} do passo «${step.name}» (${child.parentStepKey}) terminou em ` +
      `${child.status}; o Run volta à fila para continuar.`,
  };
  await insertRunEvent(db, {
    userId: input.userId,
    runId: parent.id,
    event: { type: diagnostico.type, timestamp: agora, payload: diagnostico },
  });

  const [task] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, parent.taskId));

  await appendDashboardEvent(db, {
    userId: input.userId,
    type: "delegation.finished",
    payload: {
      runId: parent.id,
      childRunId: child.id,
      stepKey: child.parentStepKey,
      taskId: parent.taskId,
      projectId: task?.projectId ?? null,
      childStatus: child.status,
    },
  });
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
 *
 * **Cascata (Fase 9B).** Cancelar um Run mãe cancela os filhos vivos, cada um
 * pelo mesmo caminho e em transação própria, **depois** do COMMIT da mãe: a
 * ordem de travas "mãe, depois filho" aqui é a inversa da do desfecho do
 * filho ("filho, depois mãe"), e mantê-las na mesma transação seria um abraço
 * mortal esperando para acontecer.
 */
export async function requestRunCancellation(
  db: Database,
  input: { userId: string; runId: string },
): Promise<Result<Run, RunWriteFailure> | null> {
  const pedido = await requestRunCancellationOnly(db, input);
  if (pedido === null || !pedido.ok) return pedido;

  const filhos = await listLiveChildRunRows(db, input);
  for (const filho of filhos) {
    await requestRunCancellation(db, { userId: input.userId, runId: filho.id });
  }
  return pedido;
}

async function requestRunCancellationOnly(
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
 * Os Runs parados esperando — um gate ou um filho — com cancelamento pedido.
 *
 * Em `WAITING_APPROVAL` e `WAITING_CHILD` ninguém está executando: o Run
 * soltou o Worker, e o pedido só marcou a coluna. O laço ocioso do Worker os
 * fecha (`cancelWaitingRun`).
 */
export async function listWaitingRunsWithCancelRequested(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<string[]> {
  const rows = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.userId, input.userId),
        inArray(runs.status, ["WAITING_APPROVAL", "WAITING_CHILD"]),
        sql`${runs.cancelRequestedAt} is not null`,
      ),
    )
    .orderBy(asc(runs.createdAt), asc(runs.id));

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
