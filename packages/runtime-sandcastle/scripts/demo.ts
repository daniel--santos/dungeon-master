/**
 * Demonstração de ponta a ponta do runtime de host.
 *
 * Não é teste: é o roteiro que prova, num terminal, que as três garantias da
 * Fase 2B funcionam juntas com uma CLI de verdade.
 *
 *   1. worktree por Run, resultado estruturado validado por schema e commit
 *      feito pelo agente dentro do worktree;
 *   2. cancelamento aos 2 s com a árvore de processos confirmada como morta.
 *
 * Tudo acontece num repositório git criado em temp e apagado no fim; nada é
 * commitado neste repositório.
 *
 * Uso (depois de `pnpm build`):
 *
 *   pnpm --filter @dungeon-master/runtime-sandcastle demo
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecutionEvent } from "@dungeon-master/contracts";
import {
  buildGitEnv,
  collectProcess,
  createAgentRuntime,
  createHarnessRegistry,
  createWorkspaceManager,
  createWorkspaceResolver,
  type ExecutionRequest,
} from "@dungeon-master/runtime";
import { claudeCode } from "../src/index.js";
import { z } from "zod";

const OutputSchema = z.object({
  summary: z.string(),
  files: z.array(z.string()),
});

const adapter = claudeCode();
const manager = createWorkspaceManager();
const runtime = createAgentRuntime({
  registry: createHarnessRegistry([adapter]),
  workspace: createWorkspaceResolver({ manager, keepOnSuccess: true }),
});

async function git(args: readonly string[], cwd: string): Promise<string> {
  const result = await collectProcess("git", args, { cwd, env: buildGitEnv(), timeoutMs: 60_000 });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} falhou: ${result.stderr}`);
  }
  return result.stdout;
}

/** Quantos processos com este nome estão vivos agora. */
async function countProcesses(name: string): Promise<number> {
  const env = buildGitEnv();
  const result =
    process.platform === "win32"
      ? await collectProcess("tasklist", ["/FI", `IMAGENAME eq ${name}.exe`, "/NH"], {
          cwd: process.cwd(),
          env,
          timeoutMs: 20_000,
        })
      : await collectProcess("pgrep", ["-c", "-f", name], {
          cwd: process.cwd(),
          env,
          timeoutMs: 20_000,
        });

  if (process.platform === "win32") {
    return result.stdout.split("\n").filter((line) => line.toLowerCase().includes(`${name}.exe`))
      .length;
  }
  return Number(result.stdout.trim()) || 0;
}

function show(event: ExecutionEvent): void {
  const parts: string[] = [event.type];
  switch (event.type) {
    case "RunStarted":
      parts.push(`v${event.harnessVersion}`, event.enforcement, event.workspacePath);
      break;
    case "TextDelta":
      parts.push(JSON.stringify(event.text.slice(0, 120)));
      break;
    case "ToolCall":
      parts.push(event.name, JSON.stringify(event.arguments.slice(0, 100)));
      break;
    case "ToolResult":
      parts.push(event.ok ? "ok" : "ERRO", JSON.stringify(event.output.slice(0, 80)));
      break;
    case "SessionCaptured":
      parts.push(event.harnessSessionId);
      break;
    case "Usage":
      parts.push(`in=${String(event.usage.inputTokens)} out=${String(event.usage.outputTokens)}`);
      break;
    case "Diagnostic":
      parts.push(event.level, event.message);
      break;
    case "RunCompleted":
      parts.push(`${String(event.durationMs)}ms`, JSON.stringify(event.output));
      break;
    case "RunFailed":
      parts.push(event.error.message);
      break;
    case "RunCancelled":
      parts.push(
        `árvore encerrada: ${String(event.processTreeTerminated)}`,
        `método: ${event.terminationMethod ?? "-"}`,
        `${String(event.elapsedMs)}ms`,
      );
      break;
    case "RunTimedOut":
      parts.push(event.kind, `${String(event.elapsedMs)}ms`);
      break;
    default:
      break;
  }
  console.log(`  ${parts.join("  ·  ")}`);
}

async function main(): Promise<void> {
  const preflight = await adapter.preflight({ mode: "HOST" });
  console.log(
    `\n# preflight: instalado=${String(preflight.installed)} versão=${preflight.version ?? "?"}`,
  );
  if (!preflight.installed) {
    console.error("Claude Code não está instalado; a demonstração precisa da CLI.");
    process.exitCode = 1;
    return;
  }

  const sandbox = await mkdtemp(join(tmpdir(), "dm-demo-"));
  const repo = join(sandbox, "repositorio");

  try {
    await git(["init", "-q", "-b", "main", repo], sandbox);
    await writeFile(join(repo, "README.md"), "# repositório de demonstração\n");
    await git(["add", "."], repo);
    await git(["commit", "-q", "-m", "base"], repo);
    console.log(`# repositório em ${repo}`);

    // ------------------------------------------------- 1. Run com worktree
    const request: ExecutionRequest<z.infer<typeof OutputSchema>> = {
      runId: "demo-0001",
      taskId: "demo-task",
      workspace: { repoPath: repo },
      harness: { key: "CLAUDE_CODE" },
      model: { id: "sonnet" },
      loadout: { harness: { key: "CLAUDE_CODE" } },
      executionProfile: {
        mode: "HOST",
        workspaceStrategy: "GIT_WORKTREE",
        // Um Run sem ninguém olhando precisa de `BYPASS` para chegar ao
        // `git commit`: no host, os modos nativos da CLI ou barram o `Bash`
        // (`acceptEdits` deixa escrever o arquivo e nega o commit) ou negam
        // tudo (`dontAsk`), porque não há quem aprove. É exatamente o caminho
        // que a política existe para tornar visível: `allowBypassWithoutSandbox`
        // é opt-in explícito, o enforcement cai para `ADVISORY` e um
        // `Diagnostic` registra a escolha. Aqui isso é seguro porque o
        // repositório é descartável e mora no temp.
        permissionPolicy: { mode: "BYPASS", allowBypassWithoutSandbox: true },
      },
      prompt:
        "Crie um arquivo OLA.md com uma única linha de conteúdo e faça commit dele. " +
        "Depois responda com summary descrevendo o que fez e files listando os arquivos criados.",
      outputSchema: { schema: OutputSchema, maxRetries: 1 },
      timeouts: { idleMs: 120_000, completionMs: 300_000 },
    };

    console.log("\n# Run 1 — worktree, structured output e commit");
    const events: ExecutionEvent[] = [];
    for await (const event of runtime.execute(request)) {
      events.push(event);
      show(event);
    }

    const worktreePath = manager.worktreePathFor(repo, request.runId);
    const completed = events.find((event) => event.type === "RunCompleted");
    if (completed?.type === "RunCompleted") {
      const commits = await manager.collectCommits(
        worktreePath,
        (await git(["rev-parse", "main"], repo)).trim(),
      );
      console.log(
        `  commits no worktree: ${commits.map((c) => c.subject).join(" | ") || "nenhum"}`,
      );
      console.log(`  branch: ${manager.branchFor(request.runId)}`);
      console.log(`  output validado: ${JSON.stringify(completed.output)}`);
    }

    // ------------------------------------------------- 2. Run cancelado
    console.log("\n# Run 2 — cancelamento aos 2 s com confirmação de término");
    const antes = await countProcesses("claude");
    console.log(`  processos 'claude' antes: ${String(antes)}`);

    const cancelRequest: ExecutionRequest = {
      runId: "demo-0002",
      taskId: "demo-task",
      workspace: { repoPath: repo },
      harness: { key: "CLAUDE_CODE" },
      model: { id: "sonnet" },
      loadout: { harness: { key: "CLAUDE_CODE" } },
      executionProfile: { mode: "HOST", workspaceStrategy: "CURRENT" },
      prompt: "Conte de 1 até 500, escrevendo um número por linha, devagar e sem usar ferramentas.",
      timeouts: {
        idleMs: 120_000,
        completionMs: 300_000,
        killGraceMs: 3_000,
        killConfirmMs: 5_000,
      },
    };

    const cancelEvents: ExecutionEvent[] = [];
    const consuming = (async () => {
      for await (const event of runtime.execute(cancelRequest)) {
        cancelEvents.push(event);
        show(event);
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 2_000));
    console.log(`  processos 'claude' durante: ${String(await countProcesses("claude"))}`);
    console.log("  → cancel()");
    await runtime.cancel(cancelRequest.runId);
    await consuming;

    const depois = await countProcesses("claude");
    console.log(`  processos 'claude' depois: ${String(depois)}`);

    const last = cancelEvents.at(-1);
    if (last?.type === "RunCancelled") {
      console.log(
        `\n# resultado: RunCancelled, árvore confirmada encerrada = ${String(last.processTreeTerminated)}`,
      );
    } else {
      console.log(`\n# resultado inesperado: ${last?.type ?? "nenhum evento"}`);
      process.exitCode = 1;
    }
  } finally {
    // O worktree fica em `<pai do repo>/.dm-worktrees/…`, e o pai do repo é o
    // próprio temp: apagar o temp leva os dois.
    await rm(sandbox, { recursive: true, force: true }).catch(() => undefined);
    console.log("# temp removido");
  }
}

await main();
