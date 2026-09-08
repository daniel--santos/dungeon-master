import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecutionEvent } from "@dungeon-master/contracts";
import { processExists, waitUntilGone } from "@dungeon-master/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { collectExecutionResult, createAgentRuntime, resolvePermission } from "./agent-runtime.js";
import { capabilities } from "./capabilities.js";
import { buildGitEnv } from "./env.js";
import type { ExecutionRequest } from "./execution-request.js";
import type { HarnessAdapter } from "./harness.js";
import { collectProcess } from "./process.js";
import { createHarnessRegistry } from "./registry.js";
import { fakeHarness } from "./testing/fake-harness.js";
import type { ExecutionProfileSnapshot } from "./types.js";
import { createWorkspaceManager } from "./workspace.js";
import { createWorkspaceResolver } from "./workspace-resolver.js";

const PROFILE: ExecutionProfileSnapshot = {
  mode: "HOST",
  workspaceStrategy: "CURRENT",
};

let workdir: string;

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), "dm-runtime-"));
});

afterAll(async () => {
  // No Windows o handle de um processo recém-morto ainda segura o `cwd` por
  // alguns instantes e o `rmdir` volta `EBUSY`; limpeza é best-effort.
  await rm(workdir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }).catch(
    () => undefined,
  );
});

function runtimeFor(adapter: HarnessAdapter) {
  return createAgentRuntime({
    registry: createHarnessRegistry([adapter]),
    workspace: createWorkspaceResolver({ manager: createWorkspaceManager() }),
  });
}

function request(runId: string, overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    runId,
    taskId: "task-1",
    workspace: { repoPath: workdir },
    harness: { key: "CLAUDE_CODE" },
    loadout: { harness: { key: "CLAUDE_CODE" } },
    executionProfile: PROFILE,
    prompt: "@@fake:text OK",
    timeouts: { idleMs: 15_000, completionMs: 30_000 },
    ...overrides,
  };
}

async function collect(adapter: HarnessAdapter, req: ExecutionRequest): Promise<ExecutionEvent[]> {
  const events: ExecutionEvent[] = [];
  for await (const event of runtimeFor(adapter).execute(req)) events.push(event);
  return events;
}

describe("createAgentRuntime", () => {
  it("nunca lança: harness não registrado vira RunFailed", async () => {
    const runtime = createAgentRuntime({
      registry: createHarnessRegistry([]),
      workspace: createWorkspaceResolver({ manager: createWorkspaceManager() }),
    });

    const events: ExecutionEvent[] = [];
    for await (const event of runtime.execute(request("sem-adapter"))) events.push(event);

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("RunFailed");
    if (events[0]?.type === "RunFailed") {
      expect(events[0].retryable).toBe(false);
      expect(events[0].error.code).toBe("HARNESS_NOT_REGISTERED");
    }
  });

  it("preflight reprovado falha sem retentativa e não sobe processo", async () => {
    const adapter = fakeHarness({
      preflightProblem: { code: "NOT_INSTALLED", message: "claude não está no PATH." },
    });

    const events = await collect(adapter, request("preflight"));

    expect(events.map((event) => event.type)).toEqual(["RunFailed"]);
    if (events[0]?.type === "RunFailed") {
      expect(events[0].retryable).toBe(false);
      expect(events[0].error.message).toContain("PATH");
    }
  });

  it("recusa resume quando o adapter não sabe retomar", async () => {
    const adapter = fakeHarness({ capabilities: { resume: false } });

    const events = await collect(
      adapter,
      request("sem-resume", { resume: { harnessSessionId: "abc" } }),
    );

    expect(events[0]?.type).toBe("RunFailed");
    if (events[0]?.type === "RunFailed") {
      expect(events[0].error.code).toBe("RESUME_UNSUPPORTED");
    }
  });

  it("recusa dois Runs com o mesmo id ao mesmo tempo", async () => {
    const adapter = fakeHarness();
    const runtime = runtimeFor(adapter);
    const req = request("duplicado", { prompt: "@@fake:sleep 400\n@@fake:text OK" });

    const first = (async () => {
      const events: ExecutionEvent[] = [];
      for await (const event of runtime.execute(req)) events.push(event);
      return events;
    })();

    // Espera o primeiro registrar o Run antes de tentar o segundo.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const second: ExecutionEvent[] = [];
    for await (const event of runtime.execute(request("duplicado"))) second.push(event);

    expect(second[0]?.type).toBe("RunFailed");
    if (second[0]?.type === "RunFailed") {
      expect(second[0].error.message).toContain("já está em execução");
    }
    await first;
  });

  it("emite RunStarted com o caminho, a versão e o enforcement", async () => {
    const events = await collect(fakeHarness(), request("started"));
    const started = events.find((event) => event.type === "RunStarted");

    expect(started).toBeDefined();
    if (started?.type === "RunStarted") {
      expect(started.workspacePath).toBe(workdir);
      expect(started.harnessVersion).toBe("0.0.0-fake");
      expect(started.executionMode).toBe("HOST");
      // O falso não declara permissões nativas, então o enforcement honesto é
      // `ADVISORY`.
      expect(started.enforcement).toBe("ADVISORY");
    }
  });

  it("traduz texto, ferramenta, usage e sessão", async () => {
    const events = await collect(
      fakeHarness(),
      request("stream", {
        prompt: [
          "@@fake:session sess-42",
          "@@fake:text ola",
          "@@fake:tool Bash git status",
          "@@fake:usage 100 20",
          "@@fake:result pronto",
        ].join("\n"),
      }),
    );

    const types = events.map((event) => event.type);
    expect(types).toContain("SessionCaptured");
    expect(types).toContain("TextDelta");
    expect(types).toContain("ToolCall");
    expect(types).toContain("ToolResult");
    expect(types).toContain("Usage");
    expect(types.at(-1)).toBe("RunCompleted");

    const completed = events.at(-1);
    if (completed?.type === "RunCompleted") {
      expect(completed.harnessSessionId).toBe("sess-42");
      expect(completed.usage?.inputTokens).toBe(100);
      expect(completed.summary).toBe("pronto");
    }
  });

  it("saída diferente de zero vira RunFailed com o stderr no diagnóstico", async () => {
    const events = await collect(
      fakeHarness(),
      request("falha", { prompt: "@@fake:stderr deu ruim\n@@fake:exit 7" }),
    );

    const diagnostic = events.find((event) => event.type === "Diagnostic");
    expect(diagnostic?.type === "Diagnostic" && diagnostic.detail).toContain("deu ruim");
    expect(events.at(-1)?.type).toBe("RunFailed");
  });

  it("mata a árvore inteira: o neto some junto", async () => {
    const adapter = fakeHarness();
    const runtime = runtimeFor(adapter);
    const req = request("arvore", {
      prompt: "@@fake:ignore-signals\n@@fake:spawn-child\n@@fake:sleep 600000",
      timeouts: { idleMs: 60_000, completionMs: 60_000, killGraceMs: 1_000, killConfirmMs: 5_000 },
    });

    const events: ExecutionEvent[] = [];
    const consuming = (async () => {
      for await (const event of runtime.execute(req)) events.push(event);
    })();

    // Espera o neto nascer: ele se anuncia num TextDelta.
    let grandchildPid: number | undefined;
    for (let i = 0; i < 100 && grandchildPid === undefined; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      for (const event of events) {
        if (event.type !== "TextDelta") continue;
        const match = /^neto (\d+)$/.exec(event.text.trim());
        if (match?.[1] !== undefined) grandchildPid = Number(match[1]);
      }
    }

    expect(grandchildPid, "o agente falso não anunciou o neto").toBeTypeOf("number");
    expect(processExists(grandchildPid as number)).toBe(true);

    await runtime.cancel(req.runId);
    await consuming;

    const last = events.at(-1);
    expect(last?.type).toBe("RunCancelled");
    if (last?.type === "RunCancelled") {
      expect(last.processTreeTerminated).toBe(true);
    }
    // O kill de árvore alcança a descendência; a prova é o polling, não o
    // código de saída do comando (CLAUDE.md, seção 8).
    expect(await waitUntilGone(() => processExists(grandchildPid as number), 5_000)).toBe(true);
  });

  it("timeout ocioso e de conclusão são distinguidos", async () => {
    const idle = await collect(
      fakeHarness(),
      request("ocioso", {
        prompt: "@@fake:hang",
        timeouts: { idleMs: 300, completionMs: 30_000 },
      }),
    );
    const idleLast = idle.at(-1);
    expect(idleLast?.type).toBe("RunTimedOut");
    if (idleLast?.type === "RunTimedOut") {
      expect(idleLast.kind).toBe("IDLE");
      expect(idleLast.limitMs).toBe(300);
      expect(idleLast.processTreeTerminated).toBe(true);
    }

    const completion = await collect(
      fakeHarness(),
      request("conclusao", {
        // Emite de tempos em tempos para que o relógio ocioso nunca estoure: só
        // o teto total pode terminar este Run.
        prompt: Array.from({ length: 40 }, () => "@@fake:sleep 100\n@@fake:text .").join("\n"),
        timeouts: { idleMs: 5_000, completionMs: 700 },
      }),
    );
    const completionLast = completion.at(-1);
    expect(completionLast?.type).toBe("RunTimedOut");
    if (completionLast?.type === "RunTimedOut") {
      expect(completionLast.kind).toBe("COMPLETION");
      expect(completionLast.limitMs).toBe(700);
    }
  });

  it("cancela pelo AbortSignal do pedido", async () => {
    const controller = new AbortController();
    const adapter = fakeHarness();
    const runtime = runtimeFor(adapter);
    const req = request("abort", {
      prompt: "@@fake:sleep 60000",
      signal: controller.signal,
    });

    const events: ExecutionEvent[] = [];
    const consuming = (async () => {
      for await (const event of runtime.execute(req)) events.push(event);
    })();

    await new Promise((resolve) => setTimeout(resolve, 300));
    controller.abort();
    await consuming;

    const last = events.at(-1);
    expect(last?.type).toBe("RunCancelled");
    if (last?.type === "RunCancelled") {
      expect(last.reason).toBe("AbortSignal");
      expect(last.processTreeTerminated).toBe(true);
    }
  });

  it("cancel() de um Run que não existe não faz nada", async () => {
    const runtime = runtimeFor(fakeHarness());
    await expect(runtime.cancel("nao-existe")).resolves.toBeUndefined();
  });
});

describe("resultado estruturado", () => {
  const schema = z.object({ answer: z.string() });

  it("extrai, valida e entrega no RunCompleted", async () => {
    const events = await collect(
      fakeHarness(),
      request("estruturado", {
        prompt: '@@fake:block {"answer":"ok"}\n@@fake:result pronto',
        outputSchema: { schema },
      }),
    );

    const completed = events.at(-1);
    expect(completed?.type).toBe("RunCompleted");
    if (completed?.type === "RunCompleted") {
      expect(completed.output).toEqual({ answer: "ok" });
    }
  });

  it("a última ocorrência vence", async () => {
    const events = await collect(
      fakeHarness(),
      request("ultima", {
        prompt: [
          '@@fake:block {"answer":"errado"}',
          '@@fake:block {"answer":"certo"}',
          "@@fake:result pronto",
        ].join("\n"),
        outputSchema: { schema },
      }),
    );

    const completed = events.at(-1);
    if (completed?.type === "RunCompleted") {
      expect(completed.output).toEqual({ answer: "certo" });
    }
  });

  it("um bloco inválido gera uma retentativa e depois passa", async () => {
    const adapter = fakeHarness({ retryScript: '@@fake:block {"answer":"corrigido"}' });

    const events = await collect(
      adapter,
      request("retry-ok", {
        prompt: '@@fake:block {"answer":123}\n@@fake:result pronto',
        outputSchema: { schema, maxRetries: 1 },
      }),
    );

    const warnings = events.filter(
      (event) => event.type === "Diagnostic" && event.level === "WARN",
    );
    expect(warnings.length, "a primeira tentativa devia avisar").toBeGreaterThan(0);

    const completed = events.at(-1);
    expect(completed?.type).toBe("RunCompleted");
    if (completed?.type === "RunCompleted") {
      expect(completed.output).toEqual({ answer: "corrigido" });
    }
  });

  it("sem correção, falha sem retentativa e guarda o texto bruto", async () => {
    const events = await collect(
      fakeHarness(),
      request("retry-falha", {
        prompt: '@@fake:block {"answer":123}\n@@fake:result pronto',
        outputSchema: { schema, maxRetries: 1 },
      }),
    );

    const last = events.at(-1);
    expect(last?.type).toBe("RunFailed");
    if (last?.type === "RunFailed") {
      expect(last.retryable).toBe(false);
      expect(last.error.code).toBe("STRUCTURED_OUTPUT_INVALID");
    }
    const diagnostics = events.filter((event) => event.type === "Diagnostic");
    expect(diagnostics.some((event) => (event.detail ?? "").includes("123"))).toBe(true);
  });

  it("recusa outputSchema quando o adapter não sabe produzir", async () => {
    const events = await collect(
      fakeHarness({ capabilities: { structuredOutput: false } }),
      request("sem-schema", { outputSchema: { schema } }),
    );

    expect(events[0]?.type).toBe("RunFailed");
    if (events[0]?.type === "RunFailed") {
      expect(events[0].error.code).toBe("STRUCTURED_OUTPUT_UNSUPPORTED");
    }
  });
});

describe("resolvePermission", () => {
  const adapterWithNative = { capabilities: capabilities({ nativePermissions: true }) };
  const adapterWithout = { capabilities: capabilities({}) };

  it("rebaixa BYPASS sem isolamento e sem opt-in, com aviso", () => {
    const resolved = resolvePermission(
      { mode: "HOST", workspaceStrategy: "CURRENT", permissionPolicy: { mode: "BYPASS" } },
      adapterWithNative as unknown as HarnessAdapter,
    );

    expect(resolved.permission.mode).toBe("DEFAULT");
    expect(resolved.notes[0]?.level).toBe("WARN");
    expect(resolved.permission.enforcement).toBe("HARNESS_NATIVE");
  });

  it("aceita BYPASS com opt-in explícito, e o enforcement cai para ADVISORY", () => {
    const resolved = resolvePermission(
      {
        mode: "HOST",
        workspaceStrategy: "CURRENT",
        permissionPolicy: { mode: "BYPASS", allowBypassWithoutSandbox: true },
      },
      adapterWithNative as unknown as HarnessAdapter,
    );

    expect(resolved.permission.mode).toBe("BYPASS");
    expect(resolved.permission.enforcement).toBe("ADVISORY");
    expect(resolved.notes[0]?.message).toContain("sem isolamento");
  });

  it("aceita BYPASS em DOCKER sem opt-in, com enforcement de sandbox", () => {
    const resolved = resolvePermission(
      { mode: "DOCKER", workspaceStrategy: "CURRENT", permissionPolicy: { mode: "BYPASS" } },
      adapterWithout as unknown as HarnessAdapter,
    );

    expect(resolved.permission.mode).toBe("BYPASS");
    expect(resolved.permission.enforcement).toBe("SANDBOX_ENFORCED");
  });

  it("CONFIGURED sem harnessMode volta ao padrão da CLI", () => {
    const resolved = resolvePermission(
      { mode: "HOST", workspaceStrategy: "CURRENT", permissionPolicy: { mode: "CONFIGURED" } },
      adapterWithNative as unknown as HarnessAdapter,
    );

    expect(resolved.permission.mode).toBe("DEFAULT");
    expect(resolved.notes).toHaveLength(1);
  });

  it("sem política nenhuma, o padrão é DEFAULT e não avisa nada", () => {
    const resolved = resolvePermission(
      { mode: "HOST", workspaceStrategy: "CURRENT" },
      adapterWithNative as unknown as HarnessAdapter,
    );

    expect(resolved.permission.mode).toBe("DEFAULT");
    expect(resolved.notes).toHaveLength(0);
  });
});

describe("collectExecutionResult", () => {
  it("resume um fluxo bem-sucedido", async () => {
    const adapter = fakeHarness();
    const runtime = runtimeFor(adapter);
    const result = await collectExecutionResult<{ answer: string }>(
      runtime.execute(
        request("resumo", {
          prompt: '@@fake:session s1\n@@fake:block {"answer":"ok"}\n@@fake:result pronto',
          outputSchema: { schema: z.object({ answer: z.string() }) },
        }),
      ),
      { harness: { key: "CLAUDE_CODE" } },
    );

    expect(result.status).toBe("SUCCEEDED");
    expect(result.output).toEqual({ answer: "ok" });
    expect(result.harnessSessionId).toBe("s1");
    expect(result.harnessVersion).toBe("0.0.0-fake");
    expect(result.workspacePath).toBe(workdir);
  });

  it("resume um fluxo que falhou", async () => {
    const runtime = runtimeFor(fakeHarness());
    const result = await collectExecutionResult(
      runtime.execute(request("resumo-falha", { prompt: "@@fake:exit 9" })),
      { harness: { key: "CLAUDE_CODE" } },
    );

    expect(result.status).toBe("FAILED");
    expect(result.error?.message).toContain("9");
  });
});

/**
 * O `git` do agente e a identidade que ele precisa achar.
 *
 * O runtime entrega ao agente um worktree e uma allow-list que inclui
 * `git commit`. Um `git commit` sem `user.email` não commita — ele falha com
 * "Author identity unknown" — e o Run termina bem-sucedido sem commit nenhum.
 * A identidade mora no gitconfig global, e o ambiente do agente é montado por
 * allow-list, então ela só chega se alguém a tiver posto na lista.
 *
 * Os dois casos abaixo diferem só no conteúdo do gitconfig apontado por
 * `GIT_CONFIG_GLOBAL`, com `HOME` e `USERPROFILE` presos a uma pasta vazia nos
 * dois. É o que torna o teste independente da máquina: sem prender o `HOME`, o
 * Git for Windows acha o `.gitconfig` do perfil do usuário mesmo sem variável
 * nenhuma no ambiente, e foi exatamente por isso que a falha só apareceu no
 * runner, onde esse arquivo não existe.
 */
describe("a identidade do git dentro do agente", () => {
  let repo: string;
  let vazio: string;
  let configComIdentidade: string;
  let configSemIdentidade: string;

  /** Um repositório com um commit inicial, e uma pasta que serve de `HOME` sem nada dentro. */
  beforeAll(async () => {
    const base = await mkdtemp(join(tmpdir(), "dm-git-ident-"));
    repo = join(base, "repositorio");
    vazio = join(base, "home-vazio");
    await mkdir(repo, { recursive: true });
    await mkdir(vazio, { recursive: true });

    const comIdentidade = join(base, "com-identidade.gitconfig");
    await writeFile(comIdentidade, "[user]\n\temail = teste@dungeon.master\n\tname = Teste\n");
    await writeFile(join(base, "sem-identidade.gitconfig"), "[core]\n\tquotepath = false\n");
    configComIdentidade = comIdentidade;
    configSemIdentidade = join(base, "sem-identidade.gitconfig");

    const env = { ...process.env, GIT_CONFIG_GLOBAL: comIdentidade };
    const git = async (...args: string[]): Promise<void> => {
      const r = await collectProcess("git", args, { cwd: repo, env: buildGitEnv(env) });
      if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    };
    await git("init", "-q", "-b", "main", ".");
    await writeFile(join(repo, "README.md"), "# base\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "base");
  });

  /** Roda o agente falso com um `GIT_CONFIG_GLOBAL` escolhido e devolve o que ele emitiu. */
  async function commitarCom(gitconfig: string, runId: string): Promise<ExecutionEvent[]> {
    const runtime = createAgentRuntime({
      registry: createHarnessRegistry([fakeHarness()]),
      workspace: createWorkspaceResolver({ manager: createWorkspaceManager() }),
      envSource: {
        ...process.env,
        HOME: vazio,
        USERPROFILE: vazio,
        GIT_CONFIG_GLOBAL: gitconfig,
      },
    });

    const events: ExecutionEvent[] = [];
    for await (const event of runtime.execute({
      ...request(runId),
      workspace: { repoPath: repo },
      prompt: [
        `@@fake:write ${runId}.md conteudo`,
        "@@fake:git add -A",
        `@@fake:git commit -m ${runId}`,
        "@@fake:result pronto",
      ].join("\n"),
    })) {
      events.push(event);
    }
    return events;
  }

  it("com identidade no gitconfig global, o commit do agente passa", async () => {
    const events = await commitarCom(configComIdentidade, "com-identidade");

    expect(events.at(-1)?.type).toBe("RunCompleted");

    const manager = createWorkspaceManager();
    const commits = await manager.collectCommits(repo, "HEAD~1");
    expect(commits.map((c) => c.subject)).toContain("com-identidade");
  });

  it("sem identidade, o agente falha o commit e diz que falhou", async () => {
    const events = await commitarCom(configSemIdentidade, "sem-identidade");

    // O Run termina: um comando que falha dentro do agente não derruba o
    // processo. O que não pode acontecer é o silêncio — antes, o agente falso
    // engolia o erro com `stdio: "ignore"` e o Run saía bem-sucedido sem
    // commit e sem uma linha dizendo por quê.
    expect(events.at(-1)?.type).toBe("RunCompleted");

    const relatos = events
      .filter((e) => e.type === "ToolResult")
      .map((e) => JSON.stringify(e))
      .join("\n");
    expect(relatos.toLowerCase()).toContain("git commit");
    // A mensagem do git muda de versão para versão; o que não muda é ele
    // reclamar de identidade.
    expect(relatos.toLowerCase()).toMatch(/identity|user\.email|empty ident/u);
  });
});
