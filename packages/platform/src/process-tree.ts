// Adapted from Archon — packages/cli/src/utils/detached-run-control.ts@0773b97 (linhas 454–572)
// Copyright (c) 2026 Cole Medin. Licensed under the MIT License.
// Changes: extraídos apenas `processExists`, `waitUntilGone` e a terminação por
// SO; removidos o IPC por socket, a lease de execução e o resto do arquivo.
// `terminateDetachedProcessTree` virou `terminateProcessTree`, que devolve
// `TerminationResult` em vez de lançar: o contrato aqui é nunca lançar por
// processo vivo ou já morto, só por argumento inválido. `graceMs` e `confirmMs`
// passaram a ser parâmetros. No POSIX, um alvo que não lidera grupo nenhum
// deixou de ser erro e passa a ser sinalizado sozinho. Mensagens em português.

import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Intervalo entre duas checagens de existência de processo. */
const POLL_INTERVAL_MS = 50;

/** Espera padrão pelo término gracioso, antes de escalar. */
const DEFAULT_GRACE_MS = 5_000;

/** Espera padrão pela confirmação de que o alvo sumiu, depois do golpe final. */
const DEFAULT_CONFIRM_MS = 1_000;

/** Como o término foi tentado. É o último método usado, não o único. */
export type TerminationMethod = "taskkill" | "sigterm" | "sigkill";

export interface TerminationResult {
  /**
   * `true` só quando o desaparecimento foi **confirmado** por polling. O código
   * de saída do `taskkill` não entra nesta conta: ele é diferente de zero tanto
   * quando algum pid da árvore já tinha morrido — o resultado desejado — quanto
   * quando o kill falhou de verdade.
   */
  terminated: boolean;
  method: TerminationMethod;
  /** Tempo total gasto na tentativa, incluindo grace e confirmação. */
  elapsedMs: number;
}

export interface TerminateProcessTreeOptions {
  /**
   * No POSIX, quanto esperar o alvo sair sozinho depois do `SIGTERM`, antes de
   * escalar para `SIGKILL`. No Windows não existe pedido educado: o valor vira
   * o teto de tempo do próprio `taskkill`, que precisa de centenas de
   * milissegundos só para subir. Menos de um segundo lá dentro corta o comando
   * no meio e o resultado sai como não confirmado, que é o honesto.
   *
   * Padrão: 5000 ms.
   */
  graceMs?: number;
  /** Espera pela confirmação de que o alvo sumiu. Padrão: 1000 ms. */
  confirmMs?: number;
}

/**
 * O processo `pid` existe?
 *
 * `EPERM` conta como existir: o processo está lá, só não podemos sinalizá-lo.
 * Qualquer outro erro (`ESRCH`) significa que sumiu.
 *
 * No Windows a libuv responde ao sinal `0` consultando `GetExitCodeProcess`, de
 * modo que um processo já encerrado cujo handle ainda não foi fechado pelo pai
 * responde `false` aqui, e não `true`.
 */
export function processExists(pid: number): boolean {
  assertPid(pid, "pid");
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Espera `exists()` virar `false`, checando a cada {@link POLL_INTERVAL_MS}.
 *
 * Devolve `true` quando o alvo sumiu dentro de `timeoutMs` e `false` quando o
 * prazo estourou com ele ainda de pé. Um alvo já morto devolve `true` sem
 * dormir.
 */
export async function waitUntilGone(exists: () => boolean, timeoutMs: number): Promise<boolean> {
  assertTimeout(timeoutMs, "timeoutMs");
  const deadline = Date.now() + timeoutMs;
  while (exists()) {
    if (Date.now() >= deadline) return false;
    await delay(POLL_INTERVAL_MS);
  }
  return true;
}

/**
 * Mata `pid` e toda a sua descendência, e confirma que sumiram.
 *
 * Windows usa `taskkill /PID <pid> /T /F`; POSIX manda `SIGTERM` ao grupo de
 * processos, espera `graceMs` e escala para `SIGKILL`. Nos dois casos a prova
 * do término é o polling, nunca o resultado do comando ou do sinal.
 *
 * Nunca lança por causa do alvo: um pid já morto devolve `terminated: true` e um
 * pid vivo que resistiu devolve `terminated: false`. Lança só por argumento
 * inválido.
 *
 * No POSIX, matar o **grupo** só alcança os descendentes se o alvo tiver sido
 * criado com `detached: true`, como faz `spawnDetached`. Um alvo que não lidera
 * grupo nenhum é sinalizado sozinho, sem os descendentes; é o máximo possível
 * sem varrer a tabela de processos.
 */
export async function terminateProcessTree(
  pid: number,
  options: TerminateProcessTreeOptions = {},
): Promise<TerminationResult> {
  assertPid(pid, "pid");
  if (pid === process.pid) {
    throw new Error(`terminateProcessTree recusa o pid do próprio processo (${String(pid)}).`);
  }
  const graceMs = optionalTimeout(options.graceMs, DEFAULT_GRACE_MS, "graceMs");
  const confirmMs = optionalTimeout(options.confirmMs, DEFAULT_CONFIRM_MS, "confirmMs");
  const startedAt = Date.now();

  return process.platform === "win32"
    ? terminateOnWindows(pid, graceMs, confirmMs, startedAt)
    : terminateOnPosix(pid, graceMs, confirmMs, startedAt);
}

async function terminateOnWindows(
  pid: number,
  graceMs: number,
  confirmMs: number,
  startedAt: number,
): Promise<TerminationResult> {
  try {
    await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      timeout: graceMs,
      windowsHide: true,
    });
  } catch (error) {
    // Um `taskkill` cortado por timeout não terminou de andar a árvore: a raiz
    // pode estar morta e um descendente que a varredura nunca visitou continuar
    // de pé. A confirmação abaixo só olha a raiz, então ela não prova nada
    // neste caso e o resultado é honesto: não confirmado.
    if (commandTerminatedBySignal(error)) {
      return { terminated: false, method: "taskkill", elapsedMs: Date.now() - startedAt };
    }
    // Saída diferente de zero também é o que acontece quando algum pid da
    // árvore já tinha sumido — cedo demais para o `taskkill`, certo para nós.
    // Nada no código de saída separa os dois casos; quem separa é o polling.
  }
  const terminated = await waitUntilGone(() => processExists(pid), confirmMs);
  return { terminated, method: "taskkill", elapsedMs: Date.now() - startedAt };
}

async function terminateOnPosix(
  pid: number,
  graceMs: number,
  confirmMs: number,
  startedAt: number,
): Promise<TerminationResult> {
  const leadsGroup = processGroupExists(pid);
  const target = leadsGroup ? -pid : pid;
  const stillAlive = leadsGroup ? () => processGroupExists(pid) : () => processExists(pid);

  sendSignal(target, "SIGTERM");
  if (await waitUntilGone(stillAlive, graceMs)) {
    return { terminated: true, method: "sigterm", elapsedMs: Date.now() - startedAt };
  }

  sendSignal(target, "SIGKILL");
  const terminated = await waitUntilGone(stillAlive, confirmMs);
  return { terminated, method: "sigkill", elapsedMs: Date.now() - startedAt };
}

/** O grupo de processos liderado por `pid` existe? Só faz sentido no POSIX. */
function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Manda um sinal e engole a ausência do alvo.
 *
 * `ESRCH` significa que já morreu, que é o objetivo; `EPERM` significa que não
 * temos permissão, e aí o polling é quem vai dizer que não morreu. Nenhum dos
 * dois é motivo para lançar.
 */
function sendSignal(target: number, signal: "SIGTERM" | "SIGKILL"): boolean {
  try {
    process.kill(target, signal);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH" || code === "EPERM") return false;
    throw error;
  }
}

/**
 * O comando filho morreu por sinal em vez de sair com status próprio?
 *
 * É a linha entre um comando que rodou até o fim e reportou alguma coisa e um
 * que foi cortado no meio. O Node deixa isso estrutural em vez de textual: um
 * kill por `timeout` marca `killed: true` com `signal: 'SIGTERM'`, uma saída
 * comum diferente de zero traz `killed: false` e um `code` numérico, e um
 * comando que nunca começou não traz nenhum dos dois. Nada aqui lê texto de
 * mensagem, então vale em qualquer locale.
 *
 * Exportado por causa do teste: o caminho do Windows tolera um comando que
 * terminou e falhou, e nunca pode tolerar um que foi interrompido, e essa
 * decisão não dá para exercitar de uma plataforma onde o caminho não roda.
 */
export function commandTerminatedBySignal(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { killed, signal } = error as { killed?: unknown; signal?: unknown };
  return killed === true || typeof signal === "string";
}

function assertPid(pid: number, name: string): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`${name} precisa ser um inteiro positivo; recebi ${JSON.stringify(pid)}.`);
  }
}

function assertTimeout(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `${name} precisa ser um número finito não negativo; recebi ${JSON.stringify(value)}.`,
    );
  }
}

function optionalTimeout(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  assertTimeout(value, name);
  return value;
}
