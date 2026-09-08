import { join } from "node:path";

import type { CommandStepDefinition, ValidationStepDefinition } from "@dungeon-master/contracts";
import { isInside, normalizeAbsolutePath } from "@dungeon-master/platform";

import type { CommandResult, CommandTermination } from "../ports.js";
import type { StepExecutionContext } from "./types.js";

/**
 * O que `command` e `validation` têm em comum: subir o processo, aplicar o
 * teto de tempo e o cancelamento, e devolver o que o processo fez.
 *
 * O executor de processo (`CommandExecutor`) só sabe subir e matar; a corrida
 * entre o fim do processo, o relógio e o pedido de cancelamento é daqui, para
 * que os dois tipos de step tenham exatamente o mesmo comportamento de
 * término — que é a promessa que o projeto não deixa variar (documento
 * técnico, seção 13).
 */

export type ProcessStepOutcome =
  | { readonly kind: "finished"; readonly result: CommandResult }
  | {
      readonly kind: "timed_out";
      readonly result: CommandResult;
      readonly limitMs: number;
      readonly termination: CommandTermination;
    }
  | {
      readonly kind: "cancelled";
      readonly result: CommandResult;
      readonly termination: CommandTermination;
    }
  | { readonly kind: "invalid_cwd"; readonly cwd: string; readonly message: string };

/** Quanto se espera pela saída depois do kill. Um processo morto drena rápido. */
const DRAIN_AFTER_KILL_MS = 5_000;

export async function runProcessStep(
  context: StepExecutionContext<CommandStepDefinition | ValidationStepDefinition>,
): Promise<ProcessStepOutcome> {
  const { definition, deps } = context;

  const cwd = resolveCwd(context.run.checkoutPath, definition.cwd);
  if (!cwd.ok) return { kind: "invalid_cwd", cwd: definition.cwd ?? ".", message: cwd.message };

  const handle = deps.commands.start({ argv: definition.argv, cwd: cwd.path });

  const timer = createTimer(context.timeoutMs);
  const abort = abortPromise(context.signal);

  type Winner =
    | { readonly kind: "finished"; readonly result: CommandResult }
    | { readonly kind: "timeout" }
    | { readonly kind: "abort" };

  let winner: Winner;
  try {
    winner = await Promise.race<Winner>([
      handle.result.then((result): Winner => ({ kind: "finished", result })),
      timer.promise.then((): Winner => ({ kind: "timeout" })),
      abort.promise.then((): Winner => ({ kind: "abort" })),
    ]);
  } finally {
    timer.cancel();
    abort.cancel();
  }

  if (winner.kind === "finished") return { kind: "finished", result: winner.result };

  const termination = await handle.terminate();
  const result = await drain(handle.result);

  if (winner.kind === "timeout") {
    return { kind: "timed_out", result, limitMs: context.timeoutMs ?? 0, termination };
  }
  return { kind: "cancelled", result, termination };
}

/**
 * O `cwd` do step, dentro do checkout.
 *
 * O contrato já recusa caminho absoluto e `..` em texto; aqui a checagem é
 * sobre o caminho resolvido no disco, que é o que o processo vai receber. Um
 * `cwd` que resolva para fora do checkout é um step agindo onde o Run não
 * tem permissão de agir.
 */
function resolveCwd(
  checkoutPath: string,
  relative: string | undefined,
): { ok: true; path: string } | { ok: false; message: string } {
  const root = normalizeAbsolutePath(checkoutPath);
  if (relative === undefined) return { ok: true, path: root };
  try {
    const resolved = normalizeAbsolutePath(join(root, relative));
    if (!isInside(root, resolved)) {
      return {
        ok: false,
        message: `O diretório ${relative} resolve para ${resolved}, fora do checkout ${root}.`,
      };
    }
    return { ok: true, path: resolved };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Depois do kill, a saída é drenada com teto: um processo travado não segura o Run. */
async function drain(result: Promise<CommandResult>): Promise<CommandResult> {
  const timer = createTimer(DRAIN_AFTER_KILL_MS);
  try {
    return await Promise.race([
      result,
      timer.promise.then((): CommandResult => ({
        exitCode: null,
        signal: null,
        stdoutTail: "",
        stderrTail: "",
        durationMs: 0,
        error: { code: "OUTPUT_NOT_DRAINED", message: "A saída do processo não foi drenada." },
      })),
    ]);
  } finally {
    timer.cancel();
  }
}

/** Timer que não segura o event loop e que nunca dispara quando `ms` é indefinido. */
function createTimer(ms: number | undefined): { promise: Promise<void>; cancel: () => void } {
  if (ms === undefined) return { promise: new Promise<void>(() => undefined), cancel: () => {} };
  let handle: NodeJS.Timeout | undefined;
  const promise = new Promise<void>((resolve) => {
    handle = setTimeout(resolve, ms);
    handle.unref?.();
  });
  return {
    promise,
    cancel: () => {
      if (handle !== undefined) clearTimeout(handle);
    },
  };
}

function abortPromise(signal: AbortSignal): { promise: Promise<void>; cancel: () => void } {
  if (signal.aborted) return { promise: Promise.resolve(), cancel: () => {} };
  let listener: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    listener = () => resolve();
    signal.addEventListener("abort", listener, { once: true });
  });
  return {
    promise,
    cancel: () => {
      if (listener !== undefined) signal.removeEventListener("abort", listener);
    },
  };
}

/** A frase de `StepFinished` para um processo que terminou. */
export function describeProcessExit(result: CommandResult): string {
  if (result.error !== undefined) return result.error.message;
  if (result.exitCode === null) {
    return `Processo morto por ${result.signal ?? "sinal desconhecido"} após ${String(result.durationMs)} ms.`;
  }
  return `Código de saída ${String(result.exitCode)} em ${String(result.durationMs)} ms.`;
}
