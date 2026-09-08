/**
 * O ciclo completo de um Run com `harnessKey: ANTIGRAVITY`.
 *
 * O adapter é o falso de `@dungeon-master/runtime-antigravity/testing`: ele
 * sobe um processo Node de verdade que emite o NDJSON do `agy` 1.1.27 e é
 * traduzido pelo `parseAntigravityLine` de produção. O que se prova aqui é a
 * costura que nem a suíte de contrato nem os testes de unidade cobrem — que o
 * Worker escolhe o adapter certo pela chave do Loadout, que o id de conversa
 * chega em `harness_session_id`, e que a tradução de permissão deste harness
 * aparece no diário do Run em vez de sumir.
 */

import { join } from "node:path";

import type { Database, DatabaseHandle } from "@dungeon-master/database";
import { createWorkspaceManager } from "@dungeon-master/runtime";
import { fakeAntigravity } from "@dungeon-master/runtime-antigravity/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { newWorkerId } from "../src/config.js";
import { createWorker, type Worker } from "../src/worker.js";
import {
  abrirBanco,
  CONFIG_PADRAO,
  criarRepositorio,
  enfileirar,
  esperarStatusDeRun,
  eventosDoRun,
  limpar,
  montarCenario,
  statusDaTask,
  USER,
  type RepositorioTemporario,
} from "./support.js";

let handle: DatabaseHandle;
let db: Database;
let repositorio: RepositorioTemporario;
let worker: Worker | undefined;

async function subirWorker(): Promise<Worker> {
  const criado = createWorker({
    db,
    pool: handle.pool,
    userId: USER,
    adapters: [fakeAntigravity()],
    workspace: createWorkspaceManager({ worktreesRoot: join(repositorio.sandbox, "worktrees") }),
    config: { ...CONFIG_PADRAO, workerId: newWorkerId() },
  });
  await criado.boot();
  criado.start();
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

describe("Run com harnessKey ANTIGRAVITY", () => {
  it("roda o ciclo inteiro e grava a conversa como sessão do harness", async () => {
    const cenario = await montarCenario(db, {
      nome: "antigravity",
      workspacePath: repositorio.repo,
      harnessKey: "ANTIGRAVITY",
    });
    await subirWorker();

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: [
        "@@fake:session 68daf2ab-0953-4a78-bb33-72520efee0e7",
        "@@fake:text Vou implementar.",
        "@@fake:tool run_command git status",
        "@@fake:usage 120 34",
        '@@fake:block {"status":"completed","summary":"Implementei o que a Task pedia."}',
      ].join("\n"),
    });

    const terminado = await esperarStatusDeRun(db, criado.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);

    expect(terminado.status, JSON.stringify(terminado.error)).toBe("SUCCEEDED");
    expect(terminado.result?.status).toBe("completed");
    // `conversation_id` do `init` virando `harness_session_id`: é ele que o
    // `resumeFromRunId` usa depois para o `--conversation`.
    expect(terminado.harnessSessionId).toBe("68daf2ab-0953-4a78-bb33-72520efee0e7");
    expect(terminado.harnessVersion).toBe("1.1.27-falso");
    expect(await statusDaTask(db, cenario.taskId)).toBe("COMPLETED");

    const tipos = (await eventosDoRun(db, criado.id)).map((evento) => evento.type);
    expect(tipos).toContain("SessionCaptured");
    expect(tipos).toContain("ToolCall");
    expect(tipos).toContain("ToolResult");
    expect(tipos.at(-1)).toBe("RunCompleted");
  });

  it("avisa no diário que a allow-list de comandos não vale para este harness", async () => {
    // O aviso genérico dos outros harnesses sem permissão nativa diz que a
    // lista é "indicativa". Para o Antigravity isso mandaria o usuário na
    // direção errada: a lista não é frouxa, é ignorada, e nenhum comando passa.
    const cenario = await montarCenario(db, {
      nome: "antigravity-permissao",
      workspacePath: repositorio.repo,
      harnessKey: "ANTIGRAVITY",
    });
    await subirWorker();

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt: '@@fake:block {"status":"completed","summary":"pronto"}',
    });

    await esperarStatusDeRun(db, criado.id, ["SUCCEEDED", "FAILED", "TIMED_OUT"]);

    const avisos = (await eventosDoRun(db, criado.id))
      .filter((evento) => evento.type === "Diagnostic")
      .map((evento) => JSON.stringify(evento.payload));

    expect(avisos.some((aviso) => aviso.includes("não consulta allow-list de comando"))).toBe(true);
    expect(avisos.some((aviso) => aviso.includes("allowUnsafeBypass"))).toBe(true);
  });
});
