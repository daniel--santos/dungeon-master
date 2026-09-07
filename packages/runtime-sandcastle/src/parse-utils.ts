/**
 * Utilidades comuns aos três parsers de NDJSON.
 *
 * Todo parser aqui é uma função pura de `string` para lista de sinais: sem
 * relógio, sem estado, sem I/O. É o que permite testá-los com uma linha
 * capturada da CLI real e detectar uma mudança de formato sem subir processo.
 */

/** Uma linha de NDJSON, ou `undefined` quando não é um objeto JSON. */
export function parseJsonObject(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    // Uma CLI pode escrever qualquer coisa no stdout — banner, aviso, progresso.
    // Linha que não é JSON não é evento.
    return undefined;
  }
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Campo de cada ferramenta que vale a pena mostrar na timeline.
 *
 * Sem esta tabela, um `ToolCall` de `Edit` mostraria o arquivo inteiro no
 * evento. O Sandcastle tem uma tabela parecida, mas ela é uma **allow-list**: o
 * que não está nela é descartado, e chamada de ferramenta some do stream. Aqui
 * ela é só a escolha do campo em destaque; o que não está na tabela cai no JSON
 * dos argumentos, truncado.
 *
 * Os nomes vêm em duas caixas de propósito: o Claude usa `Bash`, o Pi usa
 * `bash`, e uma tabela só com a versão capitalizada descartaria tudo do Pi.
 */
const TOOL_HIGHLIGHT_FIELDS: Record<string, readonly string[]> = {
  bash: ["command"],
  shell: ["command"],
  read: ["file_path", "path"],
  write: ["file_path", "path"],
  edit: ["file_path", "path"],
  glob: ["pattern"],
  grep: ["pattern"],
  websearch: ["query"],
  webfetch: ["url"],
  task: ["description"],
  agent: ["description"],
  todowrite: ["description"],
};

/** Descreve os argumentos de uma ferramenta em uma linha legível. */
export function describeToolInput(toolName: string, input: unknown): string {
  const record = asRecord(input);
  if (record === undefined) return typeof input === "string" ? input : "";

  for (const field of TOOL_HIGHLIGHT_FIELDS[toolName.toLowerCase()] ?? []) {
    const value = record[field];
    if (typeof value === "string" && value.length > 0) return value;
  }

  try {
    return JSON.stringify(record);
  } catch {
    return "";
  }
}

/**
 * Achata o conteúdo de um resultado de ferramenta em texto.
 *
 * Os três harnesses representam isso de jeitos diferentes: string pura (Claude,
 * às vezes), lista de blocos `{type,text}` (Claude e Pi) ou campo próprio
 * (Codex). Um único achatador evita três variações do mesmo `for`.
 */
export function flattenContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        const record = asRecord(entry);
        if (record === undefined) return typeof entry === "string" ? entry : "";
        return asString(record["text"]) ?? "";
      })
      .filter((text) => text.length > 0)
      .join("\n");
  }
  const record = asRecord(value);
  if (record !== undefined) {
    const content = record["content"];
    if (content !== undefined) return flattenContent(content);
    return asString(record["text"]) ?? "";
  }
  return "";
}
