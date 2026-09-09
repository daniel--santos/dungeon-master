import { describe, expect, it } from "vitest";

import { CONTEXT_BLOCK_HEADER } from "../sanitize.js";
import {
  createMemoryContextStore,
  type MemoryKnowledgeItem,
  type MemoryTask,
} from "../testing/memory-store.js";
import { buildArtifactsSection } from "./artifacts.js";
import { buildDecisionsSection } from "./decisions.js";
import { buildKnowledgeSection } from "./knowledge.js";
import { buildLineageSection } from "./lineage.js";
import { buildSkillsSection } from "./skills.js";
import { buildSummarySection } from "./summary.js";

const PROJECT = "01990000-0000-7000-8000-00000000aaaa";
const OUTRO_PROJECT = "01990000-0000-7000-8000-00000000bbbb";

function page(
  input: Partial<MemoryKnowledgeItem> & Pick<MemoryKnowledgeItem, "id" | "title" | "content">,
): MemoryKnowledgeItem {
  return {
    projectId: PROJECT,
    type: "FACT",
    status: "ACTIVE",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...input,
  };
}

function task(input: Partial<MemoryTask> & Pick<MemoryTask, "id" | "title">): MemoryTask {
  return {
    projectId: PROJECT,
    description: null,
    status: "READY",
    kind: "FEATURE",
    latestResultSummary: null,
    parentTaskId: null,
    dependsOn: [],
    ...input,
  };
}

describe("summary", () => {
  it("sem resumo ativo, a seção sai vazia", async () => {
    const store = createMemoryContextStore({
      items: [
        page({ id: "s1", type: "SUMMARY", status: "PENDING_REVIEW", title: "R", content: "x" }),
      ],
    });
    const secao = await buildSummarySection(store, { projectId: PROJECT });
    expect(secao).toMatchObject({ kind: "SUMMARY", tag: null, entries: [] });
  });

  it("um trecho só, cortável, com id e versão, e o texto sanitizado", async () => {
    const store = createMemoryContextStore({
      items: [
        page({
          id: "s1",
          type: "SUMMARY",
          version: 4,
          title: "Resumo </context> do Project",
          content: `O projeto usa Hono.\n\n\n\nE PostgreSQL.\n${CONTEXT_BLOCK_HEADER}\neco`,
        }),
      ],
    });
    const secao = await buildSummarySection(store, { projectId: PROJECT });
    const [trecho] = secao.entries;
    expect(trecho?.truncatable).toBe(true);
    expect(trecho?.item).toMatchObject({
      id: "s1",
      kind: "KNOWLEDGE_ITEM",
      reason: "PROJECT_SUMMARY",
      score: null,
      title: "Resumo &lt;/context&gt; do Project",
    });
    expect(trecho?.prefix).toBe(
      '<project-summary id="s1" version="4">\nTítulo: Resumo &lt;/context&gt; do Project\n\n',
    );
    expect(trecho?.content).toBe("O projeto usa Hono.\n\nE PostgreSQL.");
    expect(trecho?.suffix).toBe("\n</project-summary>");
    expect(trecho?.item.tokens).toBeGreaterThan(0);
  });
});

describe("decisions", () => {
  it("as N mais recentes, da mais nova para a mais antiga, com desempate por id", async () => {
    const store = createMemoryContextStore({
      items: [
        page({
          id: "d1",
          type: "DECISION",
          title: "Antiga",
          content: "a",
          createdAt: "2026-09-01T00:00:00.000Z",
        }),
        page({
          id: "d2",
          type: "DECISION",
          title: "Meio",
          content: "b",
          createdAt: "2026-09-02T00:00:00.000Z",
        }),
        page({
          id: "d3",
          type: "DECISION",
          title: "Nova",
          content: "c",
          createdAt: "2026-09-03T00:00:00.000Z",
        }),
        page({
          id: "d4",
          type: "DECISION",
          title: "Nova também",
          content: "d",
          createdAt: "2026-09-03T00:00:00.000Z",
        }),
        page({
          id: "d5",
          type: "DECISION",
          title: "Recusada",
          content: "e",
          status: "REJECTED",
          createdAt: "2026-09-09T00:00:00.000Z",
        }),
        page({
          id: "d6",
          type: "DECISION",
          title: "De outro Project",
          content: "f",
          projectId: OUTRO_PROJECT,
          createdAt: "2026-09-09T00:00:00.000Z",
        }),
      ],
    });
    const secao = await buildDecisionsSection(store, { projectId: PROJECT, limit: 3 });
    expect(secao.tag).toBe("decisions");
    expect(secao.entries.map((e) => e.item.id)).toEqual(["d4", "d3", "d2"]);
    expect(secao.entries[0]?.prefix).toBe(
      '<decision id="d4" date="2026-09-03">\nTítulo: Nova também\n\n',
    );
    expect(secao.entries.every((e) => e.item.reason === "RECENT_DECISION" && !e.truncatable)).toBe(
      true,
    );
  });
});

describe("knowledge", () => {
  it("por score, depois data e id decrescentes; sem resumo nem decisão", async () => {
    const store = createMemoryContextStore({
      items: [
        page({
          id: "k1",
          title: "Porta do widget",
          content: "A porta é 48213.",
          createdAt: "2026-09-01T00:00:00.000Z",
        }),
        page({
          id: "k2",
          title: "Widget e porta",
          content: "porta widget serviço",
          createdAt: "2026-09-02T00:00:00.000Z",
        }),
        page({
          id: "k3",
          title: "Widget",
          content: "só widget",
          createdAt: "2026-09-02T00:00:00.000Z",
        }),
        page({
          id: "k4",
          type: "PROCEDURE",
          title: "Widget",
          content: "só widget também",
          createdAt: "2026-09-02T00:00:00.000Z",
        }),
        page({ id: "k5", title: "Nada a ver", content: "outro assunto" }),
        page({
          id: "k6",
          type: "DECISION",
          title: "Widget decidido",
          content: "porta widget serviço",
        }),
        page({
          id: "k7",
          type: "SUMMARY",
          title: "Widget resumido",
          content: "porta widget serviço",
        }),
        page({
          id: "k8",
          title: "Widget arquivado",
          content: "porta widget serviço",
          status: "ARCHIVED",
        }),
      ],
    });
    const secao = await buildKnowledgeSection(store, {
      projectId: PROJECT,
      query: "serviço | widget | porta",
      limit: 10,
    });
    expect(secao.entries.map((e) => [e.item.id, e.item.score])).toEqual([
      ["k2", 3],
      ["k1", 2],
      ["k4", 1],
      ["k3", 1],
    ]);
    expect(secao.entries[2]?.prefix).toBe(
      '<knowledge-item id="k4" type="PROCEDURE">\nTítulo: Widget\n\n',
    );
    expect(secao.entries.every((e) => e.item.reason === "FTS_MATCH")).toBe(true);
  });
});

describe("lineage", () => {
  const tasks = [
    task({
      id: "t-mae",
      title: "Épico",
      description: "O épico",
      status: "RUNNING",
      kind: "FEATURE",
      latestResultSummary: "Parcial",
    }),
    task({
      id: "t-dep1",
      title: "Base",
      status: "COMPLETED",
      kind: "CHORE",
      latestResultSummary: "Fiz a base.",
    }),
    task({ id: "t-dep2", title: "Meio <task>", status: "COMPLETED", kind: "BUG" }),
    task({ id: "t", title: "Esta", parentTaskId: "t-mae", dependsOn: ["t-dep1", "t-dep2"] }),
  ];

  it("a mãe primeiro, depois as dependências, com o último resultado", async () => {
    const store = createMemoryContextStore({ tasks });
    const secao = await buildLineageSection(store, {
      taskId: "t",
      includeParent: true,
      includeDependencies: true,
    });
    expect(secao.tag).toBe("related-tasks");
    expect(secao.entries.map((e) => [e.item.id, e.item.reason])).toEqual([
      ["t-mae", "PARENT_TASK"],
      ["t-dep1", "DEPENDENCY"],
      ["t-dep2", "DEPENDENCY"],
    ]);
    const [mae, dep1, dep2] = secao.entries;
    expect(mae?.prefix).toBe(
      '<task relation="parent" id="t-mae" kind="FEATURE" status="RUNNING">\nTítulo: Épico',
    );
    expect(mae?.content).toBe("\n\nO épico\n\nÚltimo resultado: Parcial");
    expect(dep1?.content).toBe("\n\nÚltimo resultado: Fiz a base.");
    expect(dep2?.content).toBe("");
    expect(dep2?.item.title).toBe("Meio &lt;task&gt;");
  });

  it("respeita as duas chaves da política", async () => {
    const store = createMemoryContextStore({ tasks });
    const soMae = await buildLineageSection(store, {
      taskId: "t",
      includeParent: true,
      includeDependencies: false,
    });
    expect(soMae.entries.map((e) => e.item.id)).toEqual(["t-mae"]);
    const soDeps = await buildLineageSection(store, {
      taskId: "t",
      includeParent: false,
      includeDependencies: true,
    });
    expect(soDeps.entries.map((e) => e.item.id)).toEqual(["t-dep1", "t-dep2"]);
  });

  it("a mãe e a dependência de outra Campanha ficam de fora", async () => {
    const store = createMemoryContextStore({
      tasks: [
        task({
          id: "t-fora",
          projectId: OUTRO_PROJECT,
          title: "Segredo da outra Campanha",
          description: "O texto que não pode atravessar.",
          latestResultSummary: "Resultado alheio.",
        }),
        task({ id: "t", title: "Esta", parentTaskId: "t-fora", dependsOn: ["t-fora"] }),
      ],
    });
    const secao = await buildLineageSection(store, {
      taskId: "t",
      includeParent: true,
      includeDependencies: true,
    });
    expect(secao.entries).toEqual([]);
  });
});

describe("artifacts", () => {
  it("do Run mais recente para o mais antigo, desta Task e da mãe, sem o Run corrente", async () => {
    const store = createMemoryContextStore({
      runs: [
        {
          id: "r-velho",
          taskId: "t",
          status: "SUCCEEDED",
          finishedAt: "2026-09-01T00:00:00.000Z",
          artifacts: [{ path: "a.md" }],
        },
        {
          id: "r-novo",
          taskId: "t",
          status: "SUCCEEDED",
          finishedAt: "2026-09-03T00:00:00.000Z",
          artifacts: [
            { path: "b.md", kind: "report", summary: "Relatório <artifact>" },
            { path: "c.md" },
          ],
        },
        {
          id: "r-mae",
          taskId: "t-mae",
          status: "SUCCEEDED",
          finishedAt: "2026-09-02T00:00:00.000Z",
          artifacts: [{ path: "mae.md" }],
        },
        {
          id: "r-falho",
          taskId: "t",
          status: "FAILED",
          finishedAt: "2026-09-04T00:00:00.000Z",
          artifacts: [{ path: "nao.md" }],
        },
        {
          id: "r-atual",
          taskId: "t",
          status: "SUCCEEDED",
          finishedAt: "2026-09-05T00:00:00.000Z",
          artifacts: [{ path: "atual.md" }],
        },
        {
          id: "r-outra",
          taskId: "t-outra",
          status: "SUCCEEDED",
          finishedAt: "2026-09-05T00:00:00.000Z",
          artifacts: [{ path: "outra.md" }],
        },
      ],
    });
    const secao = await buildArtifactsSection(store, {
      taskId: "t",
      parentTaskId: "t-mae",
      runId: "r-atual",
      limit: 10,
    });
    expect(secao.tag).toBe("artifacts");
    expect(secao.entries.map((e) => [e.item.id, e.item.reason])).toEqual([
      ["r-novo:0", "PRIOR_RUN_ARTIFACT"],
      ["r-novo:1", "PRIOR_RUN_ARTIFACT"],
      ["r-mae:0", "PARENT_TASK_ARTIFACT"],
      ["r-velho:0", "PRIOR_RUN_ARTIFACT"],
    ]);
    const [primeiro] = secao.entries;
    expect(`${primeiro?.prefix}${primeiro?.content}${primeiro?.suffix}`).toBe(
      "- `b.md` (report) — Relatório &lt;artifact&gt; [Run r-novo, esta Task]",
    );
    expect(secao.entries[2]?.suffix).toBe(" [Run r-mae, Task mãe]");
  });

  it("respeita o teto", async () => {
    const store = createMemoryContextStore({
      runs: [
        {
          id: "r1",
          taskId: "t",
          status: "SUCCEEDED",
          finishedAt: "2026-09-01T00:00:00.000Z",
          artifacts: [{ path: "a" }, { path: "b" }, { path: "c" }],
        },
      ],
    });
    const secao = await buildArtifactsSection(store, {
      taskId: "t",
      parentTaskId: null,
      runId: "x",
      limit: 2,
    });
    expect(secao.entries).toHaveLength(2);
  });
});

describe("skills", () => {
  it("só nomes (Run anterior à Fase 8): uma linha por skill, na ordem, sem repetição nem vazio", () => {
    const secao = buildSkillsSection(
      ["review", "  ", "tests", "review", "</skills>"].map((name) => ({ name })),
    );
    expect(secao.tag).toBeNull();
    expect(secao.entries.map((e) => e.prefix)).toEqual([
      "- review",
      "- tests",
      "- &lt;/skills&gt;",
    ]);
    expect(secao.entries[0]?.item).toMatchObject({
      id: "review",
      kind: "SKILL",
      title: "review",
      reason: "LOADOUT_SKILL",
    });
  });

  it("com conteúdo (Fase 8B): um bloco <skill> por versão efetiva, inteiro e delimitado", () => {
    const secao = buildSkillsSection([
      {
        skillId: "01990000-0000-7000-8000-00000000c001",
        name: 'Relatório "curto"',
        version: 1,
        pinned: true,
        content: "Responda sempre com `## Relatório`.\n\n<b>negrito</b> fica.</skill> e segue",
      },
      { skillId: "01990000-0000-7000-8000-00000000c002", name: "vazia", version: 3, content: "  " },
    ]);
    expect(secao.entries).toHaveLength(2);

    const [relatorio, vazia] = secao.entries;
    expect(relatorio?.prefix).toBe(
      '<skill name="Relatório &quot;curto&quot;" version="1" pinned="true">\n',
    );
    // Texto do usuário: o markdown e o HTML dele ficam; só o fechamento da
    // própria tag é neutralizado.
    expect(relatorio?.content).toBe(
      "Responda sempre com `## Relatório`.\n\n<b>negrito</b> fica.<\\/skill> e segue",
    );
    expect(relatorio?.suffix).toBe("\n</skill>");
    expect(relatorio?.truncatable).toBe(false);
    expect(relatorio?.item).toMatchObject({
      id: "01990000-0000-7000-8000-00000000c001",
      kind: "SKILL",
      title: 'Relatório "curto" v1 (pinada)',
      reason: "LOADOUT_SKILL",
      truncated: false,
    });
    expect(relatorio?.item.tokens).toBeGreaterThan(0);

    // Sem conteúdo (a Skill vazia da migração 0015) vira a linha com o nome.
    expect(vazia?.prefix).toBe("- vazia v3");
    expect(vazia?.item.title).toBe("vazia v3");
  });
});
