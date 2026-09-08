import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  CommandAccess,
  HarnessKey,
  Run,
  RunEvent,
  RunStatus,
  TaskStatus,
  WorkspaceStrategy,
} from "@dungeon-master/contracts";
import {
  createAgent,
  createDatabase,
  createLoadout,
  createProject,
  createRun,
  createTask,
  executionProfiles,
  getRun,
  listExecutionProfiles,
  listHarnesses,
  listRunEventsSince,
  LOCAL_USER_ID,
  projects,
  runs,
  tasks,
  type Database,
  type DatabaseHandle,
} from "@dungeon-master/database";
import { buildGitEnv, collectProcess } from "@dungeon-master/runtime";
import { and, eq } from "drizzle-orm";

import type { WorkerRuntimeConfig } from "../src/worker.js";

/**
 * Fixtures dos testes do Worker.
 *
 * Tudo passa pelas mesmas funções que a API usa — nada de `INSERT` direto —,
 * porque um estado que a aplicação não sabe produzir não é um teste: é uma
 * armadilha que só falha depois.
 */

export const USER = LOCAL_USER_ID;

export function exigirOk<V, F>(
  result: { ok: true; value: V } | { ok: false; failure: F } | null,
  what: string,
): V {
  if (result === null) throw new Error(`${what}: não encontrado.`);
  if (!result.ok) throw new Error(`${what}: recusado — ${JSON.stringify(result.failure)}.`);
  return result.value;
}

export async function git(args: readonly string[], cwd: string): Promise<string> {
  const result = await collectProcess("git", args, { cwd, env: buildGitEnv(), timeoutMs: 60_000 });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} falhou (${String(result.code)}): ${result.stderr}`);
  }
  return result.stdout;
}

export interface RepositorioTemporario {
  readonly sandbox: string;
  readonly repo: string;
  remover(): Promise<void>;
}

/** Um repositório git de verdade em temp, com um commit inicial. */
export async function criarRepositorio(prefixo = "dm-worker-"): Promise<RepositorioTemporario> {
  const sandbox = await mkdtemp(join(tmpdir(), prefixo));
  const repo = join(sandbox, "repositorio");
  await git(["init", "-q", "-b", "main", repo], sandbox);
  await writeFile(join(repo, "README.md"), "# base\n");
  await git(["add", "."], repo);
  await git(["commit", "-q", "-m", "base"], repo);

  return {
    sandbox,
    repo,
    // `git` deixa handles abertos por um instante no Windows; a limpeza é
    // best-effort e nunca reprova um teste que já passou.
    remover: async () => {
      await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }).catch(
        () => undefined,
      );
    },
  };
}

export function abrirBanco(databaseUrl: string): DatabaseHandle {
  return createDatabase({ url: databaseUrl, max: 8, applicationName: "vitest-worker" });
}

export interface Cenario {
  readonly projectId: string;
  readonly taskId: string;
  readonly loadoutId: string;
  readonly executionProfileId: string;
}

/**
 * Project com workspace, Task pronta e um Loadout completo sobre os cadastros
 * semeados. `workspaceStrategy` é ajustada direto na linha do perfil porque o
 * `db:seed` só entrega "Campo aberto" com `GIT_WORKTREE`.
 */
export async function montarCenario(
  db: Database,
  input: {
    nome: string;
    workspacePath: string;
    workspaceStrategy?: WorkspaceStrategy;
    allowUnsafeBypass?: boolean;
    commandExecution?: CommandAccess;
    /** Harness do Loadout. Padrão: `CLAUDE_CODE`, que é o do harness falso. */
    harnessKey?: HarnessKey;
    /** Workflow da Task. Ausente é o Run simples, de um agente só. */
    workflowId?: string;
  },
): Promise<Cenario> {
  const project = await createProject(db, { userId: USER, title: `Project ${input.nome}` });

  await db
    .update(projects)
    .set({ workspacePath: input.workspacePath })
    .where(and(eq(projects.id, project.id), eq(projects.userId, USER)));

  const task = exigirOk(
    await createTask(db, {
      userId: USER,
      projectId: project.id,
      title: `Task ${input.nome}`,
      ...(input.workflowId === undefined ? {} : { workflowId: input.workflowId }),
    }),
    `a criação da Task ${input.nome}`,
  );

  const harnessKey = input.harnessKey ?? "CLAUDE_CODE";
  const harnesses = await listHarnesses(db, { userId: USER });
  const harness = harnesses.find((item) => item.key === harnessKey);
  if (harness === undefined) throw new Error(`O Harness ${harnessKey} não foi semeado.`);

  const perfis = await listExecutionProfiles(db, { userId: USER });
  const perfil = perfis.find((item) => item.enabled);
  if (perfil === undefined) throw new Error("Nenhum ExecutionProfile ligado foi semeado.");

  await db
    .update(executionProfiles)
    .set({
      workspaceStrategy: input.workspaceStrategy ?? "GIT_WORKTREE",
      permissionPolicy: {
        ...perfil.permissionPolicy,
        ...(input.commandExecution === undefined
          ? {}
          : { commandExecution: input.commandExecution }),
        ...(input.allowUnsafeBypass === undefined
          ? {}
          : { allowUnsafeBypass: input.allowUnsafeBypass }),
      },
    })
    .where(and(eq(executionProfiles.id, perfil.id), eq(executionProfiles.userId, USER)));

  const agent = exigirOk(
    await createAgent(db, {
      userId: USER,
      name: `Engenheiro ${input.nome}`,
      role: "ENGINEER",
      instructions: "Implemente o que a Task pede.",
    }),
    "a criação do Agent",
  );

  const loadout = exigirOk(
    await createLoadout(db, {
      userId: USER,
      name: `Loadout ${input.nome}`,
      agentId: agent.id,
      harnessId: harness.id,
      executionProfileId: perfil.id,
    }),
    "a criação do Loadout",
  );

  return {
    projectId: project.id,
    taskId: task.id,
    loadoutId: loadout.id,
    executionProfileId: perfil.id,
  };
}

/** Enfileira um Run com o prompt dado (que é o roteiro do harness falso). */
export async function enfileirar(
  db: Database,
  input: { taskId: string; loadoutId: string; prompt: string },
): Promise<Run> {
  return exigirOk(
    await createRun(db, {
      userId: USER,
      taskId: input.taskId,
      loadoutId: input.loadoutId,
      prompt: input.prompt,
    }),
    "a criação do Run",
  );
}

export const CONFIG_PADRAO: Omit<WorkerRuntimeConfig, "workerId"> = {
  tickIntervalMs: 50,
  maxConcurrentRuns: 2,
  shutdownTimeoutMs: 20_000,
  runIdleTimeoutMs: 30_000,
  runCompletionTimeoutMs: 60_000,
  worktreesRoot: undefined,
};

/**
 * Espera uma condição, consultando o banco.
 *
 * O Worker é assíncrono de ponta a ponta: o teste cria o Run e o desfecho chega
 * quando chegar. Uma espera fixa seria lenta no caso bom e instável no ruim.
 */
export async function esperar<T>(
  descricao: string,
  ler: () => Promise<T | null>,
  timeoutMs = 30_000,
): Promise<T> {
  const limite = Date.now() + timeoutMs;

  for (;;) {
    const valor = await ler();
    if (valor !== null) return valor;
    if (Date.now() > limite) throw new Error(`Esgotou o tempo esperando: ${descricao}.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export async function esperarStatusDeRun(
  db: Database,
  runId: string,
  esperados: readonly RunStatus[],
  timeoutMs = 30_000,
): Promise<Run> {
  return await esperar(
    `Run ${runId} chegar a ${esperados.join(" | ")}`,
    async () => {
      const run = await getRun(db, { userId: USER, runId });
      return run !== null && esperados.includes(run.status) ? run : null;
    },
    timeoutMs,
  );
}

export async function statusDaTask(db: Database, taskId: string): Promise<TaskStatus> {
  const [row] = await db
    .select({ status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, USER)));
  if (row === undefined) throw new Error(`Task ${taskId} sumiu.`);
  return row.status;
}

export async function eventosDoRun(db: Database, runId: string): Promise<RunEvent[]> {
  return await listRunEventsSince(db, { userId: USER, runId, afterSequence: 0, limit: 500 });
}

/**
 * O diário do Run em uma string, para a mensagem de uma asserção que falhou.
 *
 * Um `expect` que quebra dizendo só "undefined" manda quem lê a saída do CI
 * adivinhar o que o Run fez. O diário é onde o motivo está: foi assim que uma
 * falha de `git commit` dentro do agente passou uma rodada inteira sem
 * explicação, porque o log do worker não aparece no runner e o evento
 * aparecia.
 */
export function diarioDoRun(eventos: readonly RunEvent[]): string {
  return eventos
    .map((evento) => {
      const payload =
        typeof evento.payload === "object" && evento.payload !== null
          ? (evento.payload as Record<string, unknown>)
          : {};
      const partes = [evento.type];
      for (const campo of ["level", "message", "detail", "path", "kind", "text", "output"]) {
        const valor = payload[campo];
        if (typeof valor === "string" && valor.length > 0) partes.push(`${campo}=${valor}`);
      }
      return `  ${String(evento.sequence)}. ${partes.join(" | ")}`;
    })
    .join("\n");
}

/** Apaga tudo o que os testes escrevem, na ordem das chaves estrangeiras. */
export async function limpar(handle: DatabaseHandle): Promise<void> {
  // `run` referencia a si mesma por `resumed_from_run_id`, com `on delete set
  // null`, então um `delete` único basta.
  for (const tabela of [
    // As tabelas da projeção vêm primeiro: `achievement_unlock` referencia
    // `run` e `task`, e o `on delete set null` só cobre a coluna, não a linha.
    "achievement_unlock",
    "achievement_progress",
    "achievement_cursor",
    "achievement_definition",
    "hero_stats",
    "proposed_task",
    "knowledge_candidate",
    "knowledge_item",
    "distillation_run",
    "workspace_lock",
    "approval_gate",
    "run_step",
    "run_event",
    "run",
    "workflow_step",
    "workflow_version",
    "workflow",
    "loadout",
    "model",
    "agent",
    "activity",
    "task_dependency",
    "task",
    "project",
    "dashboard_event",
  ]) {
    await handle.pool.query(`delete from ${tabela} where user_id = $1`, [USER]);
  }
}

/** A linha crua do Run, para os campos que o contrato não expõe. */
export async function linhaDoRun(db: Database, runId: string) {
  const [row] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.userId, USER)));
  return row;
}
