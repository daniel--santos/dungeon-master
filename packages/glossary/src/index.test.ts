import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME,
  GLOSSARIES,
  GLOSSARY_KEYS,
  THEME_IDS,
  dnd,
  format,
  getGlossary,
  isThemeId,
  placeholdersOf,
  plain,
  t,
  type GlossaryKey,
  type ThemeId,
} from "./index.js";

const themes: readonly ThemeId[] = THEME_IDS;

describe("chaves", () => {
  it("não repete nenhuma chave", () => {
    expect(new Set(GLOSSARY_KEYS).size).toBe(GLOSSARY_KEYS.length);
  });

  it("usa apenas o formato canônico em inglês", () => {
    for (const key of GLOSSARY_KEYS) {
      expect(key).toMatch(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/);
    }
  });

  it("não vaza vocabulário temático para as chaves", () => {
    const tematico =
      /campanha|missao|missão|expedicao|expedição|heroi|herói|guilda|grimorio|grimório|espolio|espólio|monstro/i;
    for (const key of GLOSSARY_KEYS) {
      expect(key).not.toMatch(tematico);
    }
  });
});

describe("paridade entre os glossários", () => {
  it("os dois têm exatamente o conjunto de GLOSSARY_KEYS", () => {
    const esperado = [...GLOSSARY_KEYS].sort();
    expect(Object.keys(dnd).sort()).toEqual(esperado);
    expect(Object.keys(plain).sort()).toEqual(esperado);
  });

  it("nenhum valor é vazio ou só espaço", () => {
    for (const theme of themes) {
      for (const key of GLOSSARY_KEYS) {
        expect(getGlossary(theme)[key].trim(), `${theme}:${key}`).not.toBe("");
      }
    }
  });

  it("cobre as onze rotas da seção 8 e as quatro abas do Hall", () => {
    const nav = GLOSSARY_KEYS.filter((key) => key.startsWith("nav."));
    const abas = GLOSSARY_KEYS.filter((key) => key.startsWith("hall.tab."));
    expect(nav).toHaveLength(11);
    expect(abas).toHaveLength(4);
  });

  it("cobre os nove estados e as quatro prioridades de Task da Fase 1", () => {
    const estados = GLOSSARY_KEYS.filter((key) => key.startsWith("task.status."));
    const prioridades = GLOSSARY_KEYS.filter((key) => key.startsWith("task.priority."));
    expect(estados).toHaveLength(9);
    expect(prioridades).toHaveLength(4);
  });

  it("cobre os três filtros do Hall e os valores que eles oferecem", () => {
    const filtros = GLOSSARY_KEYS.filter((key) => key.startsWith("hall.filter."));
    expect(filtros).toHaveLength(3);
    expect(GLOSSARY_KEYS.filter((key) => key.startsWith("achievement.origin."))).toHaveLength(3);
    expect(GLOSSARY_KEYS.filter((key) => key.startsWith("achievement.rarity."))).toHaveLength(4);
    expect(GLOSSARY_KEYS.filter((key) => key.startsWith("achievement.state."))).toHaveLength(4);
  });
});

describe("decisões de UX da Fase 2", () => {
  it("cobre os nove estados de Run", () => {
    expect(GLOSSARY_KEYS.filter((key) => key.startsWith("run.status."))).toHaveLength(9);
  });

  it("só o Selo é tematizado entre os estados não terminais", () => {
    for (const key of [
      "run.status.created",
      "run.status.queued",
      "run.status.preparing",
      "run.status.running",
    ] as const) {
      expect(t("dnd", key), key).toBe(t("plain", key));
    }
    expect(t("dnd", "run.status.waitingApproval")).toBe("Aguardando o Selo");
    expect(t("plain", "run.status.waitingApproval")).toBe("Aguardando aprovação");
  });

  it("enforcement não é tematizado: a barreira é informação de segurança", () => {
    const chaves = GLOSSARY_KEYS.filter((key: GlossaryKey) => key.startsWith("enforcement."));
    expect(chaves.length).toBeGreaterThan(0);
    for (const key of chaves) {
      expect(t("dnd", key), key).toBe(t("plain", key));
    }
  });

  it("cobre os onze campos de HarnessCapabilities", () => {
    expect(GLOSSARY_KEYS.filter((key) => key.startsWith("harness.capability."))).toHaveLength(11);
  });

  it("cobre as três estratégias de workspace", () => {
    expect(GLOSSARY_KEYS.filter((key) => key.startsWith("workspaceStrategy."))).toHaveLength(3);
  });
});

describe("regra de segurança da seção 14", () => {
  it("HOST no tema é 'Campo aberto'", () => {
    expect(dnd["env.host"]).toBe("Campo aberto");
  });

  it("'sem isolamento' acompanha o modo HOST nos dois glossários", () => {
    for (const theme of themes) {
      expect(t(theme, "env.host.warning")).toBe("sem isolamento");
    }
  });

  it("o badge mantém o texto canônico nos dois modos", () => {
    for (const theme of themes) {
      expect(t(theme, "env.host.canonical")).toBe("HOST · UNISOLATED");
      expect(t(theme, "env.docker.canonical")).toBe("DOCKER · ISOLATED");
    }
  });
});

describe("tema", () => {
  it("nasce ligado", () => {
    expect(DEFAULT_THEME).toBe("dnd");
  });

  it("getGlossary devolve o glossário do tema", () => {
    expect(getGlossary("dnd")).toBe(dnd);
    expect(getGlossary("plain")).toBe(plain);
    expect(Object.keys(GLOSSARIES).sort()).toEqual(["dnd", "plain"]);
  });

  it("t resolve o label no tema pedido", () => {
    expect(t("dnd", "entity.project.plural")).toBe("Campanhas");
    expect(t("plain", "entity.project.plural")).toBe("Projetos");
    expect(t("dnd", "hall.tab.bestiary")).toBe("Bestiário");
    expect(t("plain", "hall.tab.bestiary")).toBe("Bugs resolvidos");
  });

  it("isThemeId aceita só os temas conhecidos", () => {
    expect(isThemeId("dnd")).toBe(true);
    expect(isThemeId("plain")).toBe(true);
    expect(isThemeId("DND")).toBe(false);
    expect(isThemeId(undefined)).toBe(false);
    expect(isThemeId(null)).toBe(false);
  });

  it("o rótulo do interruptor é o mesmo nos dois modos", () => {
    expect(t("dnd", "settings.theme.toggle")).toBe("Tema Dungeon Master");
    expect(t("plain", "settings.theme.toggle")).toBe(t("dnd", "settings.theme.toggle"));
    expect(t("plain", "settings.theme.description")).not.toBe(
      t("dnd", "settings.theme.description"),
    );
  });

  it("estado e prioridade de Task não são tematizados", () => {
    const chaves = GLOSSARY_KEYS.filter(
      (key: GlossaryKey) => key.startsWith("task.status.") || key.startsWith("task.priority."),
    );
    for (const key of chaves) {
      expect(t("dnd", key), key).toBe(t("plain", key));
    }
    expect(t("dnd", "task.status.inbox")).toBe("Capturada");
    expect(t("plain", "task.status.running")).toBe("Em execução");
    expect(t("dnd", "task.priority.urgent")).toBe("Urgente");
  });

  it("infraestrutura não é tematizada", () => {
    const infra = GLOSSARY_KEYS.filter((key: GlossaryKey) => key.startsWith("infra."));
    expect(infra.length).toBeGreaterThan(0);
    for (const key of infra) {
      expect(t("dnd", key)).toBe(t("plain", key));
    }
  });
});

describe("format", () => {
  it("troca cada placeholder pelo valor", () => {
    expect(format("Guardião de {project}", { project: "Dungeon Master" })).toBe(
      "Guardião de Dungeon Master",
    );
  });

  it("aceita números e repetições", () => {
    expect(format("{n} de {n} em {project}", { n: 25, project: "DM" })).toBe("25 de 25 em DM");
  });

  it("deixa intacto o placeholder sem valor", () => {
    expect(format("Recorde de {project}")).toBe("Recorde de {project}");
    expect(format("Recorde de {project}", { agent: "Aria" })).toBe("Recorde de {project}");
  });

  it("não interpreta nada além do nome do placeholder", () => {
    expect(format("{a.b} e {  x }", { "a.b": "ok" })).toBe("ok e {  x }");
  });

  it("placeholdersOf lista os nomes sem repetir", () => {
    expect(placeholdersOf("{project}: {n}/{n} em {project}")).toEqual(["project", "n"]);
    expect(placeholdersOf("Primeira Expedição")).toEqual([]);
  });
});

describe("Fase 4C — Rituais e Selos", () => {
  it("cobre os cinco tipos de step, os oito estados de RunStep e os dois motivos de pulo", () => {
    expect(GLOSSARY_KEYS.filter((key) => key.startsWith("workflowStep.type."))).toHaveLength(5);
    expect(GLOSSARY_KEYS.filter((key) => key.startsWith("runStep.status."))).toHaveLength(8);
    expect(GLOSSARY_KEYS.filter((key) => key.startsWith("runStep.skip."))).toHaveLength(2);
  });

  it("cobre as duas decisões e os três estados do gate", () => {
    expect(GLOSSARY_KEYS.filter((key) => key.startsWith("approval.decision."))).toHaveLength(2);
    expect(GLOSSARY_KEYS.filter((key) => key.startsWith("approval.status."))).toHaveLength(3);
  });

  it("as decisões são tematizadas: Selo no tema, verbo neutro sem ele", () => {
    expect(t("dnd", "approval.decision.approve")).toBe("Conceder o Selo");
    expect(t("dnd", "approval.decision.reject")).toBe("Negar o Selo");
    expect(t("plain", "approval.decision.approve")).toBe("Aprovar");
    expect(t("plain", "approval.decision.reject")).toBe("Recusar");
  });

  it("o estado de espera do RunStep é o mesmo texto do estado de Run", () => {
    for (const theme of themes) {
      expect(t(theme, "runStep.status.waitingApproval")).toBe(
        t(theme, "run.status.waitingApproval"),
      );
    }
  });

  it("o motivo de pulo não é tematizado", () => {
    for (const key of [
      "runStep.skip.predicateFalse",
      "runStep.skip.dependencyNotSucceeded",
    ] as const) {
      expect(t("dnd", key)).toBe(t("plain", key));
    }
  });

  it("o aviso de decisão perdida traz o placeholder do estado", () => {
    for (const theme of themes) {
      expect(placeholdersOf(t(theme, "approval.conflict"))).toEqual(["status"]);
    }
  });
});
