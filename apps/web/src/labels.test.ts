import { GLOSSARIES, GLOSSARY_KEYS, THEME_IDS } from "@dungeon-master/glossary";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A garantia da seção 2 do CLAUDE.md, aplicada por teste.
 *
 * Nenhum componente escreve um label de entidade no JSX: ele vem do glossário
 * ativo, por `useGlossary`. Esta varredura lê todo `src` e falha se qualquer
 * valor dos glossários aparecer literalmente no código, em JSX ou em string.
 *
 * `src/lib/glossary.ts` é a fronteira e está fora da varredura, junto da árvore
 * de rotas gerada e dos próprios testes.
 *
 * `src/lib/api-types.ts` é a segunda fronteira, e existe porque dois nomes
 * canônicos do contrato — `Loadout` e `Harness` — são letra por letra os labels
 * do glossário `plain`. A varredura não distingue uma chave de tipo de um
 * label renderizado, então os apelidos ficam todos naquele arquivo e o resto de
 * `src` continua sob a regra estrita.
 */

const SRC = import.meta.dirname;

/** Os grupos de chaves em que um label escrito à mão é erro. */
const SCANNED_PREFIXES = [
  "nav.",
  "entity.",
  "hall.",
  "run.status.",
  "env.",
  "task.status.",
  "task.priority.",
  // Fase 4C: os estados de RunStep e todo o vocabulário do Selo — decisões,
  // estados do gate, títulos e textos dos diálogos. `workflowStep.type.` fica
  // de fora de propósito: "Comando" e "Validação" são palavras comuns que já
  // aparecem como rótulo de campo em telas que nada têm a ver com Workflow.
  "runStep.status.",
  "approval.",
  // Fase 5B: o vocabulário da proposta de trabalho e do Mapa da Campanha —
  // estados, decisões, títulos e textos dos diálogos, legenda e motivos.
  "proposal.",
  "graph.",
  // Fase 6B: o Grimório (tipos, estados, fila, decisões, resumo, lotes,
  // candidatos, proveniência), a forja e o bloco do Grimório em Settings.
  "knowledge.",
  "forged.",
  "settings.knowledge.",
  // Fase 7C: as provisões da Expedição (estados, seções, motivos, orçamento,
  // texto, links de origem, o destaque das consultas ao Grimório), a política
  // de contexto do Loadout e o bloco das provisões em Settings.
  "context.",
  "loadout.policy.",
  "settings.context.",
  // Fase 8C: o Arsenal — Habilidades, Itens, Relíquias e Patronatos —, o
  // Equipamento por referência (pin, compatibilidade, histórico, restauração),
  // o preflight da partida, o Equipamento congelado no cockpit e a moldura do
  // capability matching. `tool.` fica de fora porque "Argumentos" e "Comando"
  // são rótulos de campo comuns; os títulos e diálogos de Item entram por
  // `tool.create.`, `tool.edit.`, `tool.delete.` e `tool.kind.`.
  "registry.",
  "skill.",
  "tool.kind.",
  "tool.create.",
  "tool.edit.",
  "tool.delete.",
  "mcpServer.",
  "provider.",
  "loadout.pin.",
  "loadout.compat.",
  "loadout.history.",
  "loadout.change.",
  "loadout.restore.",
  "run.preflight.",
  "run.frozen.",
  "capability.",
] as const;

/**
 * Chaves fora da varredura mesmo dentro de um prefixo varrido.
 *
 * `knowledge.filter.type` é "Tipo" nos dois temas: uma palavra comum que já é
 * rótulo de campo nos diálogos de Task, de Project e de proposta, fora de
 * qualquer contexto de Grimório — o mesmo motivo que deixa `workflowStep.type.`
 * de fora. As outras chaves de filtro continuam varridas.
 */
// `context.items` é "{n} itens" nos dois temas: o mesmo contador que o Quadro
// de Missões já escreve à mão para o que não é entidade.
// Fase 8C: os estados curtos da CLI e do container ("instalada", "Daemon",
// "sem credencial"), o verbo "Verificar de novo" e o cabeçalho "Avisos" são
// palavras que Settings e o painel de resultado já escrevem à mão, fora de
// qualquer contexto de Equipamento; "Nenhuma" é o vazio de qualquer lista.
const SKIPPED_KEYS = new Set<string>([
  "knowledge.filter.type",
  "context.items",
  "context.items.one",
  "loadout.compat.cli.installed",
  "loadout.compat.cli.notInstalled",
  "loadout.compat.cli.timedOut",
  "loadout.compat.cli.authenticated",
  "loadout.compat.cli.notAuthenticated",
  "loadout.compat.container.daemon",
  "loadout.compat.container.image",
  "loadout.compat.check",
  "loadout.compat.warnings",
  "run.frozen.none",
]);

const EXEMPT_FILES = new Set(["lib/glossary.ts", "lib/api-types.ts", "routeTree.gen.ts"]);

const SCANNED_KEYS = GLOSSARY_KEYS.filter(
  (key) => !SKIPPED_KEYS.has(key) && SCANNED_PREFIXES.some((prefix) => key.startsWith(prefix)),
);

/** Todo texto que os dois glossários produzem para essas chaves, sem repetição. */
const FORBIDDEN: readonly string[] = [
  ...new Set(THEME_IDS.flatMap((theme) => SCANNED_KEYS.map((key) => GLOSSARIES[theme][key]))),
].sort((a, b) => b.length - a.length);

/**
 * Apaga comentários, preservando strings e templates.
 *
 * Comentário é prosa sobre o domínio e cita "Campanha" e "Missão" o tempo
 * todo; o que a regra proíbe é o texto chegar à tela. As aspas são
 * acompanhadas justamente para que `https://` dentro de uma string não seja
 * confundido com um comentário de linha.
 */
export function stripComments(source: string): string {
  let out = "";
  let quote: string | null = null;
  let i = 0;

  while (i < source.length) {
    const char = source[i] ?? "";
    const next = source[i + 1];

    if (quote !== null) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      out += char;
      i += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
}

const WORD = /[\p{L}\p{N}_]/u;

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && WORD.test(char);
}

/**
 * `true` se o texto contém o label como palavra inteira.
 *
 * A comparação distingue maiúsculas de minúsculas de propósito: "Você" é o
 * label do usuário sem tema, e "você" no meio de uma frase é só um pronome.
 *
 * Um ponto imediatamente antes é acesso a membro, não texto: `Primitive.Item`
 * é o componente do Radix, e não o label de Tool no tema.
 */
export function mentions(text: string, label: string): boolean {
  let at = text.indexOf(label);
  while (at !== -1) {
    const before = text[at - 1];
    const after = text[at + label.length];
    if (!isWordChar(before) && before !== "." && !isWordChar(after)) return true;
    at = text.indexOf(label, at + 1);
  }
  return false;
}

function scannedFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      scannedFiles(full, found);
      continue;
    }

    if (extname(entry.name) !== ".ts" && extname(entry.name) !== ".tsx") continue;

    const rel = relative(SRC, full).split(sep).join("/");
    if (EXEMPT_FILES.has(rel)) continue;
    if (/\.test\.tsx?$/.test(rel)) continue;

    found.push(full);
  }
  return found;
}

describe("nenhum label de entidade escrito à mão", () => {
  it("varre src inteiro sem encontrar um só", () => {
    const offenses: string[] = [];

    for (const file of scannedFiles(SRC)) {
      const code = stripComments(readFileSync(file, "utf8"));
      const rel = relative(SRC, file).split(sep).join("/");
      for (const label of FORBIDDEN) {
        if (mentions(code, label)) offenses.push(`${rel}: ${JSON.stringify(label)}`);
      }
    }

    expect(offenses).toEqual([]);
  });

  it("a varredura de fato enxerga um label escrito à mão", () => {
    expect(mentions(stripComments("const x = <span>Campanhas</span>;"), "Campanhas")).toBe(true);
    expect(mentions(stripComments('const x = "Hall dos Heróis";'), "Hall dos Heróis")).toBe(true);
  });

  it("não confunde comentário, prefixo de palavra nem caixa diferente", () => {
    expect(mentions(stripComments("// fala de Campanhas\nconst x = 1;"), "Campanhas")).toBe(false);
    expect(mentions(stripComments("/* Campanhas */ const x = 1;"), "Campanhas")).toBe(false);
    expect(mentions(stripComments("const Campanhasinha = 1;"), "Campanhas")).toBe(false);
    expect(mentions(stripComments('const x = "campanhas";'), "Campanhas")).toBe(false);
    expect(mentions(stripComments('const u = "https://x/y";'), "Campanhas")).toBe(false);
    expect(mentions(stripComments("<Primitive.Item />"), "Item")).toBe(false);
    expect(mentions(stripComments("<span>Item</span>"), "Item")).toBe(true);
  });

  it("cobre os dezessete grupos de chaves que a regra exige", () => {
    for (const prefix of SCANNED_PREFIXES) {
      expect(
        SCANNED_KEYS.some((key) => key.startsWith(prefix)),
        prefix,
      ).toBe(true);
    }

    for (const label of [
      "Missões",
      "Tarefas",
      "Campanhas",
      "Concluída",
      "Urgente",
      "Você",
      "Conceder o Selo",
      "Aprovar",
      "Pulado",
      "Pistas",
      "Tarefas propostas",
      "Seguir a Pista",
      "Mãe e filha",
      "Escriba do Grimório",
      "Selar a Página",
      "Na forja",
      "Pendurar no Hall",
      "Equipamento do Escriba",
      "Provisões da Expedição",
      "Contexto entregue",
      "Ainda não arrumadas",
      "Ficou de fora",
      "Levar os Decretos",
      "Arrumar as provisões",
    ]) {
      expect(FORBIDDEN, label).toContain(label);
    }
  });
});
