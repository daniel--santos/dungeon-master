import { describe, expect, it } from "vitest";

import { DEFINITION } from "@/test/workflow-fixtures";
import {
  convertDefinitionText,
  describeIssueLocation,
  mapDefinitionIssues,
  parseDefinitionText,
  stringifyDefinition,
  toDefinitionBody,
} from "@/lib/workflow-editor";

/**
 * O editor de texto: YAML vira o JSON que a API recebe, e os issues do `422`
 * apontam o step pela chave que o usuário escreveu.
 */

const YAML = `name: Cerimônia dos testes
description: Analisa e planeja.
steps:
  - type: agent
    key: analyze
    name: Analisar
    prompt: Analise a tarefa.
  - type: approval
    key: approve-plan
    name: Revisar o plano
    dependsOn: [analyze]
    gateKey: plan
    title: Confirmar o plano
`;

describe("parseDefinitionText", () => {
  it("lê YAML e devolve o objeto que vira o corpo JSON", () => {
    const parsed = parseDefinitionText(YAML, "yaml");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const body = toDefinitionBody(parsed.value);
    expect(body).not.toBeNull();
    expect(body?.name).toBe("Cerimônia dos testes");
    expect(body?.steps).toHaveLength(2);
    expect(body?.steps[1]).toMatchObject({ type: "approval", dependsOn: ["analyze"] });
    // O que sai daqui é JSON puro: nada de tipos do YAML sobrando.
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
  });

  it("lê JSON pelo JSON.parse, com a mensagem de posição dele", () => {
    const ok = parseDefinitionText(JSON.stringify(DEFINITION), "json");
    expect(ok.ok).toBe(true);

    const broken = parseDefinitionText('{ "name": "x", "steps": [ }', "json");
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.message).toMatch(/^JSON inválido/);
  });

  it("um YAML torto diz a linha em vez de virar objeto vazio", () => {
    const broken = parseDefinitionText("name: x\nsteps:\n  - type: agent\n   key: [", "yaml");
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.message).toMatch(/^YAML inválido/);
  });

  it("recusa texto vazio e documentos que não são objeto", () => {
    expect(parseDefinitionText("   ", "yaml").ok).toBe(false);
    expect(parseDefinitionText("- a\n- b", "yaml").ok).toBe(false);
    expect(parseDefinitionText("42", "json").ok).toBe(false);
  });

  it("toDefinitionBody exige name e steps", () => {
    expect(toDefinitionBody({ name: "x" })).toBeNull();
    expect(toDefinitionBody({ steps: [] })).toBeNull();
    expect(toDefinitionBody({ name: "x", steps: [] })).not.toBeNull();
  });
});

describe("conversão entre formatos", () => {
  it("YAML → JSON → YAML preserva a definição", () => {
    const json = convertDefinitionText(YAML, "yaml", "json");
    expect(json).not.toBeNull();
    expect(JSON.parse(json ?? "")).toMatchObject({ name: "Cerimônia dos testes" });

    const back = convertDefinitionText(json ?? "", "json", "yaml");
    const reparsed = parseDefinitionText(back ?? "", "yaml");
    expect(reparsed.ok && reparsed.value).toEqual(JSON.parse(json ?? ""));
  });

  it("devolve null quando o texto de origem não é legível, sem apagar nada", () => {
    expect(convertDefinitionText("{ nope", "json", "yaml")).toBeNull();
  });

  it("stringify em JSON termina com quebra de linha e indenta com dois espaços", () => {
    const text = stringifyDefinition(DEFINITION, "json");
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('\n  "steps": [');
  });
});

describe("mapeamento dos issues do 422", () => {
  it("liga cada issue ao step pela chave escrita no texto", () => {
    const issues = mapDefinitionIssues(
      [
        {
          path: "steps.3.dependsOn.0",
          message: 'O step "execute" depende de "aprove-plan", que não existe na definição.',
          code: "custom",
        },
        { path: "steps.1.when.0.step", message: "não é dependência", code: "custom" },
        { path: "name", message: "Too small", code: "too_small" },
        { path: "", message: "raiz", code: "custom" },
      ],
      DEFINITION,
    );

    expect(issues[0]).toEqual({
      stepIndex: 3,
      stepKey: "execute",
      field: "dependsOn.0",
      message: 'O step "execute" depende de "aprove-plan", que não existe na definição.',
    });
    expect(issues[1]).toMatchObject({ stepIndex: 1, stepKey: "plan", field: "when.0.step" });
    expect(issues[2]).toEqual({
      stepIndex: null,
      stepKey: null,
      field: "name",
      message: "Too small",
    });
    expect(issues[3]).toMatchObject({ stepIndex: null, field: "" });

    expect(describeIssueLocation(issues[0]!)).toBe("execute · dependsOn.0");
    expect(describeIssueLocation(issues[2]!)).toBe("name");
    expect(describeIssueLocation(issues[3]!)).toBe("definição");
  });

  it("um step sem chave no texto é apontado pelo índice", () => {
    const issues = mapDefinitionIssues(
      [{ path: "steps.0.key", message: "Required", code: "invalid_type" }],
      { name: "x", steps: [{ type: "agent" }] },
    );
    expect(issues[0]).toMatchObject({ stepIndex: 0, stepKey: null, field: "key" });
    expect(describeIssueLocation(issues[0]!)).toBe("steps.0 · key");
  });
});
