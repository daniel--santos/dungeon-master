import { TerminalStatusWriteError } from "@dungeon-master/events";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { createDatabase, type DatabaseHandle } from "../src/client.js";
import { newId } from "../src/ids.js";
import {
  appendRunEvent,
  latestRunEventSequence,
  listRunEventsSince,
  persistRunEvent,
} from "../src/run-event.js";
import {
  claimNextQueuedRun,
  countQueuedRuns,
  createRun,
  getRun,
  listRuns,
  requestRunCancellation,
  transitionRun,
  writeRunTerminalStatus,
} from "../src/run.js";
import { getTaskDetail } from "../src/task.js";
import {
  acquireWorkspaceLock,
  getActiveRunByPath,
  listWorkspaceLocksByRun,
  releaseWorkspaceLock,
} from "../src/workspace-lock.js";
import {
  criarEquipamento,
  criarProjectComWorkspace,
  criarTask,
  type Equipamento,
  exigirOk,
  limparExecucao,
  USER,
} from "./support.js";

let handle: DatabaseHandle;
let equipamento: Equipamento;
let projectId: string;

const REPO = "C:\\repos\\forja";

beforeAll(() => {
  handle = createDatabase({
    url: inject("databaseUrl"),
    max: 6,
    applicationName: "vitest-execucao",
  });
});

beforeEach(async () => {
  await limparExecucao(handle);
  const project = await criarProjectComWorkspace(handle.db, {
    title: "Forja de Widgets",
    workspacePath: REPO,
  });
  projectId = project.id;
  equipamento = await criarEquipamento(handle.db, { nome: "de teste" });
});

afterAll(async () => {
  await limparExecucao(handle);
  await handle.close();
});

async function criarRunEmTask(titulo: string): Promise<{ runId: string; taskId: string }> {
  const task = await criarTask(handle.db, { projectId, title: titulo });
  const run = exigirOk(
    await createRun(handle.db, {
      userId: USER,
      taskId: task.id,
      loadoutId: equipamento.loadoutId,
    }),
    `a criação do Run de "${titulo}"`,
  );
  return { runId: run.id, taskId: task.id };
}

describe("createRun", () => {
  it("nasce em QUEUED, com snapshot e a Task enfileirada junto", async () => {
    const task = await criarTask(handle.db, { projectId, title: "Forjar a bigorna" });

    const run = exigirOk(
      await createRun(handle.db, {
        userId: USER,
        taskId: task.id,
        loadoutId: equipamento.loadoutId,
      }),
      "a criação do Run",
    );

    expect(run.status).toBe("QUEUED");
    expect(run.attempt).toBe(1);
    expect(run.harnessKey).toBe("CLAUDE_CODE");
    expect(run.executionMode).toBe("HOST");
    expect(run.loadoutVersion).toBe(1);
    expect(run.loadoutSnapshot.agent.instructions).toBe("Implemente o que a Missão pede.");
    expect(run.executionProfileSnapshot.workspaceStrategy).toBe("GIT_WORKTREE");
    // O prompt vem do título quando não há descrição.
    expect(run.prompt).toBe("Forjar a bigorna");

    const detalhe = await getTaskDetail(handle.db, { userId: USER, taskId: task.id });
    expect(detalhe?.status).toBe("QUEUED");
  });

  it("numera as tentativas de uma Task", async () => {
    const { runId, taskId } = await criarRunEmTask("Duas tentativas");

    // `QUEUED` não chega a `FAILED` direto: a falha só existe a partir de
    // `PREPARING`, que é quando o Run começou a fazer alguma coisa.
    await claimNextQueuedRun(handle.db, { userId: USER });

    exigirOk(
      await writeRunTerminalStatus(handle.db, {
        userId: USER,
        runId,
        status: "FAILED",
        error: { message: "não deu" },
      }),
      "a primeira falha",
    );

    const segundo = exigirOk(
      await createRun(handle.db, { userId: USER, taskId, loadoutId: equipamento.loadoutId }),
      "a retentativa",
    );

    expect(segundo.attempt).toBe(2);
  });

  it("recusa uma Task fora de READY e FAILED", async () => {
    const { taskId } = await criarRunEmTask("Já enfileirada");

    const segunda = await createRun(handle.db, {
      userId: USER,
      taskId,
      loadoutId: equipamento.loadoutId,
    });

    expect(segunda?.ok).toBe(false);
    if (segunda === null || segunda.ok) return;
    expect(segunda.failure).toEqual({
      code: "RUN_NOT_ALLOWED",
      rejection: { code: "TASK_NOT_RUNNABLE", status: "QUEUED", allowed: ["READY", "FAILED"] },
    });
  });

  it("recusa um Project sem workspace", async () => {
    const semWorkspace = await criarProjectComWorkspace(handle.db, {
      title: "Sem diretório",
      workspacePath: "",
    });
    const task = await criarTask(handle.db, {
      projectId: semWorkspace.id,
      title: "Nada onde rodar",
    });

    const criado = await createRun(handle.db, {
      userId: USER,
      taskId: task.id,
      loadoutId: equipamento.loadoutId,
    });

    expect(criado?.ok).toBe(false);
    if (criado === null || criado.ok) return;
    expect(criado.failure.code).toBe("RUN_NOT_ALLOWED");
  });

  it("devolve null para uma Task que não existe", async () => {
    const criado = await createRun(handle.db, {
      userId: USER,
      taskId: newId(),
      loadoutId: equipamento.loadoutId,
    });

    expect(criado).toBeNull();
  });
});

describe("claimNextQueuedRun", () => {
  it("leva o Run a PREPARING e a Task a RUNNING, devolvendo o workspace", async () => {
    const { runId, taskId } = await criarRunEmTask("Para reclamar");

    const reclamado = await claimNextQueuedRun(handle.db, { userId: USER });

    expect(reclamado?.run.id).toBe(runId);
    expect(reclamado?.run.status).toBe("PREPARING");
    expect(reclamado?.project.workspacePath).toBe(REPO);
    expect(reclamado?.project.workspaceKind).toBe("GIT_REPO");

    const detalhe = await getTaskDetail(handle.db, { userId: USER, taskId });
    expect(detalhe?.status).toBe("RUNNING");
  });

  it("devolve null com a fila vazia", async () => {
    expect(await claimNextQueuedRun(handle.db, { userId: USER })).toBeNull();
  });

  it("duas chamadas concorrentes pegam Runs distintos", async () => {
    const primeiro = await criarRunEmTask("Concorrente A");
    const segundo = await criarRunEmTask("Concorrente B");

    expect(await countQueuedRuns(handle.db, { userId: USER })).toBe(2);

    // `FOR UPDATE SKIP LOCKED`: a linha já travada é pulada, não disputada.
    // Sem isso, uma das duas esperaria a outra e as duas pegariam o mesmo Run.
    const [a, b] = await Promise.all([
      claimNextQueuedRun(handle.db, { userId: USER }),
      claimNextQueuedRun(handle.db, { userId: USER }),
    ]);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a?.run.id).not.toBe(b?.run.id);
    expect([a?.run.id, b?.run.id].sort()).toEqual([primeiro.runId, segundo.runId].sort());
    expect(await countQueuedRuns(handle.db, { userId: USER })).toBe(0);
  });

  it("pula um Run com cancelamento pedido", async () => {
    const { runId } = await criarRunEmTask("Cancelado antes de rodar");

    exigirOk(
      await requestRunCancellation(handle.db, { userId: USER, runId }),
      "o pedido de cancelamento",
    );

    expect(await claimNextQueuedRun(handle.db, { userId: USER })).toBeNull();
  });
});

describe("requestRunCancellation", () => {
  it("cancela na hora em QUEUED e devolve a Task a READY", async () => {
    const { runId, taskId } = await criarRunEmTask("Cancelar antes de rodar");

    const cancelado = exigirOk(
      await requestRunCancellation(handle.db, { userId: USER, runId }),
      "o cancelamento",
    );

    expect(cancelado.status).toBe("CANCELLED");
    expect(cancelado.cancelRequestedAt).not.toBeNull();
    expect(cancelado.finishedAt).not.toBeNull();

    // Cancelar a execução não cancela a tarefa: o trabalho volta ao quadro.
    const detalhe = await getTaskDetail(handle.db, { userId: USER, taskId });
    expect(detalhe?.status).toBe("READY");
  });

  it("em RUNNING apenas marca o pedido; quem transiciona é quem matou a árvore", async () => {
    const { runId, taskId } = await criarRunEmTask("Cancelar rodando");
    await claimNextQueuedRun(handle.db, { userId: USER });
    exigirOk(
      await transitionRun(handle.db, { userId: USER, runId, to: "RUNNING" }),
      "a ida para RUNNING",
    );

    const pedido = exigirOk(
      await requestRunCancellation(handle.db, { userId: USER, runId }),
      "o pedido",
    );

    expect(pedido.status).toBe("RUNNING");
    expect(pedido.cancelRequestedAt).not.toBeNull();

    const detalhe = await getTaskDetail(handle.db, { userId: USER, taskId });
    expect(detalhe?.status).toBe("RUNNING");
  });

  it("é idempotente", async () => {
    const { runId } = await criarRunEmTask("Cancelar duas vezes");

    const primeiro = exigirOk(
      await requestRunCancellation(handle.db, { userId: USER, runId }),
      "o primeiro pedido",
    );
    const segundo = exigirOk(
      await requestRunCancellation(handle.db, { userId: USER, runId }),
      "o segundo pedido",
    );

    expect(segundo.status).toBe("CANCELLED");
    expect(segundo.cancelRequestedAt).toBe(primeiro.cancelRequestedAt);
  });

  it("recusa um Run que já terminou", async () => {
    const { runId } = await criarRunEmTask("Já terminado");
    await claimNextQueuedRun(handle.db, { userId: USER });
    exigirOk(
      await writeRunTerminalStatus(handle.db, {
        userId: USER,
        runId,
        status: "FAILED",
        error: { message: "acabou" },
      }),
      "a falha",
    );

    const cancelado = await requestRunCancellation(handle.db, { userId: USER, runId });

    expect(cancelado?.ok).toBe(false);
    if (cancelado === null || cancelado.ok) return;
    expect(cancelado.failure).toEqual({ code: "RUN_ALREADY_FINISHED", status: "FAILED" });
  });
});

describe("writeRunTerminalStatus", () => {
  async function ateRunning(titulo: string): Promise<{ runId: string; taskId: string }> {
    const criado = await criarRunEmTask(titulo);
    await claimNextQueuedRun(handle.db, { userId: USER });
    exigirOk(
      await transitionRun(handle.db, { userId: USER, runId: criado.runId, to: "RUNNING" }),
      "a ida para RUNNING",
    );
    return criado;
  }

  it("o veredito do agente decide o destino da Task", async () => {
    for (const [veredito, esperado] of [
      ["completed", "COMPLETED"],
      ["blocked", "BLOCKED"],
      ["failed", "FAILED"],
    ] as const) {
      const { runId, taskId } = await ateRunning(`Veredito ${veredito}`);

      exigirOk(
        await writeRunTerminalStatus(handle.db, {
          userId: USER,
          runId,
          status: "SUCCEEDED",
          result: { status: veredito, summary: "pronto" },
        }),
        `o resultado ${veredito}`,
      );

      const detalhe = await getTaskDetail(handle.db, { userId: USER, taskId });
      expect(detalhe?.status, veredito).toBe(esperado);
    }
  });

  it("TIMED_OUT leva a Task a FAILED", async () => {
    const { runId, taskId } = await ateRunning("Estourou o tempo");

    exigirOk(
      await writeRunTerminalStatus(handle.db, {
        userId: USER,
        runId,
        status: "TIMED_OUT",
        error: { message: "tempo esgotado" },
      }),
      "o timeout",
    );

    const detalhe = await getTaskDetail(handle.db, { userId: USER, taskId });
    expect(detalhe?.status).toBe("FAILED");
  });

  it("libera a trava de workspace no mesmo COMMIT", async () => {
    const { runId } = await ateRunning("Segura e solta");

    const trava = await acquireWorkspaceLock(handle.db, {
      userId: USER,
      repoPath: REPO,
      checkoutPath: `${REPO}\\.runs\\${runId}`,
      runId,
    });
    expect(trava.acquired).toBe(true);

    exigirOk(
      await writeRunTerminalStatus(handle.db, {
        userId: USER,
        runId,
        status: "SUCCEEDED",
        result: { status: "completed" },
      }),
      "o sucesso",
    );

    expect(await listWorkspaceLocksByRun(handle.db, { userId: USER, runId })).toEqual([]);
  });

  it("grava tudo ou nada: uma falha no meio desfaz o status e a transição", async () => {
    const { runId, taskId } = await ateRunning("Tudo ou nada");

    // `BigInt` não é serializável para jsonb: a falha estoura **depois** de o
    // Run e a Task já terem sido atualizados dentro da transação, que é
    // exatamente o momento em que uma escrita parcial deixaria o pior estado
    // possível — Run terminado com a Task ainda em RUNNING.
    await expect(
      writeRunTerminalStatus(handle.db, {
        userId: USER,
        runId,
        status: "SUCCEEDED",
        result: { status: "completed" },
        events: [{ type: "RunSucceeded", payload: { impossivel: 1n } as never }],
      }),
    ).rejects.toBeInstanceOf(TerminalStatusWriteError);

    const run = await getRun(handle.db, { userId: USER, runId });
    expect(run?.status).toBe("RUNNING");
    expect(run?.finishedAt).toBeNull();

    const detalhe = await getTaskDetail(handle.db, { userId: USER, taskId });
    expect(detalhe?.status).toBe("RUNNING");

    expect(await latestRunEventSequence(handle.db, { runId })).toBe(0);
  });

  it("recusa sem escrever nada quando a Task não aceita o destino", async () => {
    const { runId, taskId } = await ateRunning("Task travada");

    // A Task vai a COMPLETED por outro caminho; o Run terminando depois pediria
    // COMPLETED → FAILED, que não existe na máquina de estados.
    exigirOk(
      await writeRunTerminalStatus(handle.db, {
        userId: USER,
        runId,
        status: "SUCCEEDED",
        result: { status: "completed" },
      }),
      "o primeiro término",
    );

    const detalhe = await getTaskDetail(handle.db, { userId: USER, taskId });
    expect(detalhe?.status).toBe("COMPLETED");

    const outro = await criarRunEmTask("Outro Run");
    await claimNextQueuedRun(handle.db, { userId: USER });
    const segundo = await writeRunTerminalStatus(handle.db, {
      userId: USER,
      runId: outro.runId,
      status: "SUCCEEDED",
      result: { status: "completed" },
    });
    // O segundo Run está em PREPARING e não em RUNNING: a máquina de Run recusa.
    expect(segundo?.ok).toBe(false);
    if (segundo === null || segundo.ok) return;
    expect(segundo.failure.code).toBe("RUN_TRANSITION_REJECTED");

    const aindaPreparing = await getRun(handle.db, { userId: USER, runId: outro.runId });
    expect(aindaPreparing?.status).toBe("PREPARING");
  });

  it("recusa um estado não terminal", async () => {
    const { runId } = await ateRunning("Estado errado");

    await expect(
      writeRunTerminalStatus(handle.db, { userId: USER, runId, status: "RUNNING" }),
    ).rejects.toThrow(/só aceita estado terminal/);
  });
});

describe("run_event", () => {
  it("a sequence é estritamente crescente e começa em 1 por Run", async () => {
    const a = await criarRunEmTask("Log A");
    const b = await criarRunEmTask("Log B");

    for (const tipo of ["RunQueued", "RunPreparing", "RunStarted"]) {
      await persistRunEvent(handle.db, { userId: USER, runId: a.runId, event: { type: tipo } });
    }
    await persistRunEvent(handle.db, {
      userId: USER,
      runId: b.runId,
      event: { type: "RunQueued" },
    });

    const eventosA = await listRunEventsSince(handle.db, {
      userId: USER,
      runId: a.runId,
      afterSequence: 0,
    });
    const eventosB = await listRunEventsSince(handle.db, {
      userId: USER,
      runId: b.runId,
      afterSequence: 0,
    });

    expect(eventosA.map((evento) => evento.sequence)).toEqual([1, 2, 3]);
    expect(eventosA.map((evento) => evento.type)).toEqual([
      "RunQueued",
      "RunPreparing",
      "RunStarted",
    ]);
    // A numeração é por Run: o segundo Run recomeça em 1.
    expect(eventosB.map((evento) => evento.sequence)).toEqual([1]);
  });

  it("não deixa lacuna mesmo com escritas concorrentes no mesmo Run", async () => {
    const { runId } = await criarRunEmTask("Rajada");

    await Promise.all(
      Array.from({ length: 8 }, (_, indice) =>
        persistRunEvent(handle.db, {
          userId: USER,
          runId,
          event: { type: `Evento${String(indice)}` },
        }),
      ),
    );

    const eventos = await listRunEventsSince(handle.db, {
      userId: USER,
      runId,
      afterSequence: 0,
    });

    expect(eventos.map((evento) => evento.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("o cursor devolve só o que veio depois", async () => {
    const { runId } = await criarRunEmTask("Cursor");

    for (const tipo of ["A", "B", "C"]) {
      await persistRunEvent(handle.db, { userId: USER, runId, event: { type: tipo } });
    }

    const depoisDoPrimeiro = await listRunEventsSince(handle.db, {
      userId: USER,
      runId,
      afterSequence: 1,
    });

    expect(depoisDoPrimeiro.map((evento) => evento.type)).toEqual(["B", "C"]);
    expect(await latestRunEventSequence(handle.db, { runId })).toBe(3);
  });

  it("o sanitizador tira o token do payload antes de persistir", async () => {
    const { runId } = await criarRunEmTask("Com segredo");
    const token = "ghp_abcdefghijklmnop";
    const anterior = process.env["GH_TOKEN"];
    process.env["GH_TOKEN"] = token;

    try {
      await persistRunEvent(handle.db, {
        userId: USER,
        runId,
        event: {
          type: "ToolCalled",
          payload: { command: `git push https://${token}@github.com/u/r`, token },
        },
      });
    } finally {
      if (anterior === undefined) delete process.env["GH_TOKEN"];
      else process.env["GH_TOKEN"] = anterior;
    }

    const [evento] = await listRunEventsSince(handle.db, {
      userId: USER,
      runId,
      afterSequence: 0,
    });

    const serializado = JSON.stringify(evento?.payload);
    // O log é append-only: uma credencial que entrar fica.
    expect(serializado).not.toContain(token);
    expect(serializado).toContain("[REDACTED]");
  });

  it("persistRunEvent propaga a falha", async () => {
    await expect(
      persistRunEvent(handle.db, {
        userId: USER,
        runId: newId(),
        event: { type: "OrfaoSemRun" },
      }),
    ).rejects.toThrow(/não existe/);
  });

  it("appendRunEvent não lança com o banco fora do ar", async () => {
    const desconectado = createDatabase({
      url: inject("databaseUrl"),
      max: 1,
      applicationName: "vitest-banco-fora",
    });
    await desconectado.close();

    const avisos: string[] = [];

    const gravado = await appendRunEvent(desconectado.db, {
      userId: USER,
      runId: newId(),
      event: { type: "TextDelta", payload: { text: "oi" } },
      logger: { warn: (_campos, mensagem) => avisos.push(mensagem) },
    });

    // Observabilidade pura: perder um evento custa uma linha da timeline,
    // derrubar o Run por causa dele custaria a execução inteira.
    expect(gravado).toBeNull();
    expect(avisos).toContain("run_event_append_failed");
  });
});

describe("workspace_lock", () => {
  it("o segundo Run no mesmo caminho é recusado", async () => {
    const primeiro = await criarRunEmTask("Segura o repositório");
    const segundo = await criarRunEmTask("Quer o mesmo caminho");

    await claimNextQueuedRun(handle.db, { userId: USER });
    exigirOk(
      await transitionRun(handle.db, { userId: USER, runId: primeiro.runId, to: "RUNNING" }),
      "a ida do primeiro para RUNNING",
    );

    const a = await acquireWorkspaceLock(handle.db, {
      userId: USER,
      repoPath: REPO,
      checkoutPath: REPO,
      runId: primeiro.runId,
    });
    const b = await acquireWorkspaceLock(handle.db, {
      userId: USER,
      repoPath: REPO,
      checkoutPath: REPO,
      runId: segundo.runId,
    });

    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(false);
    if (b.acquired) return;
    expect(b.heldBy).toBe(primeiro.runId);
    expect(b.reason).toBe("RUNNING");
  });

  it("é idempotente para o mesmo Run", async () => {
    const { runId } = await criarRunEmTask("Pede duas vezes");
    const alvo = { userId: USER, repoPath: REPO, checkoutPath: REPO, runId };

    expect((await acquireWorkspaceLock(handle.db, alvo)).acquired).toBe(true);
    expect((await acquireWorkspaceLock(handle.db, alvo)).acquired).toBe(true);
    expect(await listWorkspaceLocksByRun(handle.db, { userId: USER, runId })).toHaveLength(1);
  });

  it("caminhos diferentes no mesmo repositório não colidem", async () => {
    const a = await criarRunEmTask("Worktree A");
    const b = await criarRunEmTask("Worktree B");

    const primeira = await acquireWorkspaceLock(handle.db, {
      userId: USER,
      repoPath: REPO,
      checkoutPath: `${REPO}\\.runs\\${a.runId}`,
      runId: a.runId,
    });
    const segunda = await acquireWorkspaceLock(handle.db, {
      userId: USER,
      repoPath: REPO,
      checkoutPath: `${REPO}\\.runs\\${b.runId}`,
      runId: b.runId,
    });

    expect(primeira.acquired).toBe(true);
    expect(segunda.acquired).toBe(true);
  });

  it("recupera a trava de um Run que já terminou", async () => {
    const morto = await criarRunEmTask("Worker que morreu");
    const vivo = await criarRunEmTask("Quer o caminho de volta");

    await acquireWorkspaceLock(handle.db, {
      userId: USER,
      repoPath: REPO,
      checkoutPath: REPO,
      runId: morto.runId,
    });

    await claimNextQueuedRun(handle.db, { userId: USER });
    exigirOk(
      await transitionRun(handle.db, { userId: USER, runId: morto.runId, to: "RUNNING" }),
      "a ida para RUNNING",
    );
    // Cancela sem liberar: simula o worker que morreu com a trava na mão.
    await handle.pool.query("update run set status = 'FAILED', finished_at = now() where id = $1", [
      morto.runId,
    ]);

    const recuperada = await acquireWorkspaceLock(handle.db, {
      userId: USER,
      repoPath: REPO,
      checkoutPath: REPO,
      runId: vivo.runId,
    });

    expect(recuperada.acquired).toBe(true);
    if (!recuperada.acquired) return;
    expect(recuperada.reclaimed).toBe(true);
  });

  it("entre dois Runs que ainda não começaram, vence o de id menor", async () => {
    const primeiro = await criarRunEmTask("Criado antes");
    const segundo = await criarRunEmTask("Criado depois");

    // O id é UUIDv7: a ordem lexicográfica é a ordem de criação.
    expect(primeiro.runId < segundo.runId).toBe(true);

    // O mais novo chega primeiro à trava, e mesmo assim perde.
    const doNovo = await acquireWorkspaceLock(handle.db, {
      userId: USER,
      repoPath: REPO,
      checkoutPath: REPO,
      runId: segundo.runId,
    });
    const doVelho = await acquireWorkspaceLock(handle.db, {
      userId: USER,
      repoPath: REPO,
      checkoutPath: REPO,
      runId: primeiro.runId,
    });

    expect(doNovo.acquired).toBe(true);
    expect(doVelho.acquired).toBe(true);

    const dono = await getActiveRunByPath(handle.db, {
      userId: USER,
      repoPath: REPO,
      checkoutPath: REPO,
    });
    expect(dono?.id).toBe(primeiro.runId);

    // E o mais novo, pedindo de novo, agora é recusado pelo mesmo critério.
    const denovo = await acquireWorkspaceLock(handle.db, {
      userId: USER,
      repoPath: REPO,
      checkoutPath: REPO,
      runId: segundo.runId,
    });
    expect(denovo.acquired).toBe(false);
    if (denovo.acquired) return;
    expect(denovo.reason).toBe("OLDER_RUN_WINS");
  });

  it("libera por Run e devolve quantas saíram", async () => {
    const { runId } = await criarRunEmTask("Solta tudo");

    await acquireWorkspaceLock(handle.db, {
      userId: USER,
      repoPath: REPO,
      checkoutPath: REPO,
      runId,
    });
    await acquireWorkspaceLock(handle.db, {
      userId: USER,
      repoPath: REPO,
      checkoutPath: `${REPO}\\.runs\\${runId}`,
      runId,
    });

    expect(await releaseWorkspaceLock(handle.db, { userId: USER, runId })).toBe(2);
    expect(await releaseWorkspaceLock(handle.db, { userId: USER, runId })).toBe(0);
    expect(
      await getActiveRunByPath(handle.db, { userId: USER, repoPath: REPO, checkoutPath: REPO }),
    ).toBeNull();
  });
});

describe("listRuns", () => {
  it("filtra por Task, por Project e por estado", async () => {
    const a = await criarRunEmTask("Run A");
    await criarRunEmTask("Run B");

    const porTask = await listRuns(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { taskId: a.taskId },
    });
    expect(porTask.items.map((run) => run.id)).toEqual([a.runId]);

    const porProject = await listRuns(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { projectId },
    });
    expect(porProject.total).toBe(2);
    expect(porProject.items.every((run) => run.projectId === projectId)).toBe(true);

    const porEstado = await listRuns(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 10,
      filters: { status: ["SUCCEEDED"] },
    });
    expect(porEstado.total).toBe(0);
  });
});
