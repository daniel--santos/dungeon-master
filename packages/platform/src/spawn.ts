/**
 * Criação de processo sem shell, com ambiente por allow-list.
 *
 * Duas regras do projeto moram aqui (CLAUDE.md, seção 8; documento técnico,
 * seções 14 e 14.1):
 *
 * 1. **Nunca `shell: true`, nunca comando montado por concatenação.** Argumento
 *    é elemento de array. Com shell, um argumento com `&`, `|`, `$(...)` ou
 *    aspas vira comando, e o texto vem de Task, Loadout e resultado de agente.
 * 2. **Ambiente é allow-list.** Só as chaves declaradas chegam ao filho; o
 *    resto de `process.env` fica de fora. É o mesmo mecanismo do Sandcastle,
 *    montado por nós para não depender dele.
 */

import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";

import { normalizeAbsolutePath } from "./path-validation.js";

export interface SpawnDetachedOptions {
  /** Working directory do filho. Precisa ser absoluto. */
  cwd: string;
  /**
   * Ambiente completo do filho, normalmente vindo de {@link buildEnv}. O tipo
   * é fechado de propósito: passar `process.env` aqui não compila, e é isso que
   * mantém a allow-list obrigatória.
   */
  env: Record<string, string>;
  /** Padrão `"pipe"`. */
  stdio?: StdioOptions;
}

export interface DetachedProcess {
  child: ChildProcess;
  /** Sempre definido: `spawnDetached` lança quando o processo não nasce. */
  pid: number;
}

/**
 * Sobe um processo filho sem shell, pronto para ser morto em árvore.
 *
 * No POSIX o filho nasce com `detached: true`, o que faz dele líder do próprio
 * grupo de processos; é essa liderança que permite a
 * `terminateProcessTree` alcançar netos e bisnetos com um `kill(-pid)`. No
 * Windows não há grupo equivalente e `detached` só serviria para abrir um
 * console novo, então fica desligado e `windowsHide: true` evita a janela; quem
 * anda a árvore lá é o `taskkill /T`.
 *
 * O filho **não** é `unref`ado: quem chamou decide se espera a saída ou solta o
 * processo.
 */
export function spawnDetached(
  command: string,
  args: readonly string[],
  options: SpawnDetachedOptions,
): DetachedProcess {
  if (typeof command !== "string" || command.length === 0) {
    throw new Error(`command precisa ser uma string não vazia; recebi ${JSON.stringify(command)}.`);
  }
  assertNoNulByte(command, "command");
  if (!Array.isArray(args)) {
    throw new Error(`args precisa ser um array de strings; recebi ${JSON.stringify(args)}.`);
  }
  args.forEach((arg, index) => {
    const name = `args[${String(index)}]`;
    if (typeof arg !== "string") {
      throw new Error(`${name} precisa ser uma string; recebi ${JSON.stringify(arg)}.`);
    }
    // Argumento vazio é legítimo (`--flag=`, por exemplo) e chega vazio ao
    // filho; byte nulo, não: ele corta a string no meio no `execve` e na
    // `CreateProcess`.
    assertNoNulByte(arg, name);
  });

  const cwd = normalizeAbsolutePath(options.cwd);
  const env = assertEnv(options.env);

  const child = spawn(command, [...args], {
    cwd,
    env,
    stdio: options.stdio ?? "pipe",
    shell: false,
    detached: process.platform !== "win32",
    windowsHide: true,
    // Explícito porque o default vale ouro: com `true`, o Node passaria a linha
    // de comando crua para o Windows e a montagem de aspas voltaria a ser
    // problema nosso.
    windowsVerbatimArguments: false,
  });

  if (child.pid === undefined) {
    // Falha síncrona (`ENOENT`, por exemplo) chega como evento `error`. Sem um
    // ouvinte, ele viraria exceção não tratada depois de já termos lançado.
    child.on("error", () => {});
    throw new Error(`Não consegui iniciar ${JSON.stringify(command)} em ${JSON.stringify(cwd)}.`);
  }

  return { child, pid: child.pid };
}

/**
 * Monta o ambiente do filho **só** com as chaves permitidas.
 *
 * `allowList` filtra o que vaza do ambiente do worker; `extra` é o que quem
 * chamou injeta de propósito e por isso não precisa estar na allow-list. `extra`
 * ganha de `allowList` quando a chave aparece nos dois.
 *
 * No Windows as variáveis de ambiente são case-insensitive, então a busca e a
 * deduplicação também são: pedir `Path` e `PATH` produz uma entrada só, com a
 * grafia da primeira ocorrência.
 */
export function buildEnv(
  allowList: Iterable<string>,
  extra: Readonly<Record<string, string>> = {},
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const caseInsensitive = process.platform === "win32";
  const fold = (key: string): string => (caseInsensitive ? key.toLowerCase() : key);

  // `process.env` no Windows já busca sem diferenciar caixa, mas um objeto
  // qualquer passado em `source` não. O índice deixa os dois iguais.
  const index = new Map<string, string>();
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && !index.has(fold(key))) index.set(fold(key), value);
  }

  const result: Record<string, string> = {};
  const taken = new Set<string>();

  for (const key of allowList) {
    assertEnvKey(key);
    const folded = fold(key);
    if (taken.has(folded)) continue;
    const value = index.get(folded);
    if (value === undefined) continue;
    taken.add(folded);
    result[key] = value;
  }

  for (const [key, value] of Object.entries(extra)) {
    assertEnvKey(key);
    assertEnvValue(key, value);
    const folded = fold(key);
    if (taken.has(folded)) {
      // Já entrou pela allow-list, possivelmente com outra grafia. Remove a
      // grafia antiga para não mandar a mesma variável duas vezes.
      for (const existing of Object.keys(result)) {
        if (fold(existing) === folded) delete result[existing];
      }
    }
    taken.add(folded);
    result[key] = value;
  }

  return result;
}

/**
 * As variáveis sem as quais um processo mal sobe no SO atual.
 *
 * Não é uma allow-list pronta: é o piso que a allow-list de um Loadout deveria
 * incluir. No Windows, faltar `SystemRoot` quebra desde resolução de DNS até
 * carga de DLL; no POSIX, faltar `PATH` quebra a busca do executável.
 */
export function essentialEnvKeys(platform: NodeJS.Platform = process.platform): readonly string[] {
  return platform === "win32"
    ? ["SystemRoot", "windir", "TEMP", "TMP", "PATH", "PATHEXT", "COMSPEC", "NUMBER_OF_PROCESSORS"]
    : ["PATH", "HOME", "TMPDIR", "LANG", "SHELL", "USER"];
}

function assertNoNulByte(value: string, name: string): void {
  if (value.includes("\0")) {
    throw new Error(`${name} não pode conter byte nulo.`);
  }
}

function assertEnvKey(key: string): void {
  if (key.length === 0 || key.includes("=") || key.includes("\0")) {
    throw new Error(
      `Nome de variável de ambiente inválido: ${JSON.stringify(key)}. Não pode ser vazio nem conter '=' ou byte nulo.`,
    );
  }
}

function assertEnvValue(key: string, value: string): void {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new Error(
      `Valor de ${JSON.stringify(key)} precisa ser uma string sem byte nulo; recebi ${JSON.stringify(value)}.`,
    );
  }
}

function assertEnv(env: Record<string, string>): Record<string, string> {
  if (typeof env !== "object" || env === null) {
    throw new Error(`env precisa ser um objeto de strings; recebi ${JSON.stringify(env)}.`);
  }
  for (const [key, value] of Object.entries(env)) {
    assertEnvKey(key);
    assertEnvValue(key, value);
  }
  return { ...env };
}
