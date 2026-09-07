/**
 * Encontrar o executável de uma CLI de agente, sem shell.
 *
 * Isto existe por causa de um detalhe do Windows que decide a arquitetura toda.
 * As CLIs de agente chegam de três formas:
 *
 * - binário nativo (`claude.exe`), que o `spawn` resolve;
 * - shim `.cmd` do npm (`codex.cmd`, `pi.cmd`), que o `spawn` **não** resolve
 *   sem `shell: true` — desde a correção do CVE-2024-27980 o Node recusa
 *   executar `.cmd` e `.bat` sem shell;
 * - script `sh` do npm no POSIX, que é executável comum.
 *
 * Ligar `shell: true` está fora de questão: o prompt de um agente contém `&`,
 * `|`, `$(...)` e aspas, e com shell isso vira comando (CLAUDE.md, seção 8). O
 * Sandcastle escolhe o outro caminho — monta uma linha de comando por
 * concatenação e a entrega a `sh -c` / `cmd.exe /c` — e paga o preço em
 * escaping (o `shellEscape` dele usa aspas simples, que o `cmd.exe` não
 * reconhece como aspas).
 *
 * A saída daqui é a terceira via: ler o shim `.cmd`, achar o script `.js` que
 * ele invoca, e subir `node <script.js>` direto, com argumentos em array. O
 * `node` é o `process.execPath` do worker, então não depende do PATH.
 *
 * A detecção de CLI instalada mora no adapter, e não em `packages/platform`,
 * por decisão de partida da Fase 0.
 */

import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";

export type CliResolutionKind = "EXECUTABLE" | "NODE_SCRIPT";

export interface ResolvedCli {
  /** O que passar para o `spawn`. */
  readonly command: string;
  /** Argumentos que vêm antes dos da CLI (o caminho do script, por exemplo). */
  readonly argsPrefix: readonly string[];
  /** O que foi achado no PATH, para o log e para a mensagem de erro. */
  readonly resolvedPath: string;
  readonly kind: CliResolutionKind;
}

export interface ResolveCliOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  /** Node usado para rodar um script `.js`. Padrão: `process.execPath`. */
  readonly nodePath?: string;
}

/** Motivo pelo qual uma CLI encontrada no PATH não pôde ser usada. */
export class CliResolutionError extends Error {
  readonly resolvedPath: string;

  constructor(message: string, resolvedPath: string) {
    super(message);
    this.name = "CliResolutionError";
    this.resolvedPath = resolvedPath;
  }
}

/**
 * Resolve `name` para algo que o `spawn` aceita sem shell.
 *
 * Devolve `undefined` quando a CLI não está no PATH — que é informação de
 * preflight, e não erro. Lança {@link CliResolutionError} quando a CLI existe
 * mas não dá para executá-la sem shell: esconder isso atrás de "não instalado"
 * mandaria o usuário instalar o que já está instalado.
 */
export async function resolveCli(
  name: string,
  options: ResolveCliOptions = {},
): Promise<ResolvedCli | undefined> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const nodePath = options.nodePath ?? process.execPath;

  const candidate = isAbsolute(name) ? name : await searchPath(name, env, platform);
  if (candidate === undefined) return undefined;
  if (isAbsolute(name) && !(await isFile(candidate))) return undefined;

  const extension = extname(candidate).toLowerCase();

  if (platform === "win32" && (extension === ".cmd" || extension === ".bat")) {
    const script = await readNodeScriptFromShim(candidate);
    if (script === undefined) {
      throw new CliResolutionError(
        `Encontrei ${candidate}, mas não consegui descobrir o script Node que ele executa. ` +
          "O Node recusa executar `.cmd` sem shell, e este projeto não usa shell. " +
          "Instale a CLI como binário nativo ou informe o caminho do executável.",
        candidate,
      );
    }
    return {
      command: nodePath,
      argsPrefix: [script],
      resolvedPath: candidate,
      kind: "NODE_SCRIPT",
    };
  }

  if (platform === "win32" && extension === ".ps1") {
    throw new CliResolutionError(
      `Encontrei apenas o shim PowerShell ${candidate}. Ele exige um shell, que este projeto não usa.`,
      candidate,
    );
  }

  return { command: candidate, argsPrefix: [], resolvedPath: candidate, kind: "EXECUTABLE" };
}

/**
 * Procura `name` nos diretórios do PATH.
 *
 * No Windows a busca respeita o `PATHEXT`, e o nome nu vem primeiro para o caso
 * de já ser um executável com extensão. No POSIX o candidato precisa ter o bit
 * de execução: um arquivo de mesmo nome sem `+x` não é a CLI.
 */
async function searchPath(
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  const pathValue = readEnv(env, "PATH", platform) ?? "";
  const dirs = pathValue.split(delimiter).filter((dir) => dir.length > 0);

  const windows = platform === "win32";
  // No Windows um arquivo sem extensão **não** é executável, e o npm instala os
  // dois lados no mesmo diretório: `pi` (script `sh`, para o Git Bash) e
  // `pi.cmd`. Tentar o nome nu primeiro acharia o script `sh`, e o `spawn`
  // falharia com um erro que não diz nada. As extensões do `PATHEXT` vêm
  // primeiro; o nome nu só entra quando já traz extensão própria.
  const pathextEntries = (readEnv(env, "PATHEXT", platform) ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext.length > 0);
  const extensions = windows
    ? extname(name).length > 0
      ? ["", ...pathextEntries]
      : pathextEntries
    : [""];

  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = resolve(join(dir, name + extension));
      if (windows) {
        if (await isFile(candidate)) return candidate;
      } else if (await isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

/**
 * Extrai o caminho do script `.js` de um shim `.cmd` do npm.
 *
 * O shim gerado pelo npm tem sempre a mesma última linha, com o caminho do
 * script entre aspas e `%dp0%` como o diretório do próprio shim. Ler o arquivo
 * é frágil por natureza, e por isso o resultado é verificado: se o `.js`
 * apontado não existir, a resolução falha em vez de mandar o `node` abrir um
 * arquivo inexistente.
 */
async function readNodeScriptFromShim(shimPath: string): Promise<string | undefined> {
  let content: string;
  try {
    content = await readFile(shimPath, "utf8");
  } catch {
    return undefined;
  }

  const shimDir = dirname(shimPath);
  const matches = content.matchAll(/"([^"]+\.[cm]?js)"/gi);

  for (const match of matches) {
    const raw = match[1];
    if (raw === undefined) continue;
    const expanded = raw
      .replace(/%~?dp0%?/gi, `${shimDir}\\`)
      .replace(/\\\\+/g, "\\")
      .replace(/^"|"$/g, "");
    const candidate = resolve(expanded);
    if (await isFile(candidate)) return candidate;
  }
  return undefined;
}

/** Lê uma variável de ambiente sem depender da caixa no Windows. */
function readEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  platform: NodeJS.Platform,
): string | undefined {
  const direct = env[key];
  if (direct !== undefined) return direct;
  if (platform !== "win32") return undefined;
  const folded = key.toLowerCase();
  for (const [name, value] of Object.entries(env)) {
    if (name.toLowerCase() === folded && value !== undefined) return value;
  }
  return undefined;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
