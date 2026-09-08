import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Database, DatabaseHandle } from "@dungeon-master/database";
import { claudeCode } from "@dungeon-master/runtime-sandcastle";
import { createWorkspaceManager } from "@dungeon-master/runtime";
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

/**
 * O fim a fim com o Claude Code de verdade.
 *
 * Desligado por padrão: ele exige a CLI instalada e autenticada, gasta tokens e
 * leva minutos. A suíte do CI prova a costura com o harness falso, que é fiel
 * em tudo que costuma quebrar — processo, sinal, encerramento — menos o modelo.
 * Este aqui prova o que só a CLI real prova: o argv que montamos, o NDJSON que
 * ela emite hoje e o bloco `<result>` que o modelo escreve à mão.
 *
 * Para rodar:
 *
 * ```bash
 * DM_E2E_CLAUDE_CODE=1 pnpm --filter @dungeon-master/worker test
 * ```
 */

const ligado = process.env["DM_E2E_CLAUDE_CODE"] === "1";

describe.skipIf(!ligado)("fim a fim com o Claude Code real", () => {
  let handle: DatabaseHandle;
  let db: Database;
  let repositorio: RepositorioTemporario;
  let worker: Worker | undefined;

  beforeAll(() => {
    handle = abrirBanco(inject("databaseUrl"));
    db = handle.db;
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(async () => {
    await limpar(handle);
    repositorio = await criarRepositorio("dm-worker-e2e-");
  });

  afterEach(async () => {
    await worker?.stop("fim do teste");
    worker = undefined;
    await limpar(handle);
    await repositorio.remover();
  });

  it("cria um arquivo, faz commit e devolve o resultado estruturado", async () => {
    const cenario = await montarCenario(db, {
      nome: "claude-real",
      workspacePath: repositorio.repo,
      // Sem sobrescrever nada: vale o "Campo aberto" como a semente o cria —
      // `ALLOWLIST` com os cinco subcomandos de `DEFAULT_TRUSTED_COMMANDS` e
      // sem opt-in de bypass. É o perfil que o usuário recebe de fábrica, e é
      // ele que precisa terminar uma tarefa de código. Desde que a lista
      // passou a ser compartilhada, `commandExecution: ALL` concede
      // exatamente os mesmos cinco prefixos, então o caso de antes virou o
      // mesmo teste com um caminho a menos.
    });

    worker = createWorker({
      db,
      pool: handle.pool,
      userId: USER,
      adapters: [claudeCode()],
      workspace: createWorkspaceManager({ worktreesRoot: join(repositorio.sandbox, "worktrees") }),
      config: {
        ...CONFIG_PADRAO,
        workerId: newWorkerId(),
        runIdleTimeoutMs: 180_000,
        runCompletionTimeoutMs: 600_000,
      },
    });

    await worker.boot();
    worker.start();

    const criado = await enfileirar(db, {
      taskId: cenario.taskId,
      loadoutId: cenario.loadoutId,
      prompt:
        "Crie um arquivo OLA.md na raiz do repositório com o texto 'Olá do Dungeon Master.' " +
        "e faça um commit com a mensagem 'chore: adiciona OLA.md'. Não faça mais nada.",
    });

    const terminado = await esperarStatusDeRun(
      db,
      criado.id,
      ["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"],
      600_000,
    );

    expect(terminado.status, JSON.stringify(terminado.error)).toBe("SUCCEEDED");
    expect(terminado.result?.status).toBe("completed");
    expect(terminado.harnessSessionId).toBeTruthy();
    expect(terminado.harnessVersion).toBeTruthy();
    expect(await statusDaTask(db, cenario.taskId)).toBe("COMPLETED");

    const commits = terminado.result?.["commits"] as
      ReadonlyArray<{ sha: string; subject: string }> | undefined;
    expect(commits, "o commit do agente foi coletado do worktree").toBeDefined();
    expect(commits?.length ?? 0).toBeGreaterThan(0);

    // O worktree só é preservado quando sobra mudança não commitada; um Run
    // que commitou tudo deixa o diretório para trás.
    const preservado = terminado.result?.["preservedWorktreePath"] as string | undefined;
    if (preservado !== undefined) {
      expect(await readFile(join(preservado, "OLA.md"), "utf8")).toContain("Olá");
    }

    const tipos = (await eventosDoRun(db, criado.id)).map((evento) => evento.type);
    // Os diagnósticos de política vêm **antes** de `RunStarted`: eles descrevem
    // o que foi concedido, e a concessão é decidida antes de o processo subir.
    // A asserção antiga pedia `RunStarted` na primeira posição e só não pegava
    // isso porque este arquivo fica desligado por padrão.
    expect(tipos).toContain("RunStarted");
    expect(tipos.indexOf("RunStarted")).toBeLessThan(tipos.indexOf("ToolCall"));
    expect(tipos.at(-1)).toBe("RunCompleted");
  }, 600_000);
});
