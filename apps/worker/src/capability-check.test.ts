import type { HarnessCapabilities, Run } from "@dungeon-master/contracts";
import { describe, expect, it } from "vitest";

import {
  checkRunCapabilities,
  describeBlockers,
  describeDivergences,
  measureCapabilitiesFrom,
} from "./capability-check.js";

/**
 * O capability matching na reclamação, sem banco: a matriz medida ganha da
 * congelada, a divergência é listada chave a chave, e um par sem adapter
 * neste Worker é medido como "não roda neste modo".
 */

const TUDO: HarnessCapabilities = {
  streaming: true,
  structuredOutput: true,
  resume: true,
  forkSession: true,
  multiTurnProcess: false,
  toolEvents: true,
  tokenUsage: true,
  modelSelection: true,
  agentSelection: false,
  nativePermissions: true,
  hostExecution: true,
  dockerExecution: true,
  mcpServers: true,
};

function run(input: {
  capabilities?: Partial<HarnessCapabilities>;
  mode?: "HOST" | "DOCKER";
  resumedFromRunId?: string | null;
  mcpServers?: { name: string; transport: "STDIO"; target: string }[];
}): Parameters<typeof checkRunCapabilities>[0]["run"] {
  return {
    loadoutSnapshot: {
      name: "Loadout",
      model: null,
      mcpServers: input.mcpServers ?? [],
      toolDefinitions: [],
      harness: { capabilities: { ...TUDO, ...input.capabilities } },
    } as unknown as Run["loadoutSnapshot"],
    executionProfileSnapshot: { mode: input.mode ?? "HOST" } as Run["executionProfileSnapshot"],
    resumedFromRunId: input.resumedFromRunId ?? null,
  };
}

describe("checkRunCapabilities", () => {
  it("sem adapter, vale o snapshot e não há divergência", () => {
    const check = checkRunCapabilities({
      run: run({}),
      measured: undefined,
      requiresStructuredOutput: false,
    });
    expect(check.source).toBe("SNAPSHOT");
    expect(check.divergences).toEqual([]);
    expect(check.blockers).toEqual([]);
    expect(check.warnings).toEqual([]);
  });

  it("a matriz medida ganha da congelada, e cada chave diferente fica listada", () => {
    const check = checkRunCapabilities({
      run: run({
        mcpServers: [{ name: "docs", transport: "STDIO", target: "x" }],
      }),
      measured: { ...TUDO, hostExecution: false, mcpServers: false },
      requiresStructuredOutput: false,
    });
    expect(check.source).toBe("ADAPTER");
    expect(check.divergences).toEqual([
      { key: "hostExecution", snapshot: true, measured: false },
      { key: "mcpServers", snapshot: true, measured: false },
    ]);
    expect(check.blockers.map((issue) => issue.code)).toEqual(["HOST_UNSUPPORTED"]);
    expect(check.warnings.map((issue) => issue.code)).toEqual(["MCP_UNSUPPORTED"]);
    expect(describeDivergences(check.divergences, "fake@host")).toBe(
      "A matriz de capabilities congelada no Run difere da medida neste Worker (fake@host); " +
        "vale a medida, porque é ela que executa. hostExecution: snapshot true, adapter false; " +
        "mcpServers: snapshot true, adapter false.",
    );
    expect(describeBlockers(check.blockers)).toContain("(HOST_UNSUPPORTED)");
    expect(describeBlockers(check.blockers)).toContain("nenhum agente subiu");
  });

  it("a intenção de retomar e o Escriba entram no matching", () => {
    const check = checkRunCapabilities({
      run: run({ resumedFromRunId: "01996d00-0000-7000-8000-000000000001" }),
      measured: { ...TUDO, resume: false, structuredOutput: false },
      requiresStructuredOutput: true,
    });
    expect(check.blockers.map((issue) => issue.code)).toEqual(["STRUCTURED_OUTPUT_REQUIRED"]);
    expect(check.warnings.map((issue) => issue.code)).toEqual(["RESUME_UNSUPPORTED"]);
  });
});

describe("measureCapabilitiesFrom", () => {
  const host = { key: "ANTIGRAVITY" as const, capabilities: TUDO };
  const docker = {
    key: "CLAUDE_CODE" as const,
    executionMode: "DOCKER" as const,
    capabilities: { ...TUDO, nativePermissions: false },
  };
  const measure = measureCapabilitiesFrom([host, docker]);

  it("o par exato devolve a matriz do adapter", () => {
    expect(measure("ANTIGRAVITY", "HOST")).toBe(TUDO);
    expect(measure("CLAUDE_CODE", "DOCKER")?.nativePermissions).toBe(false);
  });

  it("um par sem adapter, com o outro modo registrado, não roda neste modo", () => {
    // Só o adapter de host do Antigravity está aqui: em DOCKER ele não roda,
    // mesmo que o snapshot diga que sim — é o que fecha o Run como
    // CAPABILITY_BLOCKED em vez de morrer no registry, depois da trava.
    expect(measure("ANTIGRAVITY", "DOCKER")).toEqual({ ...TUDO, dockerExecution: false });
    expect(measure("CLAUDE_CODE", "HOST")).toEqual({
      ...TUDO,
      nativePermissions: false,
      hostExecution: false,
    });
  });

  it("sem adapter em modo nenhum, não há medida", () => {
    expect(measure("CODEX", "HOST")).toBeUndefined();
    expect(measure("CODEX", "DOCKER")).toBeUndefined();
  });
});
