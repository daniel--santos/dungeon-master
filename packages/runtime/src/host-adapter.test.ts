import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NO_CAPABILITIES } from "./capabilities.js";
import { buildExecutionEnv } from "./env.js";
import type { HarnessEvent, HarnessExecutionRequest } from "./harness.js";
import { createHostAdapter } from "./host-adapter.js";
import { FAKE_AGENT_SCRIPT, parseFakeLine } from "./testing/fake-harness.js";

let workdir: string;

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), "dm-host-adapter-"));
});

afterAll(async () => {
  await rm(workdir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }).catch(
    () => undefined,
  );
});

function pedido(executionId: string, prompt: string): HarnessExecutionRequest {
  return {
    executionId,
    cwd: workdir,
    prompt,
    env: buildExecutionEnv({ adapterKeys: [] }),
    permission: { mode: "DEFAULT", enforcement: "ADVISORY" },
  };
}

describe("createHostAdapter", () => {
  it("entrega a política de kill do pedido a quem encerra o processo", async () => {
    // O `ExecutionTimeouts` do Run traz `killGraceMs` e `killConfirmMs`, e quem
    // decide quanto esperar por um `taskkill` que anda a árvore é o pedido, não
    // o padrão do `packages/platform`.
    const recebido: { graceMs?: number; confirmMs?: number }[] = [];
    const adapter = createHostAdapter({
      id: "spy@host",
      key: "CLAUDE_CODE",
      capabilities: NO_CAPABILITIES,
      preflight: () => Promise.resolve({ installed: true, problems: [] }),
      buildCommand: () => ({
        command: process.execPath,
        args: [FAKE_AGENT_SCRIPT],
        stdin: "@@fake:text pronto\n@@fake:hang",
      }),
      parseLine: parseFakeLine,
      terminate: async ({ process: filho, graceMs, confirmMs }) => {
        recebido.push({ graceMs, confirmMs });
        const r = await filho.terminate({ graceMs, confirmMs });
        return { terminated: r.terminated, method: r.method, elapsedMs: r.elapsedMs };
      },
    });

    const eventos: HarnessEvent[] = [];
    const consumindo = (async () => {
      for await (const evento of adapter.execute(pedido("kill-1", "irrelevante"))) {
        eventos.push(evento);
      }
    })();

    const nasceu = (): boolean => eventos.some((evento) => evento.type === "TextDelta");
    for (let i = 0; i < 100 && !nasceu(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(nasceu(), "o agente falso não chegou a emitir texto").toBe(true);

    const resultado = await adapter.cancel("kill-1", { graceMs: 1_500, confirmMs: 2_500 });
    await consumindo;

    expect(recebido).toEqual([{ graceMs: 1_500, confirmMs: 2_500 }]);
    expect(resultado.terminated).toBe(true);
    expect(eventos.at(-1)?.type).toBe("HarnessFinished");
  });

  it("cancelar uma execução que já saiu não é erro", async () => {
    const adapter = createHostAdapter({
      id: "spy@host",
      key: "CLAUDE_CODE",
      capabilities: NO_CAPABILITIES,
      preflight: () => Promise.resolve({ installed: true, problems: [] }),
      buildCommand: () => ({ command: process.execPath, args: [FAKE_AGENT_SCRIPT] }),
      parseLine: parseFakeLine,
    });

    const resultado = await adapter.cancel("nunca-subiu", { graceMs: 10, confirmMs: 10 });

    expect(resultado).toEqual({ terminated: true, elapsedMs: 0, notRunning: true });
  });
});
