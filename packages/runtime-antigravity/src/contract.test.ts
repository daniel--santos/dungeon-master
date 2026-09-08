/**
 * A suíte de contrato com o `agy` de verdade.
 *
 * Roda **só onde a CLI está instalada e autenticada**, e nunca no CI: cada caso
 * sobe um processo e fala com o provedor de modelo. No CI quem cobre os mesmos
 * onze casos é `contract-fake.test.ts`, com o mesmo parser.
 *
 * Os prompts são mínimos de propósito ("responda apenas OK"): o objetivo é
 * exercitar a costura entre runtime, adapter e processo, não o modelo.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecutionEvent } from "@dungeon-master/contracts";
import {
  createAgentRuntime,
  createHarnessRegistry,
  createWorkspaceManager,
  createWorkspaceResolver,
} from "@dungeon-master/runtime";
import { harnessContractSuite } from "@dungeon-master/runtime/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { antigravity } from "./antigravity.js";

/**
 * Rodar a suíte real neste ambiente?
 *
 * `DM_HARNESS_CONTRACT=1` força a execução; `CI` a desliga. Sem CLI instalada,
 * o preflight reprova e a suíte some.
 */
const forced = process.env["DM_HARNESS_CONTRACT"] === "1";
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "";

const adapter = antigravity();

const disponivel = await (async (): Promise<boolean> => {
  if (inCi && !forced) return false;
  try {
    const preflight = await adapter.preflight({ mode: "HOST" });
    return preflight.installed && !preflight.problems.some((problem) => problem.fatal);
  } catch {
    return false;
  }
})();

harnessContractSuite({
  name: "antigravity@host",
  enabled: disponivel,
  createAdapter: () => adapter,
  caseTimeoutMs: 180_000,
  completionMs: 150_000,
  cancelAfterMs: 4_000,
  prompts: {
    // `list_dir` é a ferramenta que a CLI concede sem permissão de comando —
    // e permissão de comando é justamente o que ela nega em modo headless.
    // Pedir `git --version` aqui provaria o `ToolCall` do mesmo jeito, mas
    // gastaria um turno numa negação previsível.
    tool: "Liste os arquivos do diretório de trabalho atual e depois responda apenas OK.",
    slow: "Conte de 1 até 400, escrevendo um número por linha, sem usar ferramentas.",
  },
});

/**
 * O caminho nativo do resultado estruturado, que a suíte comum não exercita.
 *
 * A suíte passa só o Standard Schema, então o adapter cai na instrução do
 * prompt, como os outros três. Aqui o `--json-schema` entra de verdade: a CLI
 * valida e devolve `structured_output`, o parser reembala no bloco `<result>` e
 * o runtime valida de novo com o Zod. É esse ida e volta que autoriza
 * `structuredOutput: true` na matriz.
 */
describe.skipIf(!disponivel)("antigravity@host: --json-schema de ponta a ponta", () => {
  const Schema = z.object({ answer: z.string() });
  let workdir: string;

  beforeAll(async () => {
    workdir = await mkdtemp(join(tmpdir(), "dm-agy-schema-"));
  });

  afterAll(async () => {
    await rm(workdir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }).catch(
      () => undefined,
    );
  });

  // `retry`: este caso fala com o modelo de verdade, e às vezes ele ignora o
  // "sem usar nenhuma ferramenta", explora o diretório, esbarra na negação de
  // comando e o Run termina em falha. Isso é comportamento do modelo, não do
  // contrato da CLI, que é o que o caso prova; por isso ele ganha até duas
  // novas tentativas antes de ser contado como vermelho.
  it(
    "valida o resultado que a própria CLI já validou",
    { retry: 2, timeout: 180_000 },
    async () => {
      const runtime = createAgentRuntime({
        registry: createHarnessRegistry([adapter]),
        workspace: createWorkspaceResolver({ manager: createWorkspaceManager() }),
      });

      const events: ExecutionEvent[] = [];
      for await (const event of runtime.execute({
        runId: "contract-agy-schema-1",
        taskId: "contract-task",
        workspace: { repoPath: workdir },
        harness: { key: "ANTIGRAVITY" },
        loadout: { harness: { key: "ANTIGRAVITY" } },
        executionProfile: {
          mode: "HOST",
          workspaceStrategy: "CURRENT",
          permissionPolicy: { mode: "DEFAULT" },
        },
        // "Sem usar nenhuma ferramenta" não é enfeite: com `--json-schema` e um
        // diretório vazio, o agente sai explorando o workspace antes de
        // responder, esbarra na negação de comando e o Run termina em falha.
        prompt: 'Sem usar nenhuma ferramenta, responda com o campo answer valendo exatamente "ok".',
        outputSchema: {
          schema: Schema,
          maxRetries: 1,
          jsonSchema: z.toJSONSchema(Schema),
        },
        timeouts: { completionMs: 150_000, idleMs: 120_000 },
      })) {
        events.push(event);
      }

      const completed = events.find((event) => event.type === "RunCompleted");
      expect(completed, events.map((event) => event.type).join(" → ")).toBeDefined();
      expect(Schema.safeParse(completed?.output).success).toBe(true);
    },
  );
});
