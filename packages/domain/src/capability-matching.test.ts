import type { HarnessCapabilities } from "@dungeon-master/contracts";
import { describe, expect, it } from "vitest";

import {
  effectiveSkillVersion,
  isValidSkillPin,
  matchCapabilities,
  type MatchCapabilitiesInput,
} from "./capability-matching.js";

const TUDO: HarnessCapabilities = {
  streaming: true,
  structuredOutput: true,
  resume: true,
  forkSession: true,
  multiTurnProcess: false,
  toolEvents: true,
  tokenUsage: true,
  modelSelection: true,
  agentSelection: true,
  nativePermissions: true,
  hostExecution: true,
  dockerExecution: true,
  mcpServers: true,
};

const UUID = "01996d00-0000-7000-8000-000000000001";

function pedido(overrides: Partial<MatchCapabilitiesInput> = {}): MatchCapabilitiesInput {
  return {
    snapshot: {
      name: "Forja",
      model: null,
      mcpServers: [],
      toolDefinitions: [],
    },
    harnessCapabilities: TUDO,
    executionProfile: { mode: "HOST" },
    intent: {},
    ...overrides,
  };
}

function sem(capability: keyof HarnessCapabilities): HarnessCapabilities {
  return { ...TUDO, [capability]: false };
}

describe("matchCapabilities", () => {
  it("um Loadout modesto num Harness completo não tem nada a dizer", () => {
    expect(matchCapabilities(pedido())).toEqual({ blockers: [], warnings: [] });
  });

  it("DOCKER_UNSUPPORTED é blocker quando o perfil é DOCKER e o Harness não roda em container", () => {
    const report = matchCapabilities(
      pedido({ executionProfile: { mode: "DOCKER" }, harnessCapabilities: sem("dockerExecution") }),
    );

    expect(report.warnings).toEqual([]);
    expect(report.blockers).toHaveLength(1);
    expect(report.blockers[0]).toMatchObject({
      code: "DOCKER_UNSUPPORTED",
      severity: "BLOCKER",
      capability: "dockerExecution",
      causedBy: ["DOCKER"],
    });
    expect(report.blockers[0]?.message).toContain("`DOCKER`");

    // O mesmo Harness em HOST não é problema: a regra é do par perfil/matriz.
    expect(
      matchCapabilities(
        pedido({ executionProfile: { mode: "HOST" }, harnessCapabilities: sem("dockerExecution") }),
      ).blockers,
    ).toEqual([]);
  });

  it("HOST_UNSUPPORTED é o simétrico para um Harness que só roda em container", () => {
    const report = matchCapabilities(pedido({ harnessCapabilities: sem("hostExecution") }));

    expect(report.blockers.map((issue) => issue.code)).toEqual(["HOST_UNSUPPORTED"]);
    expect(report.blockers[0]?.capability).toBe("hostExecution");
  });

  it("STRUCTURED_OUTPUT_REQUIRED é blocker só quando a intenção exige e o Harness não declara", () => {
    const exige = pedido({
      intent: { requiresStructuredOutput: true },
      harnessCapabilities: sem("structuredOutput"),
    });
    const report = matchCapabilities(exige);

    expect(report.blockers.map((issue) => issue.code)).toEqual(["STRUCTURED_OUTPUT_REQUIRED"]);
    expect(report.blockers[0]?.causedBy).toEqual(["Forja"]);

    // Sem a intenção, um Harness sem structured output não é impedido: a Task
    // comum lê o bloco `<result>` do texto.
    expect(
      matchCapabilities(pedido({ harnessCapabilities: sem("structuredOutput") })).blockers,
    ).toEqual([]);
  });

  it("MCP_UNSUPPORTED é aviso, e nomeia os servidores que não vão chegar", () => {
    const report = matchCapabilities(
      pedido({
        snapshot: {
          name: "Forja",
          model: null,
          mcpServers: [
            { name: "knowledge", transport: "STDIO", target: "node" },
            { name: "figma", transport: "HTTP", target: "https://mcp.figma.com/" },
          ],
          toolDefinitions: [],
        },
        harnessCapabilities: sem("mcpServers"),
      }),
    );

    expect(report.blockers).toEqual([]);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatchObject({
      code: "MCP_UNSUPPORTED",
      severity: "WARNING",
      capability: "mcpServers",
      causedBy: ["knowledge", "figma"],
    });
    expect(report.warnings[0]?.message).toContain("knowledge, figma");
  });

  it("sem servidores no Loadout, mcpServers=false não avisa nada", () => {
    expect(matchCapabilities(pedido({ harnessCapabilities: sem("mcpServers") })).warnings).toEqual(
      [],
    );
  });

  it("MODEL_SELECTION_UNSUPPORTED é aviso quando há Model e o Harness não escolhe modelo", () => {
    const report = matchCapabilities(
      pedido({
        snapshot: {
          name: "Forja",
          model: { id: UUID, key: "claude-opus-5", name: "Opus 5" },
          mcpServers: [],
          toolDefinitions: [],
        },
        harnessCapabilities: sem("modelSelection"),
      }),
    );

    expect(report.warnings.map((issue) => issue.code)).toEqual(["MODEL_SELECTION_UNSUPPORTED"]);
    expect(report.warnings[0]?.causedBy).toEqual(["claude-opus-5"]);
    expect(report.warnings[0]?.message).toContain("claude-opus-5");
  });

  it("COMMAND_TOOLS_ADVISORY é aviso quando há Tools COMMAND e não há permissão nativa", () => {
    const report = matchCapabilities(
      pedido({
        snapshot: {
          name: "Forja",
          model: null,
          mcpServers: [],
          toolDefinitions: [
            {
              toolId: UUID,
              name: "git add",
              kind: "COMMAND",
              command: "git add",
              mcpServerName: null,
              toolName: null,
            },
            {
              toolId: UUID,
              name: "busca no Grimório",
              kind: "MCP_TOOL",
              command: null,
              mcpServerName: "knowledge",
              toolName: "search_knowledge",
            },
          ],
        },
        harnessCapabilities: sem("nativePermissions"),
      }),
    );

    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatchObject({
      code: "COMMAND_TOOLS_ADVISORY",
      capability: "nativePermissions",
      // Só a Tool de comando: a MCP_TOOL não é assunto de permissão por comando.
      causedBy: ["git add"],
    });
  });

  it("um snapshot anterior à Fase 8, sem toolDefinitions, não gera o aviso de comandos", () => {
    const report = matchCapabilities(
      pedido({
        snapshot: { name: "Antigo", model: null, mcpServers: [] },
        harnessCapabilities: sem("nativePermissions"),
      }),
    );

    expect(report.warnings).toEqual([]);
  });

  it("RESUME_UNSUPPORTED é aviso quando a intenção é retomar e o Harness não retoma", () => {
    const report = matchCapabilities(
      pedido({ intent: { resume: true }, harnessCapabilities: sem("resume") }),
    );

    expect(report.warnings.map((issue) => issue.code)).toEqual(["RESUME_UNSUPPORTED"]);
    expect(report.warnings[0]?.capability).toBe("resume");

    expect(matchCapabilities(pedido({ harnessCapabilities: sem("resume") })).warnings).toEqual([]);
  });

  it("acumula blockers e warnings, cada um no seu balde", () => {
    const report = matchCapabilities(
      pedido({
        snapshot: {
          name: "Tudo junto",
          model: { id: UUID, key: "gemini", name: "Gemini" },
          mcpServers: [{ name: "knowledge", transport: "STDIO", target: "node" }],
          toolDefinitions: [],
        },
        executionProfile: { mode: "DOCKER" },
        intent: { resume: true },
        harnessCapabilities: {
          ...TUDO,
          dockerExecution: false,
          mcpServers: false,
          modelSelection: false,
          resume: false,
        },
      }),
    );

    expect(report.blockers.map((issue) => issue.code)).toEqual(["DOCKER_UNSUPPORTED"]);
    expect(report.warnings.map((issue) => issue.code)).toEqual([
      "MCP_UNSUPPORTED",
      "MODEL_SELECTION_UNSUPPORTED",
      "RESUME_UNSUPPORTED",
    ]);
  });

  it("não depende da key do Harness: a mesma matriz dá o mesmo relatório", () => {
    // O input nem tem `key`: é a prova de que não há `if (harness === ...)`.
    const a = matchCapabilities(pedido({ harnessCapabilities: sem("mcpServers") }));
    const b = matchCapabilities(pedido({ harnessCapabilities: sem("mcpServers") }));
    expect(a).toEqual(b);
  });
});

describe("a regra do pin", () => {
  it("a versão efetiva é a pinada, ou a mais recente quando não há pin", () => {
    expect(effectiveSkillVersion({ pinnedVersion: 2, latestVersion: 5 })).toBe(2);
    expect(effectiveSkillVersion({ pinnedVersion: null, latestVersion: 5 })).toBe(5);
  });

  it("um pin só vale para uma versão que existe", () => {
    expect(isValidSkillPin(1, 3)).toBe(true);
    expect(isValidSkillPin(3, 3)).toBe(true);
    expect(isValidSkillPin(4, 3)).toBe(false);
    expect(isValidSkillPin(0, 3)).toBe(false);
    expect(isValidSkillPin(1.5, 3)).toBe(false);
  });
});
