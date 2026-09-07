// Adapted from Archon — packages/core/src/utils/path-validation.ts@0773b97
// Copyright (c) 2026 Cole Medin. Licensed under the MIT License.
// Changes: a raiz permitida deixou de vir de `@archon/paths` e virou o primeiro
// argumento, porque aqui a restrição é por working directory de Run, não por um
// diretório global. `isPathWithinWorkspace` virou `isPathWithinRoot`. A
// comparação passou a ser case-insensitive no Windows e no macOS, onde o
// sistema de arquivos é case-insensitive por padrão e comparar por byte
// rejeitaria caminhos legítimos. Acrescentados `normalizeAbsolutePath` e
// `isInside`. Mensagens em português.

import { isAbsolute, parse, resolve, sep } from "node:path";

/**
 * Sistemas de arquivos case-insensitive por padrão (documento técnico, 14.1).
 *
 * Comparar caminhos por byte nos dois faria `C:\Runs` e `c:\runs` parecerem
 * diretórios diferentes, e a restrição de working directory rejeitaria caminhos
 * que o sistema resolve para o mesmo lugar. No Linux a comparação é por byte.
 */
const CASE_INSENSITIVE_FS = process.platform === "win32" || process.platform === "darwin";

/**
 * Resolve `candidate` para um caminho absoluto canônico do SO atual.
 *
 * Normaliza os separadores para o do sistema, colapsa `.` e `..` e remove o
 * separador final. **Não toca no disco**: não resolve symlink nem exige que o
 * caminho exista, porque a normalização acontece na borda, antes de o diretório
 * existir.
 *
 * Rejeita caminho relativo, string vazia, byte nulo e qualquer `..` que
 * sobreviva à normalização. Um caminho relativo não é resolvido contra o
 * `cwd`: o `cwd` do worker não é um dado do domínio, e deixar a resolução
 * implícita esconderia o erro de quem chamou.
 */
export function normalizeAbsolutePath(candidate: string): string {
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error(
      `Caminho precisa ser uma string não vazia; recebi ${JSON.stringify(candidate)}.`,
    );
  }
  if (candidate.includes("\0")) {
    throw new Error("Caminho não pode conter byte nulo.");
  }
  if (!isAbsolute(candidate)) {
    throw new Error(`Caminho precisa ser absoluto; recebi ${JSON.stringify(candidate)}.`);
  }

  const normalized = resolve(candidate);

  // Cinto e suspensório: `resolve` colapsa `..` em toda entrada absoluta que o
  // Node reconhece. Um `..` que sobreviva significa uma forma que a
  // normalização não entendeu, e caminho que a gente não entende não passa.
  if (hasDotDotSegment(normalized)) {
    throw new Error(`Caminho ainda tem '..' depois de normalizado: ${JSON.stringify(normalized)}.`);
  }
  return normalized;
}

/**
 * `child` está dentro de `parent`, ou é o próprio `parent`?
 *
 * O próprio diretório conta como dentro, que é o que a restrição de working
 * directory precisa: rodar na raiz do worktree é legítimo.
 *
 * Compara caminhos normalizados e exige que a fronteira caia em um separador,
 * então `C:\runs-outros` **não** está dentro de `C:\runs`.
 */
export function isInside(parent: string, child: string): boolean {
  const parentPath = normalizeAbsolutePath(parent);
  const childPath = normalizeAbsolutePath(child);
  if (samePath(parentPath, childPath)) return true;

  // A raiz (`C:\`, `/`) já termina em separador; qualquer outro caminho
  // normalizado, não.
  const prefix = parentPath.endsWith(sep) ? parentPath : parentPath + sep;
  return foldCase(childPath).startsWith(foldCase(prefix));
}

/** Os dois caminhos apontam para o mesmo lugar, pelas regras do SO atual? */
export function samePath(left: string, right: string): boolean {
  return foldCase(normalizeAbsolutePath(left)) === foldCase(normalizeAbsolutePath(right));
}

/**
 * `targetPath` fica dentro de `root`?
 *
 * `targetPath` pode ser absoluto ou relativo; se for relativo, é resolvido
 * contra `basePath`, ou contra `root` quando `basePath` não é passado. Fecha
 * travessia por `../`, que some na resolução antes da comparação.
 */
export function isPathWithinRoot(root: string, targetPath: string, basePath?: string): boolean {
  return isInside(root, resolveAgainst(root, targetPath, basePath));
}

/**
 * Valida `targetPath` e devolve o caminho absoluto resolvido.
 *
 * @throws se o caminho escapar de `root`.
 */
export function validateAndResolvePath(
  root: string,
  targetPath: string,
  basePath?: string,
): string {
  const resolved = resolveAgainst(root, targetPath, basePath);
  if (!isInside(root, resolved)) {
    throw new Error(
      `Caminho precisa estar dentro de ${normalizeAbsolutePath(root)}; recebi ${JSON.stringify(resolved)}.`,
    );
  }
  return resolved;
}

function resolveAgainst(root: string, targetPath: string, basePath: string | undefined): string {
  if (typeof targetPath !== "string" || targetPath.length === 0) {
    throw new Error(
      `Caminho precisa ser uma string não vazia; recebi ${JSON.stringify(targetPath)}.`,
    );
  }
  if (targetPath.includes("\0")) {
    throw new Error("Caminho não pode conter byte nulo.");
  }
  const base = normalizeAbsolutePath(basePath ?? root);
  return resolve(base, targetPath);
}

function foldCase(value: string): string {
  // `toLowerCase` e não `toLocaleLowerCase`: o dobramento por locale muda o
  // resultado no turco ('I' vira 'ı') e o caminho passaria a depender da
  // configuração da máquina.
  return CASE_INSENSITIVE_FS ? value.toLowerCase() : value;
}

function hasDotDotSegment(normalized: string): boolean {
  const { root } = parse(normalized);
  return normalized.slice(root.length).split(sep).includes("..");
}
