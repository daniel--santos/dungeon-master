import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildEnv, essentialEnvKeys } from "@dungeon-master/platform";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createProcessCommandExecutor,
  createRefusingCommandExecutor,
} from "./process-command-executor.js";

/**
 * O executor de processo com processos de verdade.
 *
 * `process.execPath` e não `node`: o filho precisa ser o mesmo Node do teste,
 * e um `node` do PATH pode ser outro.
 */

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "dm-command-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
});

const env = () => buildEnv(essentialEnvKeys());

describe("createProcessCommandExecutor", () => {
  it("captura código de saída, stdout e stderr", async () => {
    const executor = createProcessCommandExecutor({ env: env() });
    const handle = executor.start({
      argv: [
        process.execPath,
        "-e",
        "process.stdout.write('ola\\nmundo\\n'); process.stderr.write('aviso'); process.exit(3)",
      ],
      cwd,
    });

    const result = await handle.result;
    expect(result.exitCode).toBe(3);
    expect(result.signal).toBeNull();
    expect(result.stdoutTail).toBe("ola\nmundo");
    expect(result.stderrTail).toBe("aviso");
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("guarda só a cauda quando a saída passa do teto", async () => {
    const executor = createProcessCommandExecutor({ env: env(), maxTailChars: 32 });
    const handle = executor.start({
      argv: [process.execPath, "-e", "for (let i = 0; i < 100; i++) console.log('linha ' + i)"],
      cwd,
    });
    const result = await handle.result;
    expect(result.exitCode).toBe(0);
    expect(result.stdoutTail.length).toBeLessThanOrEqual(32);
    expect(result.stdoutTail).toContain("linha 99");
  });

  it("um executável que não existe volta em result.error, sem lançar", async () => {
    const executor = createProcessCommandExecutor({ env: env() });
    const handle = executor.start({ argv: ["programa-que-nao-existe-dm"], cwd });
    const result = await handle.result;
    expect(result.exitCode).toBeNull();
    expect(result.error?.code).toBe("SPAWN_FAILED");
  });

  it("terminate mata a árvore e confirma", async () => {
    // Sem apertar `killGraceMs`: no Windows ele é o teto do próprio `taskkill`,
    // que precisa de centenas de milissegundos só para subir, e um valor curto
    // corta o comando no meio e sai como não confirmado.
    const executor = createProcessCommandExecutor({ env: env(), killConfirmMs: 3_000 });
    const handle = executor.start({
      argv: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
      cwd,
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    const termination = await handle.terminate();
    expect(termination.terminated).toBe(true);

    const result = await handle.result;
    expect(result.exitCode === null || result.exitCode !== 0).toBe(true);
    // Idempotente: a segunda chamada devolve o mesmo resultado sem matar de novo.
    expect(await handle.terminate()).toEqual(termination);
  });

  it("argv vazio é recusado com erro claro", async () => {
    const executor = createProcessCommandExecutor({ env: env() });
    const result = await executor.start({ argv: [], cwd }).result;
    expect(result.error?.code).toBe("EMPTY_ARGV");
  });
});

describe("createRefusingCommandExecutor", () => {
  it("recusa tudo com o mesmo motivo, sem subir processo", async () => {
    const executor = createRefusingCommandExecutor({
      code: "COMMAND_DOCKER_UNSUPPORTED",
      message: "Steps de comando não rodam em DOCKER nesta fase.",
    });
    const result = await executor.start({ argv: ["git", "status"], cwd }).result;
    expect(result.error).toEqual({
      code: "COMMAND_DOCKER_UNSUPPORTED",
      message: "Steps de comando não rodam em DOCKER nesta fase.",
    });
  });
});
