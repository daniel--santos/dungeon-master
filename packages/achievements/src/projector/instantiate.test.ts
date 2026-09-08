import { describe, expect, it } from "vitest";

import { loadTemplates } from "../load.js";

import { formatTemplateText, instantiateTemplate, placeholderForScope } from "./instantiate.js";
import {
  applyEvent,
  EMPTY_PROGRESS,
} from "./progress.js";

const templates = loadTemplates().valid;

function template(key: string) {
  const found = templates.find((item) => item.key === key);
  if (found === undefined) throw new Error(`Template ${key} não está no arquivo v1.`);
  return found;
}

const PROJECT_ID = "01996d00-0000-7000-8000-0000000000aa";

describe("instantiateTemplate", () => {
  it("escopa a condição pelo campo de `scopeFrom` e mantém o placeholder no nome", () => {
    const resultado = instantiateTemplate(template("campaign_guardian"), PROJECT_ID);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.value.definition.condition.filter).toEqual({ "project.id": PROJECT_ID });
    expect(resultado.value.definition.name.theme).toContain("{project}");
    expect(resultado.value.definition.origin).toBe("TEMPLATE");
    expect(resultado.value.definition.hidden).toBe(true);
  });

  it("a instância só conta o que é do escopo dela", () => {
    const resultado = instantiateTemplate(template("campaign_guardian"), PROJECT_ID);
    if (!resultado.ok) throw new Error(resultado.rejection.error);
    const condition = resultado.value.definition.condition;

    const doProject = applyEvent(condition, EMPTY_PROGRESS, {
      source: "task.completed",
      at: "2026-09-07T12:00:00.000Z",
      runId: null,
      taskId: null,
      fields: { "project.id": PROJECT_ID },
    });
    expect(doProject.progress.counter).toBe(1);

    const deOutro = applyEvent(condition, EMPTY_PROGRESS, {
      source: "task.completed",
      at: "2026-09-07T12:00:00.000Z",
      runId: null,
      taskId: null,
      fields: { "project.id": "01996d00-0000-7000-8000-0000000000bb" },
    });
    expect(deOutro.progress.counter).toBe(0);
  });

  it("recusa um escopo que o campo do filtro não aceita", () => {
    // `project.id` é um uuid no schema; "campanha-1" não passa, e a instância
    // fica de fora em vez de virar uma definição que nunca casaria.
    const resultado = instantiateTemplate(template("campaign_guardian"), "campanha-1");
    expect(resultado.ok).toBe(false);
  });

  it("a Guilda é escopada por slug, não por uuid", () => {
    const resultado = instantiateTemplate(template("guild_ally"), "claude");
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.value.definition.condition.filter).toEqual({ "run.harness": "claude" });
  });

  it("escopo vazio é recusado", () => {
    expect(instantiateTemplate(template("hero_veteran"), "").ok).toBe(false);
  });
});

describe("formatTemplateText", () => {
  it("troca o placeholder conhecido e deixa o resto intacto", () => {
    expect(formatTemplateText("Guardião de {project}", { project: "Dungeon Master" })).toBe(
      "Guardião de Dungeon Master",
    );
    expect(formatTemplateText("Guardião de {project}", {})).toBe("Guardião de {project}");
    expect(formatTemplateText("Nada a trocar", { project: "x" })).toBe("Nada a trocar");
    expect(formatTemplateText("{desconhecido}", { project: "x" })).toBe("{desconhecido}");
  });

  it("cada escopo sabe qual placeholder preenche", () => {
    expect(placeholderForScope("PROJECT")).toBe("project");
    expect(placeholderForScope("HARNESS")).toBe("harness");
    expect(placeholderForScope("AGENT")).toBe("agent");
    expect(placeholderForScope("TASK")).toBe("task");
    expect(placeholderForScope("GLOBAL")).toBeNull();
  });
});
