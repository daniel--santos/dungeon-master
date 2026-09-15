import {
  getRun,
  listWorkerPresence,
  projectMetrics,
  runs,
  tasks,
  type Database,
  type DatabaseHandle,
} from "@dungeon-master/database";
import { fakeHarness } from "@dungeon-master/runtime/testing";
import { createWorkspaceManager } from "@dungeon-master/runtime";
import { and, eq } from "drizzle-orm";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { newWorkerId } from "../src/config.js";
import { createMetricProjector } from "../src/metrics.js";
import { createWorkerPresence, harnessSummary } from "../src/presence.js";
import { createWorker, type Worker } from "../src/worker.js";
import {
  abrirBanco,
  CONFIG_PADRAO,
  criarRepositorio,
  enfileirar,
  limpar,
  montarCenario,
  USER,
  type RepositorioTemporario,
} from "./support.js";

/**
 * Presença de Worker e reconciliação por batimento (Fase 10A).
 *
 * O caso que estes testes protegem é o do post-mortem #6, agora do outro lado:
 * um Worker vivo **nunca** perde um Run para outro que sobe, e um Worker morto
 * tem os Runs dele fechados sem que ninguém precise reiniciar nada.
 */

let handle: DatabaseHandle;
let db: Database;
let repositorio: RepositorioTemporario;
const vivos: Worker[] = [];

function managerPara(repo: RepositorioTemporario) {
  return createWorkspaceManager({ worktreesRoot: join(repo.sandbox, "worktrees") });
}

/** Um intervalo curto: o teste quer ver o batimento acontecer, não esperar. */
const INTERVALO_MS = 60;

beforeAll(() => {
  handle = abrirBanco(inject("databaseUrl"));
  db = handle.db;
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await limpar(handle);
  repositorio = await criarRepositorio("dm-presenca-");
});

afterEach(async () => {
  for (const worker of vivos.splice(0)) await worker.stop("fim do teste");
  await limpar(handle);
  await repositorio.remover();
});

function presencaDe(workerId: string, pid: number, intervaloMs = INTERVALO_MS) {
  return createWorkerPresence({
    db,
    userId: USER,
    workerId,
    hostname: "maquina-de-teste",
    pid,
    version: "0.0.0-teste",
    nodeVersion: process.version,
    capacity: 2,
    heartbeatIntervalMs: intervaloMs,
  });
}

async function subir(input: {
  workerId: string;
  pid: number;
  start?: boolean;
  /** Intervalo de batimento deste Worker; a janela de silêncio que ele aplica aos outros é 3× isso. */
  intervaloMs?: number;
}): Promise<Worker> {
  const intervaloMs = input.intervaloMs ?? INTERVALO_MS;
  const criado = createWorker({
    db,
    pool: handle.pool,
    userId: USER,
    adapters: [fakeHarness()],
    workspace: managerPara(repositorio),
    presence: presencaDe(input.workerId, input.pid, intervaloMs),
    config: {
      ...CONFIG_PADRAO,
      workerId: input.workerId,
      heartbeatIntervalMs: intervaloMs,
    },
  });

  await criado.boot();
  if (input.start !== false) criado.start();
  vivos.push(criado);
  return criado;
}

async function esperarAte(
  descricao: string,
  condicao: () => Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const limite = Date.now() + timeoutMs;
  for (;;) {
    if (await condicao()) return;
    if (Date.now() > limite) throw new Error(`Esgotou o tempo esperando: ${descricao}.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("presença", () => {
  it("o boot grava a linha e o desligamento gracioso a fecha", async () => {
    const id = newWorkerId();
    const worker = await subir({ workerId: id, pid: process.pid, start: false });

    const vivo = await listWorkerPresence(db, { userId: USER, staleAfterMs: INTERVALO_MS * 3 });
    expect(vivo).toHaveLength(1);
    expect(vivo[0]?.id).toBe(id);
    expect(vivo[0]?.status).toBe("ONLINE");
    expect(vivo[0]?.capacity).toBe(2);

    await worker.stop("fim do teste");
    vivos.splice(vivos.indexOf(worker), 1);

    const parado = await listWorkerPresence(db, { userId: USER, staleAfterMs: INTERVALO_MS * 3 });
    expect(parado[0]?.status).toBe("OFFLINE");
  });

  it("o resumo dos Harnesses vem do preflight do boot", () => {
    expect(
      harnessSummary([
        {
          harnessKey: "CLAUDE_CODE",
          adapterId: "claude-code@host",
          installed: true,
          version: "1.2.3",
          executablePath: undefined,
          problems: [],
          authStatus: "AUTHENTICATED",
          authReason: null,
          recorded: true,
        },
        // O mesmo Harness por um segundo adapter não vira uma segunda entrada:
        // a linha descreve a máquina, e a máquina tem uma CLI.
        {
          harnessKey: "CLAUDE_CODE",
          adapterId: "claude-code@docker",
          installed: false,
          version: null,
          executablePath: undefined,
          problems: [],
          authStatus: "UNKNOWN",
          authReason: null,
          recorded: true,
        },
      ]),
    ).toEqual([{ key: "CLAUDE_CODE", version: "1.2.3", authStatus: "AUTHENTICATED" }]);
  });
});

describe("reconciliação por batimento", () => {
  it("um Worker vivo não perde o Run dele para outro que sobe", async () => {
    const cenario = await montarCenario(db, { nome: "disputado", workspacePath: repositorio.repo });
    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "@@fake:hang",
    });

    const primeiro = newWorkerId();
    await subir({ workerId: primeiro, pid: process.pid, start: false });

    // O Run está com o primeiro Worker, que está batendo.
    await db
      .update(runs)
      .set({ status: "RUNNING", claimedBy: primeiro, startedAt: new Date() })
      .where(and(eq(runs.id, criado.id), eq(runs.userId, USER)));
    await db
      .update(tasks)
      .set({ status: "RUNNING" })
      .where(and(eq(tasks.id, cenario.taskId), eq(tasks.userId, USER)));

    // O segundo sobe e reconcilia no boot: não pode encostar no Run do primeiro.
    //
    // post-mortem #27 (15/09/2026): com os dois Workers em INTERVALO_MS, a janela de
    // silêncio era de 180 ms, e no runner do Windows do CI os dois UPDATEs acima mais o
    // boot do segundo levaram mais do que isso — o primeiro, que não bate porque subiu
    // com `start: false`, foi julgado silencioso e o Run fechou como FAILED. O julgamento
    // usa a janela de quem reconcilia, então o segundo sobe com um intervalo largo: o que
    // este teste prova é que um batimento recente protege o Run, não que 180 ms é o prazo.
    await subir({ workerId: newWorkerId(), pid: process.pid, start: false, intervaloMs: 5_000 });

    const run = await getRun(db, { userId: USER, runId: criado.id });
    expect(run?.status).toBe("RUNNING");
  });

  it("o sobrevivente fecha, no tique, o Run de um colega que parou de bater", async () => {
    const cenario = await montarCenario(db, {
      nome: "abandonado",
      workspacePath: repositorio.repo,
    });
    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "@@fake:hang",
    });

    // O colega existe, registrou presença e nunca mais bateu. Nenhum processo é
    // morto aqui: o que o teste exercita é a consequência do silêncio.
    const morto = newWorkerId();
    await presencaDe(morto, 999_999).register([]);
    await db
      .update(runs)
      .set({ status: "RUNNING", claimedBy: morto, startedAt: new Date() })
      .where(and(eq(runs.id, criado.id), eq(runs.userId, USER)));
    await db
      .update(tasks)
      .set({ status: "RUNNING" })
      .where(and(eq(tasks.id, cenario.taskId), eq(tasks.userId, USER)));

    // O sobrevivente sobe **depois** do prazo de silêncio e fecha no laço, sem
    // reinício nenhum: é a diferença que a Fase 10A traz.
    await new Promise((resolve) => setTimeout(resolve, INTERVALO_MS * 3 + 50));
    await subir({ workerId: newWorkerId(), pid: process.pid });

    await esperarAte("o Run do colega morto ser fechado", async () => {
      const run = await getRun(db, { userId: USER, runId: criado.id });
      return run?.status === "FAILED";
    });

    const run = await getRun(db, { userId: USER, runId: criado.id });
    expect(run?.error?.["code"]).toBe("WORKER_LOST");
    expect(run?.error?.["retryable"]).toBe(true);
    expect(run?.error?.["reason"]).toBe("WORKER_STALE");
    expect(run?.error?.["lostWorkerId"]).toBe(morto);

    // E o colega aparece como silencioso na presença.
    const presentes = await listWorkerPresence(db, {
      userId: USER,
      staleAfterMs: INTERVALO_MS * 3,
    });
    expect(presentes.find((linha) => linha.id === morto)?.status).toBe("STALE");
  });
});

describe("projeção de métricas no laço", () => {
  it("o Run reconciliado aparece nas métricas, e o anúncio sai uma vez por lote", async () => {
    const cenario = await montarCenario(db, { nome: "medido", workspacePath: repositorio.repo });
    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: "@@fake:hang",
    });

    const morto = newWorkerId();
    await presencaDe(morto, 999_998).register([]);
    await db
      .update(runs)
      .set({ status: "RUNNING", claimedBy: morto, startedAt: new Date() })
      .where(and(eq(runs.id, criado.id), eq(runs.userId, USER)));
    await db
      .update(tasks)
      .set({ status: "RUNNING" })
      .where(and(eq(tasks.id, cenario.taskId), eq(tasks.userId, USER)));

    await new Promise((resolve) => setTimeout(resolve, INTERVALO_MS * 3 + 50));
    await subir({ workerId: newWorkerId(), pid: process.pid });

    await esperarAte("o Run do colega morto ser fechado", async () => {
      const run = await getRun(db, { userId: USER, runId: criado.id });
      return run?.status === "FAILED";
    });

    // O projetor do laço tem o atraso de segurança de um segundo; aqui a
    // projeção é forçada sem ele, que é o que o `rebuild` também faz.
    const relatorio = await projectMetrics(db, { userId: USER, lagMs: 0 });
    expect(relatorio.ok).toBe(true);

    const linhas = await handle.pool.query<{ status: string }>(
      "select status from run_metric where run_id = $1",
      [criado.id],
    );
    expect(linhas.rows).toEqual([{ status: "FAILED" }]);
  });

  it("a garganta segura o segundo anúncio dentro da janela", async () => {
    let relogio = 0;
    const projetor = createMetricProjector({
      db,
      userId: USER,
      throttleMs: 5_000,
      now: () => relogio,
    });

    // Dois Runs terminais em Tasks diferentes, fechados em lotes diferentes:
    // sem a garganta seriam dois `metrics.updated` para a mesma tela.
    for (const titulo of ["a", "b"]) {
      const cenario = await montarCenario(db, {
        nome: `anunciado-${titulo}`,
        workspacePath: repositorio.repo,
      });
      const run = await enfileirar(db, {
        taskId: cenario.taskId,
        loadoutId: cenario.loadoutId,
        prompt: `@@fake:${titulo}`,
      });
      await db
        .update(runs)
        .set({
          status: "SUCCEEDED",
          startedAt: new Date(Date.now() - 2_000),
          finishedAt: new Date(Date.now() - 1_000),
        })
        .where(and(eq(runs.id, run.id), eq(runs.userId, USER)));

      projetor.trigger();
      await projetor.drain();
      relogio += 100;
    }

    const anuncios = await handle.pool.query<{ total: string }>(
      "select count(*)::text as total from dashboard_event where user_id = $1 and type = 'metrics.updated'",
      [USER],
    );
    expect(anuncios.rows[0]?.total).toBe("1");
  });
});
