import { BoundedTail, startProcess, type RunningProcess } from "@dungeon-master/runtime";

import type {
  CommandExecutor,
  CommandHandle,
  CommandRequest,
  CommandResult,
  CommandTermination,
} from "./ports.js";

/**
 * O `CommandExecutor` de verdade: um processo filho no host.
 *
 * Passa por `startProcess` de `@dungeon-master/runtime`, que passa por
 * `spawnDetached` de `@dungeon-master/platform`: sem shell, argumentos em
 * array, ambiente por allow-list, e no POSIX líder do próprio grupo — o que
 * torna o kill de árvore capaz de alcançar netos. O ambiente vem pronto de
 * quem cria o executor (o Worker, a partir da `environmentPolicy` do perfil):
 * o executor não lê `process.env`.
 *
 * A saída é guardada em cauda limitada (planejamento v0.4, seção 13.1): um
 * comando falante não estoura o teto de string do V8, e o que interessa —
 * o fim, onde o erro costuma estar — sobrevive.
 */

/** Quanto de stdout e de stderr sobrevive no resultado do step. */
export const DEFAULT_COMMAND_TAIL_CHARS = 16 * 1024;

export interface ProcessCommandExecutorOptions {
  /** Ambiente completo do filho, já montado por allow-list. */
  readonly env: Readonly<Record<string, string>>;
  readonly maxTailChars?: number | undefined;
  /** Espera pelo término gracioso antes de escalar o kill. Padrão: 5000 ms. */
  readonly killGraceMs?: number | undefined;
  /** Espera pela confirmação de que a árvore sumiu. Padrão: 2000 ms. */
  readonly killConfirmMs?: number | undefined;
  readonly now?: (() => number) | undefined;
}

export function createProcessCommandExecutor(
  options: ProcessCommandExecutorOptions,
): CommandExecutor {
  const maxTailChars = options.maxTailChars ?? DEFAULT_COMMAND_TAIL_CHARS;
  const now = options.now ?? (() => Date.now());

  return {
    start(request: CommandRequest): CommandHandle {
      const [command, ...args] = request.argv;
      const startedAt = now();

      if (command === undefined || command.length === 0) {
        return immediate({
          exitCode: null,
          signal: null,
          stdoutTail: "",
          stderrTail: "",
          durationMs: 0,
          error: { code: "EMPTY_ARGV", message: "O step não tem programa para executar." },
        });
      }

      let running: RunningProcess;
      try {
        running = startProcess(command, args, { cwd: request.cwd, env: { ...options.env } });
      } catch (error) {
        return immediate({
          exitCode: null,
          signal: null,
          stdoutTail: "",
          stderrTail: "",
          durationMs: now() - startedAt,
          error: {
            code: "SPAWN_FAILED",
            message: `Não consegui iniciar ${JSON.stringify(command)}: ${describeError(error)}`,
          },
        });
      }

      const result = collect(running, { maxTailChars, startedAt, now, command });

      let termination: Promise<CommandTermination> | undefined;
      return {
        result,
        terminate: () => {
          termination ??= running
            .terminate({
              ...(options.killGraceMs === undefined ? {} : { graceMs: options.killGraceMs }),
              ...(options.killConfirmMs === undefined ? {} : { confirmMs: options.killConfirmMs }),
            })
            .then(
              (outcome): CommandTermination => ({
                terminated: outcome.terminated,
                method: outcome.method,
              }),
              (error: unknown): CommandTermination => ({
                terminated: false,
                method: describeError(error),
              }),
            );
          return termination;
        },
      };
    },
  };
}

/**
 * Um `CommandExecutor` que recusa tudo com o mesmo motivo.
 *
 * É o modo `DOCKER` para steps de comando nesta fase: em vez de executar no
 * host um comando que o perfil mandou isolar, o step falha com erro claro
 * (fail-closed). Rodar o comando dentro de um container efêmero com os
 * mesmos mounts do agente fica registrado como pendência.
 */
export function createRefusingCommandExecutor(reason: {
  readonly code: string;
  readonly message: string;
}): CommandExecutor {
  return {
    start: () =>
      immediate({
        exitCode: null,
        signal: null,
        stdoutTail: "",
        stderrTail: "",
        durationMs: 0,
        error: { code: reason.code, message: reason.message },
      }),
  };
}

function immediate(result: CommandResult): CommandHandle {
  return {
    result: Promise.resolve(result),
    terminate: () => Promise.resolve({ terminated: true, method: "not-running" }),
  };
}

async function collect(
  running: RunningProcess,
  options: {
    readonly maxTailChars: number;
    readonly startedAt: number;
    readonly now: () => number;
    readonly command: string;
  },
): Promise<CommandResult> {
  const stdout = new BoundedTail(options.maxTailChars, "\n");
  const stderr = new BoundedTail(options.maxTailChars, "");
  let exitCode: number | null = null;
  let signal: string | null = null;
  let spawnError: Error | undefined;

  for await (const event of running.events) {
    switch (event.kind) {
      case "stdout":
        stdout.push(event.line);
        break;
      case "stderr":
        stderr.push(event.text);
        break;
      case "exit":
        exitCode = event.code;
        signal = event.signal;
        break;
      case "error":
        spawnError = event.error;
        break;
    }
  }

  return {
    exitCode,
    signal,
    stdoutTail: stdout.toString(),
    stderrTail: stderr.toString(),
    durationMs: Math.max(0, options.now() - options.startedAt),
    ...(spawnError === undefined
      ? {}
      : {
          error: {
            code: "SPAWN_FAILED",
            message: `Não consegui executar ${JSON.stringify(options.command)}: ${spawnError.message}`,
          },
        }),
  };
}

function describeError(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
