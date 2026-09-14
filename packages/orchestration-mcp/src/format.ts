import { sanitizeForContext } from "@dungeon-master/context";

import type { OrchestrationChildRun, OrchestrationLoadout } from "./store.js";

/**
 * O texto que volta ao agente. Compacto, e sanitizado na saída pela mesma
 * cadeia do bloco de contexto (`sanitizeForContext`): o resumo de um Run
 * filho é texto escrito por outro modelo, e nunca volta a um prompt sem
 * passar por ela (planejamento v0.4, Fase 7; post-mortem #21).
 */

/** Teto do resumo de um filho devolvido por `await_run`. */
export const SUMMARY_CHARS = 8_000;
/** Teto do prompt de uma delegação. */
export const PROMPT_MAX_CHARS = 100_000;
/** Teto da referência de Loadout (id ou nome). */
export const LOADOUT_REF_MAX_CHARS = 200;
/** A espera padrão e o teto de `await_run`, em milissegundos. */
export const AWAIT_DEFAULT_TIMEOUT_MS = 10 * 60_000;
export const AWAIT_MAX_TIMEOUT_MS = 60 * 60_000;
/** Entre duas leituras do filho durante a espera. */
export const AWAIT_POLL_INTERVAL_MS = 1_000;

export function clean(text: string): string {
  return sanitizeForContext(text);
}

export function truncate(text: string, max: number): string {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}… [cortado em ${String(max)} caracteres]`;
}

export function formatLoadouts(loadouts: readonly OrchestrationLoadout[]): string {
  if (loadouts.length === 0) return "Nenhum Loadout disponível para delegar.";
  const linhas = loadouts.map(
    (loadout) =>
      `- ${clean(loadout.name)} (id ${loadout.id}) — agente ${clean(loadout.agentName)} ` +
      `[${loadout.agentRole}], harness ${loadout.harnessKey}${loadout.isDefault ? ", padrão" : ""}`,
  );
  return [
    `${String(loadouts.length)} Loadout(s) a que você pode delegar (use o nome ou o id em delegate_task):`,
    ...linhas,
  ].join("\n");
}

export function formatDelegated(child: OrchestrationChildRun): string {
  return [
    `Run filho aberto: ${child.id} (status ${child.status}).`,
    `Task: ${child.taskId}. Loadout: ${clean(child.loadoutName)}.`,
    `Chame await_run(runId: "${child.id}") para esperar o desfecho.`,
  ].join("\n");
}

export function formatChildOutcome(child: OrchestrationChildRun, timedOut: boolean): string {
  const linhas = [`Run filho ${child.id}: ${child.status}.`];
  if (timedOut) {
    linhas.push(
      "Ainda não terminou dentro do tempo de espera. Chame await_run de novo para continuar esperando.",
    );
    return linhas.join("\n");
  }
  if (child.resultStatus !== null) linhas.push(`Veredito do agente: ${child.resultStatus}.`);
  if (child.error !== null) {
    linhas.push(
      `Erro${child.error.code === undefined ? "" : ` (${child.error.code})`}: ${clean(child.error.message)}`,
    );
  }
  if (child.usage !== null) {
    linhas.push(
      `Consumo: ${String(child.usage.inputTokens)} tokens de entrada, ${String(child.usage.outputTokens)} de saída.`,
    );
  }
  if (child.summary !== null && child.summary.trim().length > 0) {
    linhas.push("", "Resumo do filho:", truncate(clean(child.summary), SUMMARY_CHARS));
  } else {
    linhas.push("O filho não deixou resumo.");
  }
  return linhas.join("\n");
}

export function formatNotFound(runId: string): string {
  return `O Run ${runId} não é um filho deste Run, ou não existe.`;
}
