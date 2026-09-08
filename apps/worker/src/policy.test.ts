import type { ExecutionProfileSnapshot, PermissionPolicy } from "@dungeon-master/contracts";
import {
  allowedToolsFor,
  buildClaudeCodeArgs,
  deniedToolsFor,
} from "@dungeon-master/runtime-sandcastle";
import { describe, expect, it } from "vitest";

import { DEFAULT_TRUSTED_COMMANDS, resolveRunPolicies } from "./policy.js";

/**
 * A tradução da política, que é a regra de domínio mais delicada da fase: ela
 * decide o que um agente pode fazer na máquina de alguém.
 */

function perfil(
  permissionPolicy: Partial<PermissionPolicy>,
  enforcement: ExecutionProfileSnapshot["enforcement"] = "HARNESS_NATIVE",
): ExecutionProfileSnapshot {
  return {
    executionProfileId: "01996d00-0000-7000-8000-0000000000ff",
    name: "Campo aberto",
    mode: enforcement === "SANDBOX_ENFORCED" ? "DOCKER" : "HOST",
    workspaceStrategy: "GIT_WORKTREE",
    enforcement,
    permissionPolicy: {
      workspaceWrite: true,
      commandExecution: "ALLOWLIST",
      allowedCommands: [],
      deniedCommands: [],
      ...permissionPolicy,
    },
    environmentPolicy: { allowedVariables: [], inheritPath: true },
    networkPolicy: { access: "ALL", allowedHosts: [] },
    capturedAt: "2026-09-07T12:00:00.000Z",
  };
}

const COM_PERMISSAO_NATIVA = { nativePermissions: true };
const SEM_PERMISSAO_NATIVA = { nativePermissions: false };

describe("resolveRunPolicies", () => {
  it("traduz a allow-list do perfil em concessão, sem bypass", () => {
    const resolvido = resolveRunPolicies({
      profile: perfil({ commandExecution: "ALLOWLIST", allowedCommands: ["git", "pnpm test"] }),
      harnessKey: "CLAUDE_CODE",
      capabilities: COM_PERMISSAO_NATIVA,
    });

    expect(resolvido.permission.mode).toBe("CONFIGURED");
    expect(resolvido.permission.grant?.commandExecution).toBe("ALLOWLIST");
    expect(resolvido.permission.grant?.allowedCommands).toEqual(["git", "pnpm test"]);
    expect(resolvido.bypassWithoutSandbox).toBe(false);
  });

  it("`ALL` sem opt-in vira a lista de trabalho mais a do perfil, nunca bypass", () => {
    const resolvido = resolveRunPolicies({
      profile: perfil({ commandExecution: "ALL", allowedCommands: ["pnpm"] }),
      harnessKey: "CLAUDE_CODE",
      capabilities: COM_PERMISSAO_NATIVA,
    });

    expect(resolvido.permission.mode).toBe("CONFIGURED");
    expect(resolvido.permission.grant?.allowedCommands).toEqual([
      ...DEFAULT_TRUSTED_COMMANDS,
      "pnpm",
    ]);
    expect(resolvido.bypassWithoutSandbox).toBe(false);
  });

  it("`ALL` com opt-in explícito vira bypass, com aviso e registro no diário", () => {
    const resolvido = resolveRunPolicies({
      profile: perfil({ commandExecution: "ALL", allowUnsafeBypass: true }),
      harnessKey: "CLAUDE_CODE",
      capabilities: COM_PERMISSAO_NATIVA,
    });

    expect(resolvido.permission.mode).toBe("BYPASS");
    expect(resolvido.permission.allowBypassWithoutSandbox).toBe(true);
    expect(resolvido.bypassWithoutSandbox).toBe(true);
    expect(resolvido.notes.some((nota) => nota.level === "WARN")).toBe(true);
  });

  it("`ALL` com isolamento imposto vira bypass sem opt-in, e sem linha no diário", () => {
    const resolvido = resolveRunPolicies({
      profile: perfil({ commandExecution: "ALL" }, "SANDBOX_ENFORCED"),
      harnessKey: "CODEX",
      capabilities: COM_PERMISSAO_NATIVA,
    });

    expect(resolvido.permission.mode).toBe("BYPASS");
    // O container é a barreira; não há o que registrar como exceção.
    expect(resolvido.bypassWithoutSandbox).toBe(false);
  });

  it("`NONE` não concede comando nenhum", () => {
    const resolvido = resolveRunPolicies({
      profile: perfil({ commandExecution: "NONE", allowedCommands: ["git"] }),
      harnessKey: "CLAUDE_CODE",
      capabilities: COM_PERMISSAO_NATIVA,
    });

    expect(resolvido.permission.grant?.commandExecution).toBe("NONE");
    expect(resolvido.permission.grant?.allowedCommands).toEqual([]);
  });

  it("avisa que a lista é indicativa num harness sem permissão por comando", () => {
    const resolvido = resolveRunPolicies({
      profile: perfil({ commandExecution: "ALL" }),
      harnessKey: "PI",
      capabilities: SEM_PERMISSAO_NATIVA,
    });

    const aviso = resolvido.notes.find((nota) => nota.message.includes("indicativa"));
    expect(aviso?.level).toBe("WARN");
  });

  it("uma allow-list vazia com execução liberada avisa que nada passa", () => {
    const resolvido = resolveRunPolicies({
      profile: perfil({ commandExecution: "ALLOWLIST", allowedCommands: [] }),
      harnessKey: "CLAUDE_CODE",
      capabilities: COM_PERMISSAO_NATIVA,
    });

    expect(resolvido.permission.grant?.allowedCommands).toEqual([]);
    expect(resolvido.notes.some((nota) => nota.message.includes("não lista nenhum"))).toBe(true);
  });
});

describe("a concessão chegando ao argv do Claude Code", () => {
  it("libera as duas ferramentas de shell com o mesmo prefixo", () => {
    const resolvido = resolveRunPolicies({
      profile: perfil({ commandExecution: "ALLOWLIST", allowedCommands: ["git"] }),
      harnessKey: "CLAUDE_CODE",
      capabilities: COM_PERMISSAO_NATIVA,
    });

    const tools = allowedToolsFor(resolvido.permission.grant);

    // `PowerShell` não é enfeite: no Windows é a primeira que o agente tenta.
    expect(tools).toContain("Bash(git:*)");
    expect(tools).toContain("PowerShell(git:*)");
    expect(tools).toContain("Read");
    expect(tools).toContain("Write");
  });

  it("sem escrita no workspace, as ferramentas de edição ficam de fora", () => {
    const resolvido = resolveRunPolicies({
      profile: perfil({ workspaceWrite: false, commandExecution: "NONE" }),
      harnessKey: "CLAUDE_CODE",
      capabilities: COM_PERMISSAO_NATIVA,
    });

    const tools = allowedToolsFor(resolvido.permission.grant);
    expect(tools).toContain("Read");
    expect(tools).not.toContain("Write");
    expect(tools.some((tool) => tool.startsWith("Bash("))).toBe(false);
  });

  it("os comandos negados viram disallowedTools nas duas ferramentas", () => {
    const resolvido = resolveRunPolicies({
      profile: perfil({
        commandExecution: "ALL",
        deniedCommands: ["rm", "git push"],
      }),
      harnessKey: "CLAUDE_CODE",
      capabilities: COM_PERMISSAO_NATIVA,
    });

    expect(deniedToolsFor(resolvido.permission.grant)).toEqual([
      "Bash(rm:*)",
      "PowerShell(rm:*)",
      "Bash(git push:*)",
      "PowerShell(git push:*)",
    ]);
  });

  it("em bypass não há concessão a traduzir", () => {
    const resolvido = resolveRunPolicies({
      profile: perfil({ commandExecution: "ALL", allowUnsafeBypass: true }),
      harnessKey: "CLAUDE_CODE",
      capabilities: COM_PERMISSAO_NATIVA,
    });

    expect(allowedToolsFor(resolvido.permission.grant)).toEqual([]);
  });
});

describe("a concessão chegando ao argv de verdade", () => {
  /** O pedido que o `AgentRuntime` entrega ao adapter, já resolvido. */
  function pedido(profile: ExecutionProfileSnapshot) {
    const resolvido = resolveRunPolicies({
      profile,
      harnessKey: "CLAUDE_CODE",
      capabilities: COM_PERMISSAO_NATIVA,
    });
    return buildClaudeCodeArgs({
      executionId: "run-argv",
      cwd: "/tmp/worktree",
      prompt: "faça a tarefa",
      env: {},
      permission: {
        mode: resolvido.permission.mode,
        ...(resolvido.permission.grant === undefined
          ? {}
          : { grant: resolvido.permission.grant }),
        enforcement: "HARNESS_NATIVE",
      },
    });
  }

  it("o argv carrega a allow-list derivada da política", () => {
    const { args } = pedido(
      perfil({ commandExecution: "ALL", allowedCommands: ["pnpm test"] }),
    );

    expect(args).toContain("--permission-mode");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("acceptEdits");

    const allowed = args[args.indexOf("--allowedTools") + 1] ?? "";
    // Os cinco subcomandos padrão mais o que o perfil declarou, nas duas
    // ferramentas de shell.
    for (const comando of [...DEFAULT_TRUSTED_COMMANDS, "pnpm test"]) {
      expect(allowed).toContain(`Bash(${comando}:*)`);
      expect(allowed).toContain(`PowerShell(${comando}:*)`);
    }
    expect(allowed).toContain("Write");
    // `git push` não está na lista de trabalho: a concessão é por subcomando.
    expect(allowed).not.toContain("git push");

    // Sem ninguém para aprovar, o que fosse perguntar é negado na hora.
    expect(args).toContain("--permission-prompts");
    expect(args[args.indexOf("--permission-prompts") + 1]).toBe("none");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("o argv de um bypass não leva allow-list nenhuma", () => {
    const { args } = pedido(
      perfil({ commandExecution: "ALL", allowUnsafeBypass: true }),
    );

    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).not.toContain("--allowedTools");
    expect(args).not.toContain("--permission-prompts");
  });

  it("comandos negados chegam como disallowedTools", () => {
    const { args } = pedido(
      perfil({ commandExecution: "ALL", deniedCommands: ["git push"] }),
    );

    const negados = args[args.indexOf("--disallowedTools") + 1] ?? "";
    expect(negados).toContain("Bash(git push:*)");
    expect(negados).toContain("PowerShell(git push:*)");
  });
});
