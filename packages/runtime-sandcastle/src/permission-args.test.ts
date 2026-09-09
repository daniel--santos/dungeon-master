import type { HarnessExecutionRequest, PermissionGrant } from "@dungeon-master/runtime";
import { describe, expect, it } from "vitest";

import { allowedToolsFor, buildClaudeCodeArgs, deniedToolsFor } from "./claude-code.js";

/**
 * A política do domínio virando as flags de permissão do Claude Code.
 *
 * A CLI recebe as duas listas numa flag só, com os itens separados por vírgula.
 * É uma limitação de formato com consequência de segurança: um prefixo que
 * contém vírgula sai da flag como dois padrões malformados, e o que era uma
 * barreira vira nada — em silêncio.
 */

function grant(overrides: Partial<PermissionGrant> = {}): PermissionGrant {
  return {
    workspaceWrite: true,
    commandExecution: "ALLOWLIST",
    allowedCommands: ["git", "pnpm test"],
    deniedCommands: ["git push"],
    ...overrides,
  };
}

function request(g: PermissionGrant): HarnessExecutionRequest {
  return {
    executionId: "run-1",
    cwd: "D:\\repo",
    prompt: "oi",
    env: {},
    permission: { mode: "CONFIGURED", enforcement: "HARNESS_NATIVE", grant: g },
  };
}

describe("permissões do Claude Code", () => {
  it("traduz prefixo comum para as duas ferramentas de shell", () => {
    expect(allowedToolsFor(grant())).toEqual([
      "Read",
      "Glob",
      "Grep",
      "Edit",
      "Write",
      "NotebookEdit",
      "Bash(git:*)",
      "PowerShell(git:*)",
      "Bash(pnpm test:*)",
      "PowerShell(pnpm test:*)",
    ]);
    expect(deniedToolsFor(grant())).toEqual(["Bash(git push:*)", "PowerShell(git push:*)"]);

    const { args } = buildClaudeCodeArgs(request(grant()));
    expect(args).toContain("--disallowedTools");
  });

  it("recusa o Run quando um prefixo negado tem vírgula", () => {
    // `Bash(docker run --rm,ignore:*)` sairia do `join(",")` como
    // `Bash(docker run --rm` e `ignore:*)`, dois padrões que a CLI não casa com
    // nada: a negação desapareceria e o comando voltaria a ser permitido pelo
    // que a allow-list liberou. Uma barreira recusada é melhor que uma barreira
    // que some sem avisar.
    const pedido = request(grant({ deniedCommands: ["docker run --rm,ignore"] }));

    expect(() => buildClaudeCodeArgs(pedido)).toThrow(/vírgula/);
    expect(() => buildClaudeCodeArgs(pedido)).toThrow(/docker run --rm,ignore/);
  });

  it("recusa o Run quando um prefixo liberado tem vírgula", () => {
    const pedido = request(grant({ allowedCommands: ["node --test-reporter=spec,dot"] }));

    expect(() => buildClaudeCodeArgs(pedido)).toThrow(/vírgula/);
  });
});
