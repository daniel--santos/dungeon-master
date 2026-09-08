import { getGlossary, format, type GlossaryKey } from "@dungeon-master/glossary";
import { describe, expect, it } from "vitest";

import type { RunEvent } from "@/lib/run-events";
import { buildTimeline, countByFilter, type TimelineLabels } from "@/lib/run-timeline";

/**
 * O Diário mostra o mesmo conteúdo do log, com outra densidade.
 *
 * O que se prova aqui é que agrupar não apaga: o texto emendado é o texto
 * inteiro, o contador diz quantos pedaços entraram, e um evento no meio quebra
 * o bloco em dois em vez de fundir dois pensamentos.
 */

const labels: TimelineLabels = {
  t: (key: GlossaryKey) => getGlossary("dnd")[key],
  format,
};

function event(sequence: number, type: string, payload: unknown): RunEvent {
  return {
    id: `0199dddd-0000-7000-8000-${String(sequence).padStart(12, "0")}`,
    runId: "0199cccc-0000-7000-8000-000000000001",
    sequence,
    type,
    timestamp: "2026-09-07T14:02:11.000Z",
    payload,
  };
}

const delta = (sequence: number, text: string) => event(sequence, "TextDelta", { text });

describe("agrupamento de TextDelta", () => {
  it("emenda pedaços contíguos numa linha e conta quantos foram", () => {
    const rows = buildTimeline(
      [delta(1, "O polling desiste "), delta(2, "antes do último "), delta(3, "neto sair.")],
      { labels },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("O polling desiste antes do último neto sair.");
    expect(rows[0]?.groupSize).toBe(3);
    // A linha se identifica pelo último pedaço, que é o que a virtualização
    // precisa manter estável enquanto o bloco cresce.
    expect(rows[0]?.sequence).toBe(3);
  });

  it("um evento no meio quebra o bloco em dois", () => {
    const rows = buildTimeline(
      [
        delta(1, "vou rodar a suíte"),
        event(2, "ToolCall", { name: "Bash", arguments: "pnpm test" }),
        event(3, "ToolResult", { ok: true, output: "14 de 14 passaram" }),
        delta(4, "passou"),
      ],
      { labels },
    );

    expect(rows.map((row) => row.type)).toEqual([
      "TextDelta",
      "ToolCall",
      "ToolResult",
      "TextDelta",
    ]);
    expect(rows.every((row) => row.groupSize === 1)).toBe(true);
  });

  it("não emenda pedaços com lacuna de sequence", () => {
    const rows = buildTimeline([delta(1, "antes"), delta(7, "depois")], { labels });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.title)).toEqual(["antes", "depois"]);
  });

  it("filtrar por tipo não funde blocos que estavam separados", () => {
    const rows = buildTimeline(
      [
        delta(1, "antes"),
        event(2, "ToolCall", { name: "Read", arguments: "a.ts" }),
        delta(3, "depois"),
      ],
      { labels, filter: "text" },
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.title)).toEqual(["antes", "depois"]);
  });
});

describe("leitura do payload", () => {
  it("mostra a chamada com o nome e o argumento resumido", () => {
    const rows = buildTimeline(
      [event(1, "ToolCall", { name: "Edit", arguments: "packages/platform/src/process-tree.ts" })],
      { labels },
    );

    expect(rows[0]?.title).toBe("Edit");
    expect(rows[0]?.detail).toBe("packages/platform/src/process-tree.ts");
    expect(rows[0]?.code).toBe(true);
  });

  it("uma consulta ao Grimório aparece pelo nome curto e marcada, com a resposta dela", () => {
    const rows = buildTimeline(
      [
        event(1, "ToolCall", {
          toolCallId: "c1",
          name: "mcp__knowledge__search_knowledge",
          arguments: '{"query":"portão"}',
        }),
        event(2, "ToolResult", { toolCallId: "c1", ok: true, output: "2 páginas" }),
        event(3, "ToolCall", { name: "Bash", arguments: "pnpm test" }),
      ],
      { labels },
    );

    expect(rows[0]?.title).toBe("search_knowledge");
    expect(rows[0]?.knowledge).toBe(true);
    expect(rows[1]?.knowledge).toBe(true);
    expect(rows[2]?.title).toBe("Bash");
    expect(rows[2]?.knowledge).toBe(false);
  });

  it("o filtro não muda quem responde a quem: a resposta sem id continua do Grimório", () => {
    const rows = buildTimeline(
      [
        event(1, "ToolCall", { name: "mcp__knowledge__list_decisions", arguments: "{}" }),
        delta(2, "lendo"),
        event(3, "ToolResult", { ok: true, output: "3 decisões" }),
      ],
      { labels, filter: "tools" },
    );

    expect(rows.map((row) => row.knowledge)).toEqual([true, true]);
  });

  it("a última chamada sem resposta fica marcada como pendente", () => {
    const pendente = buildTimeline(
      [event(1, "ToolCall", { name: "Bash", arguments: "pnpm test" })],
      {
        labels,
      },
    );
    expect(pendente[0]?.running).toBe(true);

    const respondida = buildTimeline(
      [
        event(1, "ToolCall", { name: "Bash", arguments: "pnpm test" }),
        event(2, "ToolResult", { ok: true, output: "código 0" }),
      ],
      { labels },
    );
    expect(respondida[0]?.running).toBe(false);
  });

  it("usa o glossário nos eventos terminais", () => {
    const rows = buildTimeline(
      [event(1, "RunCancelled", { processTreeTerminated: true, elapsedMs: 41_000 })],
      { labels },
    );

    expect(rows[0]?.title).toBe(getGlossary("dnd")["run.status.cancelled"]);
    expect(rows[0]?.detail).toContain("árvore de processos confirmada encerrada");
  });

  it("um tipo desconhecido aparece pelo nome em vez de sumir", () => {
    const rows = buildTimeline([event(1, "AlgoQueAindaNaoExiste", { seja: "o que for" })], {
      labels,
    });

    expect(rows[0]?.title).toBe("AlgoQueAindaNaoExiste");
    expect(rows[0]?.group).toBe("system");
  });

  it("um payload ausente não derruba a linha", () => {
    const rows = buildTimeline([event(1, "ToolCall", undefined)], { labels });

    expect(rows[0]?.title).toBe("ToolCall");
    expect(rows[0]?.detail).toBe("");
  });
});

describe("contagem por filtro", () => {
  it("soma cada grupo e o total", () => {
    const counts = countByFilter([
      delta(1, "a"),
      event(2, "ToolCall", { name: "Bash", arguments: "x" }),
      event(3, "ToolResult", { ok: true, output: "y" }),
      event(4, "Usage", { usage: {} }),
      event(5, "Diagnostic", { level: "WARN", source: "RUNTIME", message: "z" }),
      event(6, "RunCompleted", { summary: "fim", durationMs: 1 }),
    ]);

    expect(counts).toEqual({
      all: 6,
      tools: 2,
      text: 1,
      workflow: 0,
      usage: 1,
      system: 1,
      diagnostic: 1,
    });
  });
});

describe("eventos do motor de Workflow", () => {
  it("StepStarted diz o step, o tipo e a tentativa", () => {
    const rows = buildTimeline(
      [
        event(1, "StepStarted", {
          runStepId: "x",
          stepKey: "analyze",
          stepType: "agent",
          attempt: 1,
          timestamp: "2026-09-07T14:02:11.000Z",
        }),
      ],
      { labels },
    );

    expect(rows[0]?.title).toContain("analyze");
    expect(rows[0]?.title).toContain(getGlossary("dnd")["entity.workflowStep"]);
    expect(rows[0]?.detail).toContain(getGlossary("dnd")["workflowStep.type.agent"]);
    expect(rows[0]?.detail).toContain("tentativa 1");
    expect(rows[0]?.group).toBe("workflow");
  });

  it("StepFinished traz o estado pelo glossário, o resumo e a duração", () => {
    const rows = buildTimeline(
      [
        event(1, "StepFinished", {
          runStepId: "x",
          stepKey: "plan",
          status: "SUCCEEDED",
          attempt: 2,
          summary: "Plano em cinco passos.",
          durationMs: 4_200,
        }),
      ],
      { labels },
    );

    expect(rows[0]?.title).toBe(`${getGlossary("dnd")["runStep.status.succeeded"]} · plan`);
    expect(rows[0]?.detail).toBe("Plano em cinco passos. · 4 s");
  });

  it("StepSkipped explica o predicado que falhou", () => {
    const rows = buildTimeline(
      [
        event(1, "StepSkipped", {
          runStepId: "x",
          stepKey: "execute",
          reason: {
            code: "PREDICATE_FALSE",
            predicate: { kind: "stepSucceeded", step: "approve-plan" },
            detail: "approve-plan terminou em FAILED",
          },
        }),
      ],
      { labels },
    );

    expect(rows[0]?.title).toBe(`${getGlossary("dnd")["runStep.status.skipped"]} · execute`);
    expect(rows[0]?.detail).toBe(
      `${getGlossary("dnd")["runStep.skip.predicateFalse"]}: approve-plan terminou em FAILED`,
    );
  });

  it("ApprovalGranted e ApprovalRejected mostram a decisão e a nota", () => {
    const rows = buildTimeline(
      [
        event(1, "ApprovalGranted", { gateKey: "plan", note: "Pode seguir." }),
        event(2, "ApprovalRejected", { gateKey: "plan", note: null }),
      ],
      { labels },
    );

    expect(rows[0]?.title).toBe(`${getGlossary("dnd")["approval.status.granted"]} · plan`);
    expect(rows[0]?.detail).toBe("Pode seguir.");
    expect(rows[1]?.title).toBe(`${getGlossary("dnd")["approval.status.rejected"]} · plan`);
    expect(rows[1]?.detail).toBeNull();
    expect(countByFilter(rows.map((row, i) => event(i + 1, row.type, {}))).workflow).toBe(2);
  });
});
