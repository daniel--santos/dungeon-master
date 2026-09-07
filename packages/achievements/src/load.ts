import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { z } from "zod";

import { ConditionSchema, type Condition } from "./condition.js";
import {
  AchievementDefinitionSchema,
  AchievementTemplateSchema,
  type AchievementDefinition,
  type AchievementTemplate,
} from "./definition.js";

/**
 * Carga do catálogo versionado (planejamento v0.4, Fase 2.5A).
 *
 * Contrato de fail-closed: nada aqui lança. Uma definição que não passa no
 * schema fica fora do resultado e aparece em `invalid`, com a chave e o erro,
 * para o chamador logar. Arquivo ausente, JSON quebrado ou raiz que não é lista
 * também viram `invalid`, nunca exceção. Conquistas são cosméticas: uma entrada
 * torta não pode derrubar o boot.
 */

/** Versão do catálogo carregada por padrão. Mudar limiar é nova versão, não código. */
export const CATALOG_VERSION = "v1";

/** Um problema de validação, já achatado para log. */
export interface SchemaIssue {
  /** Caminho do campo, com pontos. Vazio quando o problema é da raiz. */
  readonly path: string;
  readonly message: string;
}

/** Uma entrada recusada, com o suficiente para achá-la no arquivo. */
export interface InvalidEntry {
  /** A chave, quando legível; `null` quando nem isso deu para ler. */
  readonly key: string | null;
  /** Posição da entrada na lista; `null` quando o arquivo inteiro falhou. */
  readonly index: number | null;
  readonly error: string;
  readonly issues: readonly SchemaIssue[];
}

/** O que sobrou de um arquivo de catálogo, e o que ficou de fora. */
export interface LoadResult<T> {
  readonly valid: readonly T[];
  readonly invalid: readonly InvalidEntry[];
}

/** De onde ler. Sem `file`, lê o catálogo versionado que acompanha o pacote. */
export interface LoadOptions {
  readonly file?: string;
}

/** Resultado de uma validação avulsa, no mesmo espírito fail-closed. */
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string; readonly issues: readonly SchemaIssue[] };

function dataFile(name: string): string {
  return fileURLToPath(new URL(`../catalog/${CATALOG_VERSION}/${name}`, import.meta.url));
}

/** Caminho do arquivo do catálogo fixo desta versão. */
export function catalogFile(): string {
  return dataFile("catalog.json");
}

/** Caminho do arquivo de templates desta versão. */
export function templatesFile(): string {
  return dataFile("templates.json");
}

function toIssues(error: z.ZodError): SchemaIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join("."),
    message: issue.message,
  }));
}

function summarize(issues: readonly SchemaIssue[]): string {
  const first = issues[0];
  if (first === undefined) return "Entrada inválida.";
  const where = first.path === "" ? "" : `${first.path}: `;
  const rest = issues.length > 1 ? ` (+${String(issues.length - 1)} problema(s))` : "";
  return `${where}${first.message}${rest}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readKey(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null) return null;
  const key: unknown = (entry as { key?: unknown }).key;
  return typeof key === "string" && key !== "" ? key : null;
}

function fileFailure(error: string): LoadResult<never> {
  return { valid: [], invalid: [{ key: null, index: null, error, issues: [] }] };
}

function loadEntries<S extends z.ZodType>(file: string, schema: S): LoadResult<z.infer<S>> {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    return fileFailure(`Não foi possível ler ${file}: ${messageOf(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return fileFailure(`JSON inválido em ${file}: ${messageOf(error)}`);
  }

  if (!Array.isArray(parsed)) {
    return fileFailure(`${file} precisa conter uma lista de definições.`);
  }

  const valid: z.infer<S>[] = [];
  const invalid: InvalidEntry[] = [];
  const seen = new Set<string>();

  for (const [index, entry] of parsed.entries()) {
    const key = readKey(entry);
    const result = schema.safeParse(entry);

    if (!result.success) {
      const issues = toIssues(result.error);
      invalid.push({ key, index, error: summarize(issues), issues });
      continue;
    }

    if (key !== null && seen.has(key)) {
      invalid.push({
        key,
        index,
        error: `Chave repetida no arquivo: ${key}.`,
        issues: [{ path: "key", message: "Chave repetida." }],
      });
      continue;
    }

    if (key !== null) seen.add(key);
    valid.push(result.data as z.infer<S>);
  }

  return { valid, invalid };
}

/** Lê e valida o catálogo fixo. Nunca lança. */
export function loadCatalog(options: LoadOptions = {}): LoadResult<AchievementDefinition> {
  return loadEntries(options.file ?? catalogFile(), AchievementDefinitionSchema);
}

/** Lê e valida os templates. Nunca lança. */
export function loadTemplates(options: LoadOptions = {}): LoadResult<AchievementTemplate> {
  return loadEntries(options.file ?? templatesFile(), AchievementTemplateSchema);
}

function parseWith<S extends z.ZodType>(schema: S, input: unknown): ParseResult<z.infer<S>> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data as z.infer<S> };
  const issues = toIssues(result.error);
  return { ok: false, error: summarize(issues), issues };
}

/** Valida uma condição avulsa. Mesmo contrato: predicado desconhecido não passa, e não lança. */
export function parseCondition(input: unknown): ParseResult<Condition> {
  return parseWith(ConditionSchema, input);
}

/** Valida uma definição avulsa, para uma forjada ou um template já instanciado. */
export function parseDefinition(input: unknown): ParseResult<AchievementDefinition> {
  return parseWith(AchievementDefinitionSchema, input);
}

/** Valida um template avulso. */
export function parseTemplate(input: unknown): ParseResult<AchievementTemplate> {
  return parseWith(AchievementTemplateSchema, input);
}
