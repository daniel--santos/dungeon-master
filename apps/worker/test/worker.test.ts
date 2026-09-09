import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { TaskExecutionResult } from "@dungeon-master/contracts";
import {
  createRun,
  getRun,
  listKnowledgeCandidates,
  listProposedTasks,
  listWorkspaceLocksByRun,
  requestRunCancellation,
  runs,
  tasks,
  type Database,
  type DatabaseHandle,
} from "@dungeon-master/database";
import {
  createWorkspaceManager,
  GitCommandError,
  type HarnessAdapter,
  type WorkspaceManager,
} from "@dungeon-master/runtime";
import { fakeHarness } from "@dungeon-master/runtime/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import type { AchievementProjector } from "../src/achievements.js";
import { newWorkerId } from "../src/config.js";
import { createRunOutcomeWriter } from "../src/run-writers.js";
import { createWorker, type Worker } from "../src/worker.js";
import {
  abrirBanco,
  CONFIG_PADRAO,
  criarRepositorio,
  diarioDoRun,
  enfileirar,
  esperar,
  esperarStatusDeRun,
  eventosDoRun,
  exigirOk,
  git,
  limpar,
  linhaDoRun,
  montarCenario,
  statusDaTask,
  USER,
  type RepositorioTemporario,
} from "./support.js";

/**
 * Integração do Worker com banco embutido e o harness falso.
 *
 * "Falso" é só o modelo: o adapter sobe um processo Node de verdade, fala
 * NDJSON de verdade e morre por kill de árvore de verdade. É o que faz a suíte
 * rodar no CI sem CLI instalada e ainda provar o que costuma quebrar —
 * processo, sinal, encerramento — em vez de só a tradução de eventos.
 */

let handle: DatabaseHandle;
let db: Database;
let repositorio: RepositorioTemporario;
let worker: Worker | undefined;

/** Um worktree por Run, fora do repositório, num lugar que o teste limpa. */
function managerPara(repo: RepositorioTemporario) {
  return createWorkspaceManager({ worktreesRoot: join(repo.sandbox, "worktrees") });
}

/**
 * O estado que um `kill -9` no Worker congela: Run em `RUNNING` reclamado por
 * um processo que não existe, e a Task em `RUNNING` junto — as duas escritas
 * saem da mesma transação de `claimNextQueuedRun`.
 */
async function marcarComoEmExecucao(
  runId: string,
  taskId: string,
  claimedBy: string,
): Promise<void> {
  await db
    .update(runs)
    .set({ status: "RUNNING", claimedBy, startedAt: new Date() })
    .where(and(eq(runs.id, runId), eq(runs.userId, USER)));

  await db
    .update(tasks)
    .set({ status: "RUNNING" })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, USER)));
}

async function subirWorker(input: {
  adapters?: readonly HarnessAdapter[];
  maxConcurrentRuns?: number;
  shutdownTimeoutMs?: number;
  runIdleTimeoutMs?: number;
  workerId?: string;
  start?: boolean;
  workspace?: WorkspaceManager;
  achievements?: AchievementProjector;
  /** Um `Database` instrumentado, para os testes de entrelaçamento. */
  db?: Database;
}): Promise<Worker> {
  const criado = createWorker({
    db: input.db ?? db,
    pool: handle.pool,
    userId: USER,
    adapters: input.adapters ?? [fakeHarness()],
    workspace: input.workspace ?? managerPara(repositorio),
    ...(input.achievements === undefined ? {} : { achievements: input.achievements }),
    config: {
      ...CONFIG_PADRAO,
      workerId: input.workerId ?? newWorkerId(),
      ...(input.maxConcurrentRuns === undefined
        ? {}
        : { maxConcurrentRuns: input.maxConcurrentRuns }),
      ...(input.shutdownTimeoutMs === undefined
        ? {}
        : { shutdownTimeoutMs: input.shutdownTimeoutMs }),
      ...(input.runIdleTimeoutMs === undefined ? {} : { runIdleTimeoutMs: input.runIdleTimeoutMs }),
    },
  });

  await criado.boot();
  if (input.start !== false) criado.start();
  worker = criado;
  return criado;
}

beforeAll(() => {
  handle = abrirBanco(inject("databaseUrl"));
  db = handle.db;
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await limpar(handle);
  repositorio = await criarRepositorio();
});

afterEach(async () => {
  await worker?.stop("fim do teste");
  worker = undefined;
  await limpar(handle);
  await repositorio.remover();
});

describe("caminho feliz", () => {
  it("claima, persiste os eventos em ordem e grava SUCCEEDED com result", async () => {
    const cenario = await montarCenario(db, { nome: "feliz", workspacePath: repositorio.repo });
    await subirWorker({});

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: [
        "@@fake:session sessao-feliz",
        "@@fake:text Vou implementar.",
        "@@fake:tool Bash git status",
        "@@fake:usage 120 34",
        '@@fake:block {"status":"completed","summary":"Implementei o que a Task pedia.",' +
          '"discoveredTasks":[{"title":"Cobrir o parser com testes","rationale":"Nenhum teste toca o erro."}],' +
          '"knowledgeCandidates":[{"title":"Rodar o lint antes","content":"O lint pega o import quebrado.","kind":"howto"}]}',
      ].join("\n"),
    });

    const terminado = await esperarStatusDeRun(db, criado.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);

    expect(terminado.status, JSON.stringify(terminado.error)).toBe("SUCCEEDED");
    expect(terminado.result?.status).toBe("completed");
    expect(terminado.result?.summary).toBe("Implementei o que a Task pedia.");

    // O resultado alimentou o domínio na transação do desfecho (Fase 5): a
    // proposta e o candidato existem assim que o Run está SUCCEEDED.
    const propostas = await listProposedTasks(db, { userId: USER, page: 1, pageSize: 10 });
    expect(propostas.items.map((item) => [item.title, item.status, item.originRunId])).toEqual([
      ["Cobrir o parser com testes", "PROPOSED", criado.id],
    ]);
    expect(propostas.items[0]?.originTaskId).toBe(cenario.taskId);
    const candidatos = await listKnowledgeCandidates(db, { userId: USER, page: 1, pageSize: 10 });
    expect(candidatos.items.map((item) => [item.title, item.kind, item.status])).toEqual([
      ["Rodar o lint antes", "howto", "PENDING"],
    ]);
    expect(terminado.harnessSessionId).toBe("sessao-feliz");
    expect(terminado.harnessVersion).toBe("0.0.0-fake");
    expect(terminado.workspacePath).toContain("worktrees");

    // O acoplamento com a Task é aplicado na mesma transação do desfecho.
    expect(await statusDaTask(db, cenario.taskId)).toBe("COMPLETED");

    const eventos = await eventosDoRun(db, criado.id);
    const sequences = eventos.map((evento) => evento.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    // Estritamente crescente e sem lacunas: é o que o cursor do SSE assume.
    expect(sequences).toEqual(sequences.map((_valor, indice) => indice + 1));

    const tipos = eventos.map((evento) => evento.type);
    // Os diagnósticos de política vêm antes de `RunStarted`: eles descrevem o
    // que foi concedido, e a concessão é decidida antes de o processo subir.
    expect(tipos.indexOf("RunStarted")).toBeLessThan(tipos.indexOf("ToolCall"));
    expect(tipos).toContain("ToolCall");
    expect(tipos).toContain("ToolResult");
    expect(tipos).toContain("SessionCaptured");
    expect(tipos.at(-1)).toBe("RunCompleted");

    // O payload guarda o evento inteiro, com o discriminante.
    const started = eventos.find((evento) => evento.type === "RunStarted")?.payload as {
      type: string;
      workspacePath: string;
    };
    expect(started.type).toBe("RunStarted");
    expect(started.workspacePath).toBe(terminado.workspacePath);

    // A trava saiu junto do desfecho.
    expect(await listWorkspaceLocksByRun(db, { userId: USER, runId: criado.id })).toHaveLength(0);
  });

  it("coleta os commits do worktree e remove o diretório num sucesso limpo", async () => {
    const cenario = await montarCenario(db, { nome: "commits", workspacePath: repositorio.repo });
    await subirWorker({});

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: '@@fake:block {"status":"completed","summary":"nada a fazer"}',
    });

    // O agente falso não escreve arquivo; o commit entra por fora, no worktree
    // que o Worker criou, enquanto o Run ainda está em execução seria uma
    // corrida. Aqui o que se prova é o caminho de remoção do worktree limpo.
    const terminado = await esperarStatusDeRun(db, criado.id, ["SUCCEEDED", "FAILED"]);
    expect(terminado.status).toBe("SUCCEEDED");
    expect(terminado.result?.["commits"]).toBeUndefined();

    await expect(stat(terminado.workspacePath ?? "")).rejects.toThrow();
  });
});

describe("espólios pelo diff do worktree", () => {
  it("emite Artifact para o que o Run criou, modificou e apagou", async () => {
    const cenario = await montarCenario(db, { nome: "espolios", workspacePath: repositorio.repo });
    await subirWorker({});

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: [
        // O agente falso escreve arquivo de verdade; quem os descobre é o diff
        // do worktree, e não o stream — nenhum dos três harnesses de host anuncia
        // artefato, fora o Codex.
        "@@fake:write OLA.md Ola do Dungeon Master.",
        "@@fake:write README.md # mexido",
        "@@fake:git add -A",
        "@@fake:git commit -m commit-do-agente",
        "@@fake:write RASCUNHO.md nao commitado",
        '@@fake:block {"status":"completed","summary":"mexi nos arquivos"}',
      ].join("\n"),
    });

    const terminado = await esperarStatusDeRun(db, criado.id, ["SUCCEEDED", "FAILED"]);
    const eventos = await eventosDoRun(db, criado.id);
    // O diário entra na mensagem de toda asserção daqui para baixo: o log do
    // worker não aparece no CI, e sem ele uma falha aqui não diz o que o Run
    // fez. Foi o que custou uma rodada para descobrir que o `git commit` do
    // agente é que estava falhando.
    const diario = diarioDoRun(eventos);
    expect(terminado.status, `${JSON.stringify(terminado.error)}\n${diario}`).toBe("SUCCEEDED");

    const artefatos = eventos
      .filter((evento) => evento.type === "Artifact")
      .map((evento) => evento.payload as { path: string; kind?: string; bytes?: number });

    const porCaminho = new Map(artefatos.map((artefato) => [artefato.path, artefato]));
    expect([...porCaminho.keys()].sort(), diario).toEqual(["OLA.md", "RASCUNHO.md", "README.md"]);
    expect(porCaminho.get("OLA.md")?.kind).toBe("created");
    expect(porCaminho.get("README.md")?.kind).toBe("modified");
    expect(porCaminho.get("OLA.md")?.bytes).toBeGreaterThan(0);

    // Os espólios saem antes do evento terminal: depois dele nada é emitido.
    const tipos = eventos.map((evento) => evento.type);
    expect(tipos.lastIndexOf("Artifact")).toBeLessThan(tipos.indexOf("RunCompleted"));

    // O commit do agente foi coletado, e o worktree ficou preservado porque
    // sobrou mudança não commitada.
    // `commits` ausente é a forma que a falha do CI tinha: o `git commit` do
    // agente não passava, `collectCommits` devolvia lista vazia e o campo era
    // omitido. Afirmar a presença antes de mapear troca um `TypeError` sem
    // pista pelo diário do Run.
    const commits = terminado.result?.["commits"] as ReadonlyArray<{ subject: string }> | undefined;
    expect(commits, `o Run terminou sem commits.\n${diario}`).toBeDefined();
    expect(commits?.map((commit) => commit.subject)).toEqual(["commit-do-agente"]);
    expect(terminado.result?.["preservedWorktreePath"]).toBeTypeOf("string");
  });

  it("uma coleta que falha vira Diagnostic com o stderr do git", async () => {
    // A falha de `collectCommits` só virava `logger.warn`, e o log do worker
    // não aparece no CI: um `result.commits` ausente ficou uma rodada inteira
    // sem explicação. O `Diagnostic` é persistido e sai antes do terminal, que
    // é o único lugar onde quem lê o diário do Run vai procurar.
    const real = managerPara(repositorio);
    const quebrado: WorkspaceManager = {
      ...real,
      collectCommits: () =>
        Promise.reject(
          new GitCommandError("git log falhou", {
            args: ["log", "--reverse"],
            cwd: "/worktree",
            code: 128,
            stderr: "fatal: detected dubious ownership in repository",
          }),
        ),
    };

    const cenario = await montarCenario(db, {
      nome: "coleta-ruim",
      workspacePath: repositorio.repo,
    });
    await subirWorker({ workspace: quebrado });

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: '@@fake:block {"status":"completed","summary":"terminei"}',
    });

    const terminado = await esperarStatusDeRun(db, criado.id, ["SUCCEEDED", "FAILED"]);
    // Uma coleta que falha não derruba um Run que já terminou o trabalho.
    expect(terminado.status).toBe("SUCCEEDED");

    const eventos = await eventosDoRun(db, criado.id);
    const aviso = eventos.find(
      (evento) =>
        evento.type === "Diagnostic" &&
        String((evento.payload as { message?: string }).message).includes("commits do worktree"),
    );
    expect(aviso, diarioDoRun(eventos)).toBeDefined();

    const payload = aviso?.payload as { level: string; detail?: string };
    expect(payload.level).toBe("WARN");
    expect(payload.detail).toContain("dubious ownership");
    expect(payload.detail).toContain("git log --reverse");

    // Antes do terminal: depois dele nada mais é emitido.
    const tipos = eventos.map((evento) => evento.type);
    expect(tipos.indexOf("Diagnostic")).toBeLessThan(tipos.indexOf("RunCompleted"));
  });

  it("um Run que não mexeu em nada não inventa espólio", async () => {
    const cenario = await montarCenario(db, {
      nome: "sem-espolio",
      workspacePath: repositorio.repo,
    });
    await subirWorker({});

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: '@@fake:block {"status":"completed","summary":"nada a fazer"}',
    });

    await esperarStatusDeRun(db, criado.id, ["SUCCEEDED", "FAILED"]);
    const eventos = await eventosDoRun(db, criado.id);
    expect(eventos.filter((evento) => evento.type === "Artifact")).toHaveLength(0);
  });
});

describe("permissão negada", () => {
  it("negação com trabalho inacabado vira FAILED dizendo o que faltou", async () => {
    const cenario = await montarCenario(db, { nome: "negado", workspacePath: repositorio.repo });
    await subirWorker({});

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: [
        "@@fake:denied PowerShell(git commit)",
        '@@fake:block {"status":"blocked","summary":"nao consegui commitar"}',
      ].join("\n"),
    });

    const terminado = await esperarStatusDeRun(db, criado.id, ["SUCCEEDED", "FAILED"]);

    // Sem esta regra o Run seria SUCCEEDED com a Task BLOCKED, e o motivo — a
    // CLI recusou um comando — só apareceria na prosa do agente.
    expect(terminado.status).toBe("FAILED");
    expect(terminado.error?.["code"]).toBe("PERMISSION_DENIED");
    expect(terminado.error?.["deniedTools"]).toEqual(["PowerShell(git commit)"]);
    expect(terminado.error?.["retryable"]).toBe(true);
    expect(await statusDaTask(db, cenario.taskId)).toBe("FAILED");

    const negacao = (await eventosDoRun(db, criado.id))
      .filter((evento) => evento.type === "Diagnostic")
      .map((evento) => evento.payload as { code?: string; detail?: string })
      .find((payload) => payload.code === "PERMISSION_DENIED");

    expect(negacao?.detail).toContain("allowUnsafeBypass");
  });

  it("negação que o agente contornou não reprova o Run", async () => {
    const cenario = await montarCenario(db, { nome: "contornou", workspacePath: repositorio.repo });
    await subirWorker({});

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      // É o caso real: o agente tenta PowerShell, é negado, refaz com Bash e
      // termina. Reprovar aqui descartaria trabalho concluído.
      prompt: [
        "@@fake:denied PowerShell",
        "@@fake:write OLA.md Ola",
        '@@fake:block {"status":"completed","summary":"fiz pelo outro caminho"}',
      ].join("\n"),
    });

    const terminado = await esperarStatusDeRun(db, criado.id, ["SUCCEEDED", "FAILED"]);

    expect(terminado.status, JSON.stringify(terminado.error)).toBe("SUCCEEDED");
    expect(terminado.result?.status).toBe("completed");
    expect(await statusDaTask(db, cenario.taskId)).toBe("COMPLETED");
  });
});

describe("desfechos ruins", () => {
  it("falha do agente vira FAILED e a Task volta a FAILED", async () => {
    const cenario = await montarCenario(db, { nome: "falha", workspacePath: repositorio.repo });
    await subirWorker({});

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "@@fake:error o modelo recusou o pedido",
    });

    const terminado = await esperarStatusDeRun(db, criado.id, ["FAILED", "SUCCEEDED"]);

    expect(terminado.status).toBe("FAILED");
    expect(terminado.error?.message).toContain("o modelo recusou o pedido");
    expect(await statusDaTask(db, cenario.taskId)).toBe("FAILED");

    // O worktree é preservado numa falha: é onde está a prova do que aconteceu.
    const preservado = terminado.error?.["preservedWorktreePath"];
    expect(typeof preservado).toBe("string");
    await expect(stat(preservado as string)).resolves.toBeDefined();

    const diagnosticos = (await eventosDoRun(db, criado.id)).filter(
      (evento) => evento.type === "Diagnostic",
    );
    const recuperacao = diagnosticos.find((evento) =>
      String((evento.payload as { detail?: string }).detail ?? "").includes("worktree remove"),
    );
    expect(recuperacao, "o diagnóstico de recuperação traz comandos copiáveis").toBeDefined();
  });

  it("silêncio do agente vira TIMED_OUT com a árvore confirmada morta", async () => {
    const cenario = await montarCenario(db, { nome: "ocioso", workspacePath: repositorio.repo });
    await subirWorker({ runIdleTimeoutMs: 1_000 });

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      // Sobe um neto e trava: prova que o kill alcança a descendência.
      prompt: ["@@fake:spawn-child", "@@fake:hang"].join("\n"),
    });

    const terminado = await esperarStatusDeRun(db, criado.id, ["TIMED_OUT", "FAILED", "SUCCEEDED"]);

    expect(terminado.status).toBe("TIMED_OUT");
    expect(terminado.error?.["processTreeTerminated"]).toBe(true);
    expect(await statusDaTask(db, cenario.taskId)).toBe("FAILED");

    const eventos = await eventosDoRun(db, criado.id);
    const timedOut = eventos.find((evento) => evento.type === "RunTimedOut");
    expect((timedOut?.payload as { kind: string }).kind).toBe("IDLE");
  });
});

describe("escrita terminal recusada pelo domínio", () => {
  it("recusa devolvida como valor não conta como escrita terminal", async () => {
    const cenario = await montarCenario(db, { nome: "recusa", workspacePath: repositorio.repo });

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: '@@fake:block {"status":"completed","summary":"ok"}',
    });

    // O primeiro desfecho é aceito: `QUEUED → CANCELLED` existe na máquina de
    // estados.
    const primeiro = createRunOutcomeWriter({
      db,
      userId: USER,
      run: criado,
      logger: undefined,
      startedAt: Date.now(),
    });
    await primeiro.writeTerminal({
      status: "CANCELLED",
      error: { message: "cancelado antes de rodar", reason: "user_request" },
      events: [],
    });
    expect(primeiro.terminalWritten).toBe(true);

    // O segundo cai sobre um Run já terminal. `writeRunTerminalStatus` devolve
    // a recusa **como valor** (`ok: false`), sem lançar: dar isso por escrito
    // perde o `result`, as `ProposedTask` e os `KnowledgeCandidate` em silêncio
    // e desarma as duas guardas de "sem evento terminal".
    const segundo = createRunOutcomeWriter({
      db,
      userId: USER,
      run: criado,
      logger: undefined,
      startedAt: Date.now(),
    });
    await segundo.writeTerminal({
      status: "SUCCEEDED",
      result: { status: "completed", summary: "trabalho que se perderia em silêncio" },
      events: [],
    });

    expect(segundo.terminalWritten).toBe(false);

    const run = await getRun(db, { userId: USER, runId: criado.id });
    expect(run?.status).toBe("CANCELLED");
    expect(run?.result).toBeNull();
  });
});

describe("cancelamento", () => {
  it("cancela no meio, confirma a árvore morta e devolve a Task a READY", async () => {
    const cenario = await montarCenario(db, { nome: "cancelar", workspacePath: repositorio.repo });
    await subirWorker({});

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: [
        "@@fake:text comecei",
        "@@fake:spawn-child",
        "@@fake:ignore-signals",
        "@@fake:hang",
      ].join("\n"),
    });

    // Espera o processo estar mesmo de pé: cancelar em `QUEUED` seria a
    // transição imediata da API, que é outro caminho.
    await esperarStatusDeRun(db, criado.id, ["RUNNING"]);

    const pedido = await requestRunCancellation(db, { userId: USER, runId: criado.id });
    expect(pedido?.ok).toBe(true);

    const terminado = await esperarStatusDeRun(db, criado.id, [
      "CANCELLED",
      "FAILED",
      "TIMED_OUT",
      "SUCCEEDED",
    ]);

    expect(terminado.status).toBe("CANCELLED");
    expect(terminado.error?.["processTreeTerminated"]).toBe(true);
    expect(terminado.error?.["reason"]).toBe("user_request");
    // Cancelar uma execução não cancela a tarefa: o trabalho volta ao quadro.
    expect(await statusDaTask(db, cenario.taskId)).toBe("READY");

    const cancelado = (await eventosDoRun(db, criado.id)).at(-1);
    expect(cancelado?.type).toBe("RunCancelled");
    expect((cancelado?.payload as { processTreeTerminated: boolean }).processTreeTerminated).toBe(
      true,
    );
  });

  it("cancela o Run que ainda espera na fila de capacidade, sem subir agente", async () => {
    // `CURRENT` faz os dois Runs disputarem o mesmo caminho: o segundo é
    // reclamado (Run em `PREPARING`, Task em `RUNNING`) e fica `queued-key` na
    // `CapacityLock` — em voo para o Worker, sem execução nenhuma por trás.
    const cenario = await montarCenario(db, {
      nome: "cancelar-na-fila",
      workspacePath: repositorio.repo,
      workspaceStrategy: "CURRENT",
    });
    await subirWorker({ maxConcurrentRuns: 2 });

    const segurando = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: ["@@fake:text segurando a chave", "@@fake:hang"].join("\n"),
    });

    const outro = await montarCenario(db, {
      nome: "cancelar-na-fila-2",
      workspacePath: repositorio.repo,
      workspaceStrategy: "CURRENT",
    });
    const naFila = await enfileirar(db, {
      taskId: outro.taskId,
      loadoutId: outro.loadoutId,
      prompt: '@@fake:block {"status":"completed","summary":"nunca deveria ter rodado"}',
    });

    await esperarStatusDeRun(db, segurando.id, ["RUNNING"]);
    await esperarStatusDeRun(db, naFila.id, ["PREPARING"]);

    const pedido = await requestRunCancellation(db, { userId: USER, runId: naFila.id });
    expect(pedido?.ok).toBe(true);

    // O desfecho precisa chegar **enquanto** o primeiro Run ainda segura a
    // chave: esperar a trava liberar seria esperar o Run cancelado rodar.
    const terminado = await esperarStatusDeRun(
      db,
      naFila.id,
      ["CANCELLED", "SUCCEEDED", "FAILED", "TIMED_OUT"],
      15_000,
    );

    expect(terminado.status).toBe("CANCELLED");
    expect(terminado.error?.["reason"]).toBe("user_request");
    expect(await statusDaTask(db, outro.taskId)).toBe("READY");

    // Nenhum processo de agente subiu: sem `RunStarted` não houve worktree nem
    // CLI, que é a diferença entre cancelar e deixar rodar até o fim.
    const eventos = await eventosDoRun(db, naFila.id);
    expect(eventos.map((evento) => evento.type)).not.toContain("RunStarted");
    expect(eventos.at(-1)?.type).toBe("RunCancelled");
  });
});

describe("trava de workspace", () => {
  it("dois Runs no mesmo caminho de checkout são serializados", async () => {
    const cenario = await montarCenario(db, {
      nome: "trava",
      workspacePath: repositorio.repo,
      // `CURRENT` faz os dois Runs disputarem o mesmo caminho; com
      // `GIT_WORKTREE` cada um teria o seu e eles rodariam em paralelo.
      workspaceStrategy: "CURRENT",
    });
    await subirWorker({ maxConcurrentRuns: 2 });

    const roteiro = [
      "@@fake:sleep 400",
      '@@fake:block {"status":"completed","summary":"pronto"}',
    ].join("\n");

    const primeiro = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: roteiro,
    });

    // A segunda tentativa da mesma Task só pode nascer depois que a primeira
    // terminar, então o segundo Run é de outra Task do mesmo Project.
    const outro = await montarCenario(db, {
      nome: "trava-2",
      workspacePath: repositorio.repo,
      workspaceStrategy: "CURRENT",
    });
    const segundo = await enfileirar(db, {
      taskId: outro.taskId,
      loadoutId: outro.loadoutId,
      prompt: roteiro,
    });

    const a = await esperarStatusDeRun(db, primeiro.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);
    const b = await esperarStatusDeRun(db, segundo.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);

    expect(a.status).toBe("SUCCEEDED");
    expect(b.status, JSON.stringify(b.error)).toBe("SUCCEEDED");

    // Ninguém rodou junto: quem começou depois começou depois de o outro sair.
    const [primeiroFim, segundoInicio] =
      Date.parse(a.finishedAt ?? "") <= Date.parse(b.startedAt ?? "")
        ? [a.finishedAt, b.startedAt]
        : [b.finishedAt, a.startedAt];

    expect(Date.parse(primeiroFim ?? "")).toBeLessThanOrEqual(Date.parse(segundoInicio ?? ""));
  });
});

describe("teto de concorrência", () => {
  it("dois pumps no mesmo turno não reclamam além do teto", async () => {
    const cenario = await montarCenario(db, { nome: "teto", workspacePath: repositorio.repo });
    const primeiro = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "@@fake:hang",
    });

    const outro = await montarCenario(db, { nome: "teto-2", workspacePath: repositorio.repo });
    const segundo = await enfileirar(db, {
      taskId: outro.taskId,
      loadoutId: outro.loadoutId,
      prompt: "@@fake:hang",
    });

    // Os Runs nascem antes do boot para que só os dois `pump()` abaixo possam
    // reclamá-los: o `NOTIFY` de `createRun` sai antes do `LISTEN` começar.
    const criado = await subirWorker({ maxConcurrentRuns: 1, start: false });

    // É o entrelaçamento real: o `PgNotifyListener` dispara `void drainNow()`
    // sem serializar, então o tique e a notificação entram no mesmo turno. Os
    // dois `pump` leem `emVoo.size` antes de qualquer `emVoo.set`, porque entre
    // a leitura do teto e a reserva do slot há o `await` do claim.
    await Promise.all([criado.pump(), criado.pump()]);

    expect(criado.inFlight).toBe(1);

    // O outro Run continua na fila: reclamar leva a `PREPARING` e não há volta
    // para `QUEUED`.
    const linhas = [await linhaDoRun(db, primeiro.id), await linhaDoRun(db, segundo.id)];
    expect(linhas.filter((linha) => linha?.status === "QUEUED")).toHaveLength(1);
  });
});

describe("reconciliação na partida", () => {
  it("fecha como FAILED retentável o Run que ficou sem Worker", async () => {
    const cenario = await montarCenario(db, { nome: "orfao", workspacePath: repositorio.repo });

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "@@fake:hang",
    });

    // Simula o Worker que morreu: o Run ficou em RUNNING, reclamado por um
    // processo que não existe mais, com a Task em RUNNING junto — que é o
    // estado que `claimNextQueuedRun` deixa e um `kill -9` congela.
    await marcarComoEmExecucao(criado.id, cenario.taskId, "worker-morto");

    const novo = await subirWorker({ start: false });
    expect(novo.workerId).not.toBe("worker-morto");

    const run = await getRun(db, { userId: USER, runId: criado.id });
    expect(run?.status).toBe("FAILED");
    expect(run?.error?.["code"]).toBe("WORKER_LOST");
    expect(run?.error?.["retryable"]).toBe(true);
    expect(run?.error?.["lostWorkerId"]).toBe("worker-morto");
    expect(await statusDaTask(db, cenario.taskId)).toBe("FAILED");

    const eventos = await eventosDoRun(db, criado.id);
    expect(eventos.map((evento) => evento.type)).toEqual(["Diagnostic", "RunFailed"]);
  });

  it("não toca nos Runs do próprio processo", async () => {
    const cenario = await montarCenario(db, { nome: "meu", workspacePath: repositorio.repo });
    const workerId = newWorkerId();

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "@@fake:hang",
    });

    await marcarComoEmExecucao(criado.id, cenario.taskId, workerId);

    await subirWorker({ workerId, start: false });

    const run = await getRun(db, { userId: USER, runId: criado.id });
    expect(run?.status).toBe("RUNNING");
  });
});

describe("desligamento gracioso", () => {
  it("cancela o Run em voo e grava CANCELLED com o motivo do desligamento", async () => {
    const cenario = await montarCenario(db, { nome: "shutdown", workspacePath: repositorio.repo });
    const emExecucao = await subirWorker({ shutdownTimeoutMs: 30_000 });

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: ["@@fake:text trabalhando", "@@fake:hang"].join("\n"),
    });

    await esperarStatusDeRun(db, criado.id, ["RUNNING"]);

    await emExecucao.stop("SIGINT");
    worker = undefined;

    const terminado = await esperarStatusDeRun(db, criado.id, [
      "CANCELLED",
      "FAILED",
      "TIMED_OUT",
      "SUCCEEDED",
    ]);

    expect(terminado.status).toBe("CANCELLED");
    expect(terminado.error?.["reason"]).toBe("worker_shutdown");
    // Trabalho interrompido pelo operador é retentável: ninguém desistiu dele.
    expect(terminado.error?.["retryable"]).toBe(true);
    expect(await statusDaTask(db, cenario.taskId)).toBe("READY");
  });

  it("não inicia o Run que esperava na fila de capacidade", async () => {
    const cenario = await montarCenario(db, {
      nome: "shutdown-fila",
      workspacePath: repositorio.repo,
      workspaceStrategy: "CURRENT",
    });
    const emExecucao = await subirWorker({ maxConcurrentRuns: 2, shutdownTimeoutMs: 30_000 });

    const segurando = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: ["@@fake:text segurando a chave", "@@fake:hang"].join("\n"),
    });

    const outro = await montarCenario(db, {
      nome: "shutdown-fila-2",
      workspacePath: repositorio.repo,
      workspaceStrategy: "CURRENT",
    });
    const naFila = await enfileirar(db, {
      taskId: outro.taskId,
      loadoutId: outro.loadoutId,
      prompt: '@@fake:block {"status":"completed","summary":"nunca deveria ter rodado"}',
    });

    await esperarStatusDeRun(db, segurando.id, ["RUNNING"]);
    await esperarStatusDeRun(db, naFila.id, ["PREPARING"]);

    // `capacity.drain()` espera a fila **e a desenfileira**: sem tratar o que
    // ainda não começou, o desligamento sobe worktree e processo de agente para
    // o Run que só esperava, e o Ctrl+C vira o início de uma Expedição.
    await emExecucao.stop("SIGINT");
    worker = undefined;

    const terminado = await esperarStatusDeRun(db, naFila.id, [
      "CANCELLED",
      "SUCCEEDED",
      "FAILED",
      "TIMED_OUT",
    ]);

    expect(terminado.status).toBe("CANCELLED");
    expect(terminado.error?.["reason"]).toBe("worker_shutdown");
    expect(terminado.error?.["retryable"]).toBe(true);
    expect(await statusDaTask(db, outro.taskId)).toBe("READY");

    const eventos = await eventosDoRun(db, naFila.id);
    expect(eventos.map((evento) => evento.type)).not.toContain("RunStarted");
  });

  it("espera o pump em voo antes de percorrer os Runs em voo", async () => {
    const cenario = await montarCenario(db, {
      nome: "shutdown-pump",
      workspacePath: repositorio.repo,
    });
    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "@@fake:hang",
    });

    /**
     * Uma transação lenta, uma vez só.
     *
     * É a janela em que o `pump` já está **dentro** do `await` do claim e o
     * desligamento começa — o `void drainNow()` do `PgNotifyListener` produz
     * exatamente isso, e sem o atraso o entrelaçamento dependeria do relógio.
     */
    let atrasar = false;
    const lento = new Proxy(db as object, {
      get(alvo, prop) {
        const valor: unknown = Reflect.get(alvo, prop);
        if (prop !== "transaction" || typeof valor !== "function") {
          return typeof valor === "function" ? valor.bind(alvo) : valor;
        }
        return async (...args: unknown[]): Promise<unknown> => {
          if (atrasar) {
            atrasar = false;
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          return await (valor as (...a: unknown[]) => Promise<unknown>).apply(alvo, args);
        };
      },
    }) as Database;

    const emExecucao = await subirWorker({ db: lento, start: false, runIdleTimeoutMs: 3_000 });

    atrasar = true;
    const bombeando = emExecucao.pump();
    await emExecucao.stop("SIGINT");
    worker = undefined;
    await bombeando;

    const terminado = await esperarStatusDeRun(db, criado.id, [
      "CANCELLED",
      "SUCCEEDED",
      "FAILED",
      "TIMED_OUT",
    ]);

    expect(terminado.status).toBe("CANCELLED");
    expect(terminado.error?.["reason"]).toBe("worker_shutdown");

    const eventos = await eventosDoRun(db, criado.id);
    expect(eventos.map((evento) => evento.type)).not.toContain("RunStarted");
  });
});

describe("síntese de resultado", () => {
  it("sintetiza o desfecho quando o harness não produz resultado estruturado", async () => {
    const cenario = await montarCenario(db, { nome: "sintese", workspacePath: repositorio.repo });

    await subirWorker({
      // Um harness sem `structuredOutput` é o caso real: o worker não pede o
      // schema, e o desfecho sai do texto final.
      adapters: [fakeHarness({ capabilities: { structuredOutput: false } })],
    });

    // A matriz do snapshot é o que o worker lê; o preflight de partida já a
    // atualizou com a do adapter, então o Run precisa nascer depois do boot.
    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "@@fake:result Terminei a refatoração e rodei os testes.",
    });

    const terminado = await esperarStatusDeRun(db, criado.id, ["SUCCEEDED", "FAILED"]);

    expect(terminado.status).toBe("SUCCEEDED");
    const resultado = terminado.result as TaskExecutionResult | null;
    expect(resultado?.status).toBe("completed");
    expect(resultado?.summary).toBe("Terminei a refatoração e rodei os testes.");
    expect(await statusDaTask(db, cenario.taskId)).toBe("COMPLETED");

    const avisos = (await eventosDoRun(db, criado.id))
      .filter((evento) => evento.type === "Diagnostic")
      .map((evento) => (evento.payload as { message: string }).message);

    expect(avisos.some((mensagem) => mensagem.includes("sintetizado"))).toBe(true);
  });
});

describe("retomada de sessão", () => {
  it("recusa retomar de um Run que nunca capturou sessão", async () => {
    const cenario = await montarCenario(db, {
      nome: "resume-sem",
      workspacePath: repositorio.repo,
    });
    await subirWorker({});

    const primeiro = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: ["@@fake:no-session", "@@fake:error sem sessão"].join("\n"),
    });

    await esperarStatusDeRun(db, primeiro.id, ["FAILED"]);

    const recusa = await createRun(db, {
      userId: USER,
      taskId: cenario.taskId,
      resumeFromRunId: primeiro.id,
    });

    expect(recusa?.ok).toBe(false);
    expect(recusa?.ok === false ? recusa.failure.code : "").toBe("RESUME_SOURCE_WITHOUT_SESSION");
  });

  it("herda o Loadout do Run de origem e passa a sessão ao harness", async () => {
    const cenario = await montarCenario(db, { nome: "resume", workspacePath: repositorio.repo });
    await subirWorker({});

    const primeiro = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: [
        "@@fake:session sessao-para-retomar",
        '@@fake:block {"status":"blocked","summary":"preciso de mais contexto"}',
      ].join("\n"),
    });

    const bloqueado = await esperarStatusDeRun(db, primeiro.id, ["SUCCEEDED", "FAILED"]);
    expect(bloqueado.status).toBe("SUCCEEDED");
    expect(bloqueado.result?.status).toBe("blocked");
    expect(await statusDaTask(db, cenario.taskId)).toBe("BLOCKED");

    // `BLOCKED` não aceita Run novo; o usuário desbloqueia a Task antes.
    const { tasks: tabelaDeTasks } = await import("@dungeon-master/database");
    await db
      .update(tabelaDeTasks)
      .set({ status: "READY" })
      .where(and(eq(tabelaDeTasks.id, cenario.taskId), eq(tabelaDeTasks.userId, USER)));

    const segundo = exigirOk(
      await createRun(db, {
        userId: USER,
        taskId: cenario.taskId,
        resumeFromRunId: primeiro.id,
        prompt: '@@fake:block {"status":"completed","summary":"agora foi"}',
      }),
      "a criação do Run de retomada",
    );

    expect(segundo.resumedFromRunId).toBe(primeiro.id);
    expect(segundo.loadoutId).toBe(cenario.loadoutId);

    const terminado = await esperarStatusDeRun(db, segundo.id, ["SUCCEEDED", "FAILED"]);
    expect(terminado.status, JSON.stringify(terminado.error)).toBe("SUCCEEDED");
    expect(terminado.result?.summary).toBe("agora foi");

    // O agente falso escreve o `--session` recebido de volta como id de sessão.
    expect(terminado.harnessSessionId).toBe("sessao-para-retomar");
  });
});

describe("posse do workspace", () => {
  it("marca claimed_by com a identidade do processo", async () => {
    const cenario = await montarCenario(db, { nome: "posse", workspacePath: repositorio.repo });
    const emExecucao = await subirWorker({});

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: '@@fake:block {"status":"completed","summary":"ok"}',
    });

    await esperar("o Run ser reclamado", async () => {
      const linha = await linhaDoRun(db, criado.id);
      return linha?.claimedBy === emExecucao.workerId ? linha : null;
    });

    await esperarStatusDeRun(db, criado.id, ["SUCCEEDED", "FAILED"]);
  });

  it("o worktree do Run parte do HEAD do repositório", async () => {
    const cenario = await montarCenario(db, { nome: "base", workspacePath: repositorio.repo });
    await subirWorker({});

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: ["@@fake:sleep 300", '@@fake:block {"status":"completed","summary":"ok"}'].join("\n"),
    });

    const emPreparo = await esperar("o Run gravar o caminho do workspace", async () => {
      const run = await getRun(db, { userId: USER, runId: criado.id });
      return run?.workspacePath === null || run === null ? null : run;
    });

    const conteudo = await readFile(join(emPreparo.workspacePath as string, "README.md"), "utf8");
    expect(conteudo).toContain("# base");

    await esperarStatusDeRun(db, criado.id, ["SUCCEEDED", "FAILED"]);
    // A branch do Run some com o worktree; o repositório principal fica limpo.
    const status = await git(["status", "--porcelain"], repositorio.repo);
    expect(status.trim()).toBe("");
  });
});

describe("projetor de Conquistas", () => {
  /** Um projetor que só conta disparos: o que ele calcula é testado no banco. */
  function projetorFalso() {
    let disparos = 0;

    const projector: AchievementProjector = {
      trigger: () => {
        disparos += 1;
      },
      run: async () => await Promise.resolve({ ok: true, processed: 0, unlocked: 0, error: null }),
      drain: async () => {
        await Promise.resolve();
      },
    };

    return {
      get disparos() {
        return disparos;
      },
      projector,
    };
  }

  it("cada tique dispara o projetor, mesmo sem Run na fila", async () => {
    const falso = projetorFalso();
    const criado = await subirWorker({ start: false, achievements: falso.projector });

    await criado.pump();
    await criado.pump();

    expect(falso.disparos).toBe(2);
  });

  it("uma Expedição terminada dispara o projetor sem segurar o Run", async () => {
    const cenario = await montarCenario(db, {
      nome: "projetor",
      workspacePath: repositorio.repo,
    });
    const falso = projetorFalso();
    await subirWorker({ achievements: falso.projector });

    const run = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: '@@fake:block {"status":"completed","summary":"pronto"}',
    });

    const terminado = await esperarStatusDeRun(db, run.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);

    // O Run terminou bem: o projetor não está no caminho de escrita do desfecho.
    expect(terminado.status, JSON.stringify(terminado.error)).toBe("SUCCEEDED");
    expect(falso.disparos).toBeGreaterThan(0);
  });

  it("um projetor que lança não derruba o tique nem o Run", async () => {
    const cenario = await montarCenario(db, {
      nome: "projetor-quebrado",
      workspacePath: repositorio.repo,
    });

    // O contrato é do projetor, mas quem chama precisa sobreviver a ele: um
    // `trigger` que lança viria de dentro do `finally` que solta o Run.
    const quebrado: AchievementProjector = {
      trigger: () => {
        throw new Error("projetor quebrado");
      },
      run: async () => await Promise.resolve({ ok: false, processed: 0, unlocked: 0, error: "x" }),
      drain: async () => {
        await Promise.resolve();
      },
    };

    await subirWorker({ achievements: quebrado });

    const run = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: '@@fake:block {"status":"completed","summary":"pronto"}',
    });

    const terminado = await esperarStatusDeRun(db, run.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);
    expect(terminado.status, JSON.stringify(terminado.error)).toBe("SUCCEEDED");
    expect(await statusDaTask(db, cenario.taskId)).toBe("COMPLETED");
  });
});
