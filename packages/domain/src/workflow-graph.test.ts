import {
  type RunStepStatus,
  type WorkflowDefinition,
  WorkflowDefinitionSchema,
} from "@dungeon-master/contracts";
import { describe, expect, it } from "vitest";

import {
  evaluateStepReadiness,
  findWorkflowCycle,
  isWorkflowSettled,
  missingDependencies,
  topologicalOrder,
  type WorkflowGraphStep,
} from "./workflow-graph.js";

function step(
  key: string,
  dependsOn: string[] = [],
  extra: Partial<WorkflowGraphStep> = {},
): WorkflowGraphStep {
  return { key, dependsOn, ...extra };
}

function estado(entries: Record<string, RunStepStatus>): Map<string, RunStepStatus> {
  return new Map(Object.entries(entries));
}

describe("findWorkflowCycle", () => {
  it("devolve null num DAG", () => {
    expect(
      findWorkflowCycle([step("aa"), step("bb", ["aa"]), step("cc", ["aa", "bb"])]),
    ).toBeNull();
  });

  it("devolve o caminho fechado num ciclo", () => {
    const cycle = findWorkflowCycle([step("aa", ["cc"]), step("bb", ["aa"]), step("cc", ["bb"])]);
    expect(cycle).toEqual(["aa", "cc", "bb", "aa"]);
  });

  it("ignora referência inexistente e auto-aresta, que são defeitos à parte", () => {
    expect(findWorkflowCycle([step("aa", ["ghost", "aa"])])).toBeNull();
    expect(missingDependencies([step("aa", ["ghost", "aa"])])).toEqual([
      { key: "aa", dependency: "ghost" },
      { key: "aa", dependency: "aa" },
    ]);
  });
});

describe("topologicalOrder", () => {
  it("respeita dependências e desempata pela ordem da definição", () => {
    const result = topologicalOrder([
      step("validate", ["execute"]),
      step("execute", ["approve-plan"]),
      step("approve-plan", ["plan"]),
      step("plan", ["analyze"]),
      step("analyze"),
      step("lint"),
    ]);

    expect(result).toEqual({
      ok: true,
      order: ["analyze", "plan", "approve-plan", "execute", "validate", "lint"],
    });
  });

  it("é determinística", () => {
    const steps = [step("bb", ["aa"]), step("aa"), step("cc", ["aa"]), step("dd", ["bb", "cc"])];
    expect(topologicalOrder(steps)).toEqual(topologicalOrder([...steps]));
  });

  it("recusa ciclo e referência solta, sem laço infinito", () => {
    expect(topologicalOrder([step("aa", ["bb"]), step("bb", ["aa"])])).toEqual({
      ok: false,
      code: "CYCLE",
      cycle: ["aa", "bb", "aa"],
    });
    expect(topologicalOrder([step("aa", ["zz"])])).toEqual({
      ok: false,
      code: "MISSING_DEPENDENCY",
      missing: [{ key: "aa", dependency: "zz" }],
    });
  });
});

describe("evaluateStepReadiness", () => {
  const GUIADA = [
    step("analyze"),
    step("plan", ["analyze"]),
    step("approve-plan", ["plan"]),
    step("execute", ["approve-plan"], { when: [{ kind: "stepSucceeded", step: "approve-plan" }] }),
    step("validate", ["execute"]),
  ];

  it("no começo só as raízes ficam prontas", () => {
    const readiness = evaluateStepReadiness(
      GUIADA,
      estado({
        analyze: "PENDING",
        plan: "PENDING",
        "approve-plan": "PENDING",
        execute: "PENDING",
        validate: "PENDING",
      }),
    );
    expect(readiness).toEqual({ ready: ["analyze"], skipped: [] });
  });

  it("sem `when`, dependência que não terminou em SUCCEEDED pula o step com o motivo", () => {
    const readiness = evaluateStepReadiness(
      GUIADA,
      estado({
        analyze: "SUCCEEDED",
        plan: "FAILED",
        "approve-plan": "PENDING",
        execute: "PENDING",
        validate: "PENDING",
      }),
    );
    expect(readiness).toEqual({
      ready: [],
      skipped: [
        {
          key: "approve-plan",
          reason: { code: "DEPENDENCY_NOT_SUCCEEDED", dependency: "plan", status: "FAILED" },
        },
      ],
    });
  });

  it("com `when`, o step fica pronto mesmo com dependência falha: os predicados decidem", () => {
    const readiness = evaluateStepReadiness(
      GUIADA,
      estado({
        analyze: "SUCCEEDED",
        plan: "SUCCEEDED",
        "approve-plan": "FAILED",
        execute: "PENDING",
        validate: "PENDING",
      }),
    );
    expect(readiness).toEqual({ ready: ["execute"], skipped: [] });
  });

  it("dependência ainda em voo, ou ausente do mapa, segura o step", () => {
    expect(
      evaluateStepReadiness(
        GUIADA,
        estado({
          analyze: "SUCCEEDED",
          plan: "RUNNING",
          "approve-plan": "PENDING",
          execute: "PENDING",
          validate: "PENDING",
        }),
      ),
    ).toEqual({ ready: [], skipped: [] });

    expect(evaluateStepReadiness([step("bb", ["aa"])], estado({ bb: "PENDING" }))).toEqual({
      ready: [],
      skipped: [],
    });
  });

  it("um step pulado assenta os dependentes, que são pulados em cascata", () => {
    const readiness = evaluateStepReadiness(
      GUIADA,
      estado({
        analyze: "SUCCEEDED",
        plan: "SUCCEEDED",
        "approve-plan": "SUCCEEDED",
        execute: "SKIPPED",
        validate: "PENDING",
      }),
    );
    expect(readiness.skipped).toEqual([
      {
        key: "validate",
        reason: { code: "DEPENDENCY_NOT_SUCCEEDED", dependency: "execute", status: "SKIPPED" },
      },
    ]);
  });

  it("isWorkflowSettled só é verdadeiro com tudo terminal", () => {
    expect(isWorkflowSettled(estado({ aa: "SUCCEEDED", bb: "SKIPPED" }))).toBe(true);
    expect(isWorkflowSettled(estado({ aa: "SUCCEEDED", bb: "WAITING_APPROVAL" }))).toBe(false);
    expect(isWorkflowSettled(new Map())).toBe(true);
  });
});

/**
 * Paridade com o contrato (documento técnico, seção 19.1, item 7).
 *
 * O `superRefine` de `WorkflowDefinitionSchema` tem a própria detecção de
 * ciclo, porque o contrato não pode importar o domínio. As duas precisam
 * concordar: uma definição que o schema aceita tem ordem topológica aqui, e
 * uma que ele recusa por ciclo não tem.
 */
describe("paridade com WorkflowDefinitionSchema", () => {
  function definicao(steps: WorkflowGraphStep[]): unknown {
    return {
      name: "paridade",
      steps: steps.map((item) => ({
        type: "command",
        key: item.key,
        name: item.key,
        dependsOn: item.dependsOn,
        argv: ["true"],
      })),
    };
  }

  const CASOS: ReadonlyArray<readonly [string, WorkflowGraphStep[]]> = [
    ["linear", [step("aa"), step("bb", ["aa"]), step("cc", ["bb"])]],
    ["diamante", [step("aa"), step("bb", ["aa"]), step("cc", ["aa"]), step("dd", ["bb", "cc"])]],
    ["ciclo curto", [step("aa", ["bb"]), step("bb", ["aa"])]],
    ["ciclo longo", [step("aa", ["cc"]), step("bb", ["aa"]), step("cc", ["bb"]), step("dd")]],
    ["referência solta", [step("aa", ["zz"])]],
    ["desconexo", [step("aa"), step("bb")]],
  ];

  it.each(CASOS)("%s", (_nome, steps) => {
    const schema = WorkflowDefinitionSchema.safeParse(definicao(steps));
    const grafo = topologicalOrder(steps);
    expect(schema.success).toBe(grafo.ok);
    if (schema.success) {
      const parsed: WorkflowDefinition = schema.data;
      expect(topologicalOrder(parsed.steps).ok).toBe(true);
    }
  });
});
