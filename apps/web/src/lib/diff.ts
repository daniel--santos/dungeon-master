/**
 * Um diff de linhas, sem dependência: o suficiente para comparar duas versões
 * de uma Skill (Fase 8C).
 *
 * É a subsequência comum mais longa (LCS) por programação dinâmica, `O(n·m)`
 * em tempo e memória. O texto de uma Skill tem centenas de linhas, não
 * dezenas de milhares, e um algoritmo que se lê inteiro vale mais aqui do
 * que um pacote pinado para a mesma coisa. Linhas iguais saem uma vez; o
 * que existe só na origem sai como removido e o que existe só no destino,
 * como acrescentado, na ordem em que aparecem.
 */

export type DiffKind = "same" | "added" | "removed";

export interface DiffLine {
  readonly kind: DiffKind;
  readonly text: string;
  /** Número da linha na origem (1-based), ou `null` numa linha acrescentada. */
  readonly from: number | null;
  /** Número da linha no destino (1-based), ou `null` numa linha removida. */
  readonly to: number | null;
}

export interface DiffSummary {
  readonly added: number;
  readonly removed: number;
}

/** Quebra o texto em linhas; um texto vazio é zero linhas, não uma linha vazia. */
export function splitLines(text: string): readonly string[] {
  if (text === "") return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

export function diffLines(before: string, after: string): readonly DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const n = a.length;
  const m = b.length;

  // `table[i][j]` é o tamanho da LCS de `a[i..]` e `b[j..]`.
  const table: Uint32Array[] = [];
  for (let i = 0; i <= n; i += 1) table.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = table[i]!;
    const next = table[i + 1]!;
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i]!, from: i + 1, to: j + 1 });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push({ kind: "removed", text: a[i]!, from: i + 1, to: null });
      i += 1;
    } else {
      lines.push({ kind: "added", text: b[j]!, from: null, to: j + 1 });
      j += 1;
    }
  }
  while (i < n) {
    lines.push({ kind: "removed", text: a[i]!, from: i + 1, to: null });
    i += 1;
  }
  while (j < m) {
    lines.push({ kind: "added", text: b[j]!, from: null, to: j + 1 });
    j += 1;
  }
  return lines;
}

export function summarizeDiff(lines: readonly DiffLine[]): DiffSummary {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "added") added += 1;
    else if (line.kind === "removed") removed += 1;
  }
  return { added, removed };
}
