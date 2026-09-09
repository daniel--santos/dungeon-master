import { DEFAULT_THEME, dnd, plain } from "@dungeon-master/glossary";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FrozenLoadoutPanel } from "@/components/run/frozen-loadout-panel";
import type { RunRecord } from "@/lib/api-types";
import { useGlossaryStore } from "@/lib/glossary";
import { RUN } from "@/test/execution-fixtures";
import { SKILL, SKILL_V1, TOOL } from "@/test/registry-fixtures";

/**
 * O Equipamento congelado no cockpit (Fase 8C): a versão, as Habilidades com
 * a versão efetiva e o texto recolhível, os Itens e as Relíquias do snapshot.
 */

const FROZEN: RunRecord = {
  ...RUN,
  loadoutSnapshot: {
    ...RUN.loadoutSnapshot,
    skillVersions: [
      { skillId: SKILL.id, name: SKILL.name, version: 1, pinned: true, content: SKILL_V1.content },
    ],
    toolDefinitions: [
      {
        toolId: TOOL.id,
        name: TOOL.name,
        kind: "COMMAND",
        command: "git status",
        mcpServerName: null,
        toolName: null,
      },
    ],
    mcpServers: [
      {
        name: "knowledge",
        transport: "STDIO",
        target: "node server.js",
        mcpServerId: "0199cccc-0000-7000-8000-00000000c001",
        command: "node",
        args: ["server.js", "--project"],
        url: null,
        envKeys: ["DATABASE_URL"],
        readOnly: true,
        builtIn: true,
      },
    ],
  },
};

afterEach(() => {
  cleanup();
  act(() => {
    useGlossaryStore.getState().setTheme(DEFAULT_THEME);
  });
});

describe("o Equipamento congelado", () => {
  it("mostra a versão, a Habilidade fixada com o texto recolhido, o Item e a Relíquia", () => {
    render(<FrozenLoadoutPanel run={FROZEN} />);

    const panel = document.querySelector("[data-run-frozen-loadout]") as HTMLElement;
    expect(panel.getAttribute("data-run-frozen-loadout")).toBe(String(RUN.loadoutVersion));
    expect(panel.querySelector("[data-run-frozen-version]")?.textContent).toContain(
      `v${String(RUN.loadoutVersion)}`,
    );
    expect(panel.querySelector("[data-run-frozen-legacy]")).toBeNull();

    const skill = panel.querySelector(`[data-run-frozen-skill="${SKILL.name}"]`) as HTMLElement;
    expect(skill.querySelector("[data-run-frozen-skill-version]")?.textContent).toBe("v1");
    expect(skill.textContent).toContain(dnd["skill.version.pinned"]);
    expect(skill.querySelector("[data-run-frozen-skill-content]")).toBeNull();

    fireEvent.click(skill.querySelector("[data-run-frozen-skill-toggle]") as HTMLElement);
    const content = skill.querySelector("[data-run-frozen-skill-content]");
    expect(content?.tagName).toBe("PRE");
    expect(content?.textContent).toBe(SKILL_V1.content);

    expect(panel.querySelector(`[data-run-frozen-tool="${TOOL.name}"]`)?.textContent).toContain(
      "git status",
    );
    const mcp = panel.querySelector('[data-run-frozen-mcp="knowledge"]');
    expect(mcp?.textContent).toContain("node server.js --project");
    expect(mcp?.textContent).toContain("DATABASE_URL");
    expect(mcp?.textContent).toContain(dnd["mcpServer.builtIn"]);
  });

  it("um Run anterior à Fase 8 mostra só os nomes e diz por quê", () => {
    render(<FrozenLoadoutPanel run={RUN} />);
    expect(screen.getByText(dnd["run.frozen.legacy"])).toBeDefined();
    for (const name of RUN.loadoutSnapshot.skills) expect(screen.getByText(name)).toBeDefined();
  });

  it("o tema só muda o texto", () => {
    render(<FrozenLoadoutPanel run={FROZEN} />);
    expect(screen.getByText(dnd["run.frozen.title"])).toBeDefined();
    act(() => {
      useGlossaryStore.getState().setTheme("plain");
    });
    expect(screen.getByText(plain["run.frozen.title"])).toBeDefined();
    expect(screen.queryByText(dnd["run.frozen.title"])).toBeNull();
  });
});
