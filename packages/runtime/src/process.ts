/**
 * Processo filho como sequência de eventos.
 *
 * Todo processo que o runtime sobe passa por aqui, e daqui passa por
 * `spawnDetached` de `@dungeon-master/platform`: sem shell, argumentos em
 * array, ambiente por allow-list, e no POSIX líder do próprio grupo — que é o
 * que torna o `kill(-pid)` capaz de alcançar netos e bisnetos.
 *
 * O PID sai daqui para fora de propósito. É ele que o kill de árvore precisa, e
 * é justamente o que uma biblioteca que só devolve a promessa do resultado não
 * consegue dar (veja o ADR em `packages/runtime-sandcastle/README.md`).
 */

import { createInterface } from "node:readline";

import { spawnDetached, terminateProcessTree } from "@dungeon-master/platform";

import { createAsyncQueue } from "./async-queue.js";
import { BoundedTail, MAX_TAIL_CHARS } from "./bounded-tail.js";

/** Um acontecimento do processo filho, na ordem em que foi observado. */
export type ChildProcessEvent =
  | { readonly kind: "stdout"; readonly line: string }
  | { readonly kind: "stderr"; readonly text: string }
  | {
      readonly kind: "exit";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }
  | { readonly kind: "error"; readonly error: Error };

export interface StartProcessOptions {
  readonly cwd: string;
  readonly env: Record<string, string>;
  /** Escrito no stdin e seguido de `end()`. Sem isto, o stdin é fechado logo. */
  readonly stdin?: string;
}

export interface RunningProcess {
  readonly pid: number;
  readonly events: AsyncIterable<ChildProcessEvent>;
  /**
   * Mata a árvore e confirma o desaparecimento por polling. Nunca lança;
   * `terminated: false` é um resultado válido (documento técnico, seção 13).
   */
  terminate(options?: { graceMs?: number; confirmMs?: number }): Promise<{
    terminated: boolean;
    method: string;
    elapsedMs: number;
  }>;
  /** Resolve quando o processo saiu e a fila de eventos fechou. */
  finished(): Promise<void>;
}

/**
 * Sobe um processo e devolve o PID mais o fluxo de eventos.
 *
 * A fila só fecha depois do `close` do processo, e não do `exit`: `exit` chega
 * antes de o stdio drenar, e fechar ali perderia as últimas linhas — que são
 * exatamente onde vive o bloco `<result>` e o evento de usage.
 */
export function startProcess(
  command: string,
  args: readonly string[],
  options: StartProcessOptions,
): RunningProcess {
  const queue = createAsyncQueue<ChildProcessEvent>();
  const { child, pid } = spawnDetached(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let closed = false;
  const closePromise = new Promise<void>((resolve) => {
    child.on("close", (code, signal) => {
      queue.push({ kind: "exit", code, signal });
      closed = true;
      queue.close();
      resolve();
    });
  });

  child.on("error", (error: Error) => {
    queue.push({ kind: "error", error });
    if (!closed) {
      // `error` sem `close` acontece quando o processo nunca nasceu (ENOENT).
      // Sem este fechamento o consumidor esperaria para sempre.
      queue.push({ kind: "exit", code: null, signal: null });
      closed = true;
      queue.close();
    }
  });

  if (child.stdout !== null) {
    child.stdout.setEncoding("utf8");
    const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
    reader.on("line", (line: string) => {
      queue.push({ kind: "stdout", line });
    });
  }

  if (child.stderr !== null) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      queue.push({ kind: "stderr", text: chunk });
    });
  }

  if (child.stdin !== null) {
    child.stdin.on("error", () => {
      // Um agente que sai antes de ler o prompt fecha o pipe; escrever nele
      // daria EPIPE. Não é falha da execução, e o código de saída conta a
      // história de verdade.
    });
    if (options.stdin !== undefined) child.stdin.write(options.stdin);
    child.stdin.end();
  }

  return {
    pid,
    events: queue,
    terminate: async (terminateOptions) => {
      const result = await terminateProcessTree(pid, {
        graceMs: terminateOptions?.graceMs,
        confirmMs: terminateOptions?.confirmMs,
      });
      return { terminated: result.terminated, method: result.method, elapsedMs: result.elapsedMs };
    },
    finished: () => closePromise,
  };
}

export interface CollectOptions extends StartProcessOptions {
  /** Teto de tempo. Estourou, a árvore é morta e `timedOut` volta `true`. */
  readonly timeoutMs?: number;
  readonly maxOutputChars?: number;
}

export interface CollectResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  /** Preenchido quando o processo nem chegou a nascer. */
  readonly error?: Error;
}

/**
 * Roda um comando curto até o fim e junta a saída.
 *
 * É o caminho de `git`, de `--version` e de qualquer coisa que termina sozinha.
 * Nunca lança: `ENOENT` volta em `error`, e quem chamou decide o que isso
 * significa — para o preflight, significa "não instalado".
 */
export async function collectProcess(
  command: string,
  args: readonly string[],
  options: CollectOptions,
): Promise<CollectResult> {
  let running: RunningProcess;
  try {
    running = startProcess(command, args, options);
  } catch (error) {
    return {
      code: null,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  const max = options.maxOutputChars ?? MAX_TAIL_CHARS;
  const stdout = new BoundedTail(max, "\n");
  const stderr = new BoundedTail(max, "");
  let code: number | null = null;
  let signal: NodeJS.Signals | null = null;
  let spawnError: Error | undefined;
  let timedOut = false;

  const timer =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          void running.terminate({ graceMs: 1_000, confirmMs: 1_000 });
        }, options.timeoutMs);
  timer?.unref();

  try {
    for await (const event of running.events) {
      switch (event.kind) {
        case "stdout":
          stdout.push(event.line);
          break;
        case "stderr":
          stderr.push(event.text);
          break;
        case "exit":
          code = event.code;
          signal = event.signal;
          break;
        case "error":
          spawnError = event.error;
          break;
      }
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  return {
    code,
    signal,
    stdout: stdout.toString(),
    stderr: stderr.toString(),
    timedOut,
    ...(spawnError === undefined ? {} : { error: spawnError }),
  };
}
