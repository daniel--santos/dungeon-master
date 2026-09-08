import type {
  CheckoutSnapshotter,
  CommandExecutor,
  CommandHandle,
  CommandRequest,
  CommandResult,
} from "../ports.js";

/**
 * Dublês das portas de processo e de snapshot.
 *
 * O executor de comando falso responde por `argv` — um resultado, ou `hang`
 * para ficar de pé até o `terminate` —, e registra cada pedido e cada kill;
 * o snapshotter falso só registra as chamadas, porque o que o runner precisa
 * provar é **quando** ele chama, e não o que o git faz (isso tem teste
 * próprio, com repositório de verdade).
 */

export type FakeCommandScript =
  { readonly kind: "result"; readonly result: Partial<CommandResult> } | { readonly kind: "hang" };

export interface FakeCommandExecutor extends CommandExecutor {
  readonly requests: CommandRequest[];
  readonly terminations: number;
}

export function createFakeCommandExecutor(
  script: (request: CommandRequest) => FakeCommandScript,
): FakeCommandExecutor {
  const requests: CommandRequest[] = [];
  let terminations = 0;

  const executor: FakeCommandExecutor = {
    requests,
    get terminations() {
      return terminations;
    },
    start(request): CommandHandle {
      requests.push(request);
      const roteiro = script(request);

      if (roteiro.kind === "result") {
        return {
          result: Promise.resolve({
            exitCode: 0,
            signal: null,
            stdoutTail: "",
            stderrTail: "",
            durationMs: 1,
            ...roteiro.result,
          }),
          terminate: () => {
            terminations += 1;
            return Promise.resolve({ terminated: true, method: "not-running" });
          },
        };
      }

      let settle!: (result: CommandResult) => void;
      const result = new Promise<CommandResult>((resolve) => {
        settle = resolve;
      });
      return {
        result,
        terminate: () => {
          terminations += 1;
          settle({
            exitCode: null,
            signal: "SIGKILL",
            stdoutTail: "",
            stderrTail: "",
            durationMs: 1,
          });
          return Promise.resolve({ terminated: true, method: "fake-kill" });
        },
      };
    },
  };

  return executor;
}

export interface FakeSnapshotter extends CheckoutSnapshotter {
  readonly calls: Array<{
    readonly op: "snapshot" | "restore" | "discard";
    readonly stepKey: string;
  }>;
  /** Faz a próxima operação lançar, para o caminho de diagnóstico. */
  failNext?: Error | undefined;
}

export function createFakeSnapshotter(): FakeSnapshotter {
  const calls: FakeSnapshotter["calls"] = [];
  const run = (op: "snapshot" | "restore" | "discard", stepKey: string): Promise<void> => {
    calls.push({ op, stepKey });
    if (snapshotter.failNext !== undefined) {
      const error = snapshotter.failNext;
      snapshotter.failNext = undefined;
      return Promise.reject(error);
    }
    return Promise.resolve();
  };
  const snapshotter: FakeSnapshotter = {
    calls,
    snapshot: (stepKey) => run("snapshot", stepKey),
    restore: (stepKey) => run("restore", stepKey),
    discard: (stepKey) => run("discard", stepKey),
  };
  return snapshotter;
}
