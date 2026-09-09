import { describe, expect, it } from "vitest";

import { previewCapabilities } from "@/lib/capability-preview";
import { HARNESS } from "@/test/execution-fixtures";

const FULL = HARNESS.capabilities;

describe("prévia do capability matching pela matriz", () => {
  it("uma Guilda que declara tudo não tem descompasso", () => {
    expect(
      previewCapabilities({
        capabilities: FULL,
        mode: "DOCKER",
        mcpServerNames: ["knowledge"],
        modelKey: "claude-opus-5",
        commandToolNames: ["git add"],
      }),
    ).toEqual({ blockers: [], warnings: [] });
  });

  it("o modo do perfil contra a matriz é bloqueio; o resto é aviso, com a causa", () => {
    const preview = previewCapabilities({
      capabilities: {
        ...FULL,
        dockerExecution: false,
        mcpServers: false,
        modelSelection: false,
        nativePermissions: false,
      },
      mode: "DOCKER",
      mcpServerNames: ["knowledge", "git"],
      modelKey: "gemini-3-pro",
      commandToolNames: ["git add", "git commit"],
    });

    expect(preview.blockers.map((issue) => issue.code)).toEqual(["DOCKER_UNSUPPORTED"]);
    expect(preview.warnings.map((issue) => issue.code)).toEqual([
      "MCP_UNSUPPORTED",
      "MODEL_SELECTION_UNSUPPORTED",
      "COMMAND_TOOLS_ADVISORY",
    ]);
    expect(preview.warnings[0]?.causedBy).toEqual(["knowledge", "git"]);
    expect(preview.warnings[2]?.causedBy).toEqual(["git add", "git commit"]);
  });

  it("sem servidor, sem Model e sem comando não há o que avisar, mesmo numa matriz vazia", () => {
    const preview = previewCapabilities({
      capabilities: { ...FULL, mcpServers: false, modelSelection: false, nativePermissions: false },
      mode: "HOST",
      mcpServerNames: [],
      modelKey: null,
      commandToolNames: [],
    });
    expect(preview).toEqual({ blockers: [], warnings: [] });
  });

  it("uma Guilda sem host bloqueia o perfil de host", () => {
    const preview = previewCapabilities({
      capabilities: { ...FULL, hostExecution: false },
      mode: "HOST",
      mcpServerNames: [],
      modelKey: null,
      commandToolNames: [],
    });
    expect(preview.blockers.map((issue) => issue.code)).toEqual(["HOST_UNSUPPORTED"]);
  });
});
