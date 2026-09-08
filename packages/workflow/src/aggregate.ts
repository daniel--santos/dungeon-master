import type {
  DiscoveredTask,
  KnowledgeCandidateInput,
  RunError,
  RunResult,
  RunStep,
  TaskExecutionArtifact,
  UsageSummary,
} from "@dungeon-master/contracts";
import { isFailedRunStepStatus } from "@dungeon-master/domain";

import { collectKnowledgeCandidates } from "./executors/knowledge.js";

/**
 * O desfecho do Run a partir dos RunSteps assentados.
 *
 * A regra é a do planejamento (v0.4, Fase 4B): `SUCCEEDED` quando todo step
 * está `SUCCEEDED` ou `SKIPPED`; `FAILED` quando algum terminou em `FAILED` ou
 * `TIMED_OUT`. O `result` tem o formato do Run simples — `status`, `summary`,
 * `artifacts`, `knowledgeCandidates`, `discoveredTasks`, `warnings` — para
 * que a Task seja acoplada pelas mesmas regras (`taskStatusForRunTransition`),
 * a interface leia o mesmo campo pelo mesmo nome, e a escrita terminal grave
 * propostas e candidatos pelo mesmo caminho do Run simples (Fase 5).
 *
 * O veredito (`result.status`) é o do **último step de agente** que assentou
 * em `SUCCEEDED`: é ele quem sabe se o trabalho ficou pronto. Um Workflow sem
 * agente nenhum que terminou bem reporta `completed`, porque não há quem
 * discorde. Os steps pulados viram `warnings`, com o motivo: pular é uma
 * decisão do Workflow, e a interface precisa mostrá-la sem que ela conte como
 * falha.
 */

export interface AggregatedRun {
  readonly status: "SUCCEEDED" | "FAILED";
  readonly result: RunResult;
  readonly error?: RunError | undefined;
  /** A sessão do último step de agente que capturou uma. Vai para o Run. */
  readonly harnessSessionId?: string | undefined;
}

export function aggregateRunResult(steps: readonly RunStep[]): AggregatedRun {
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  const failed = ordered.filter((step) => isFailedRunStepStatus(step.status));
  const status: AggregatedRun["status"] = failed.length === 0 ? "SUCCEEDED" : "FAILED";

  const agentes = ordered.filter(
    (step) => step.status === "SUCCEEDED" && step.result?.kind === "agent",
  );
  const ultimoAgente = agentes.at(-1);
  const ultimoResultado = ultimoAgente?.result?.kind === "agent" ? ultimoAgente.result : undefined;

  const artifacts = collectArtifacts(ordered);
  const knowledgeCandidates = collectKnowledge(ordered);
  const discoveredTasks = collectDiscoveredTasks(ordered);
  const usage = sumUsage(ordered);
  const warnings = collectWarnings(ordered);

  const summary =
    ultimoResultado?.summary ??
    (status === "SUCCEEDED"
      ? `Workflow concluído: ${String(ordered.length)} passo(s).`
      : `Workflow falhou no passo «${failed[0]?.name ?? "?"}» (${failed[0]?.key ?? "?"}).`);

  const result: RunResult = {
    // Num Run que falhou o trabalho não ficou pronto, diga o último agente o
    // que disser: o veredito dele valia para o passo, não para o Workflow.
    status: status === "SUCCEEDED" ? (ultimoResultado?.status ?? "completed") : "failed",
    summary,
    ...(warnings.length === 0 ? {} : { warnings }),
    ...(usage === undefined ? {} : { usage }),
    ...(artifacts.length === 0 ? {} : { artifacts }),
    ...(knowledgeCandidates.length === 0 ? {} : { knowledgeCandidates }),
    ...(discoveredTasks.length === 0 ? {} : { discoveredTasks }),
    steps: ordered.map((step) => ({
      key: step.key,
      name: step.name,
      type: step.type,
      status: step.status,
      attempt: step.attempt,
    })),
  };

  const sessao = [...ordered]
    .reverse()
    .map((step) => (step.result?.kind === "agent" ? step.result.harnessSessionId : undefined))
    .find((id) => id !== undefined);

  if (status === "SUCCEEDED") {
    return { status, result, ...(sessao === undefined ? {} : { harnessSessionId: sessao }) };
  }

  const primeiro = failed[0]!;
  const error: RunError = {
    code: primeiro.error?.code ?? `STEP_${primeiro.status}`,
    message:
      `O passo «${primeiro.name}» (${primeiro.key}) terminou em ${primeiro.status}` +
      (primeiro.error === null ? "." : `: ${primeiro.error.message}`),
    retryable: failed.some((step) => step.error?.["retryable"] === true),
    stepKey: primeiro.key,
    failedSteps: failed.map((step) => ({
      key: step.key,
      status: step.status,
      ...(step.error?.code === undefined ? {} : { code: step.error.code }),
    })),
  };

  return { status, result, error, ...(sessao === undefined ? {} : { harnessSessionId: sessao }) };
}

/** A união dos artefatos declarados pelos agentes, sem repetir caminho. */
function collectArtifacts(steps: readonly RunStep[]): TaskExecutionArtifact[] {
  const porCaminho = new Map<string, TaskExecutionArtifact>();
  for (const step of steps) {
    if (step.result?.kind !== "agent") continue;
    for (const artifact of step.result.artifacts ?? []) {
      if (!porCaminho.has(artifact.path)) porCaminho.set(artifact.path, artifact);
    }
  }
  return [...porCaminho.values()];
}

/**
 * Os candidatos a conhecimento do Run.
 *
 * Quando um step `knowledge` assentou, o que ele consolidou vale; senão, a
 * união do que os agentes reportaram — o step `knowledge` é conveniência, não
 * pré-requisito para o Grimório receber candidatos.
 */
function collectKnowledge(steps: readonly RunStep[]): KnowledgeCandidateInput[] {
  const consolidado = [...steps]
    .reverse()
    .find((step) => step.status === "SUCCEEDED" && step.result?.kind === "knowledge");
  if (consolidado?.result?.kind === "knowledge") return consolidado.result.candidates;
  return collectKnowledgeCandidates(steps);
}

/**
 * O trabalho que os agentes encontraram e não fizeram, na ordem dos steps.
 *
 * Todos os steps de agente com resultado entram, e não só os `SUCCEEDED`: um
 * step que falhou por permissão negada ainda pode ter apontado o que faltava,
 * e a proposta é justamente o que sobrevive à falha. Não há deduplicação por
 * título de propósito — quem decide se duas propostas são a mesma é quem
 * aprova, com a Task de origem na frente.
 */
function collectDiscoveredTasks(steps: readonly RunStep[]): DiscoveredTask[] {
  const discovered: DiscoveredTask[] = [];
  for (const step of steps) {
    if (step.result?.kind !== "agent") continue;
    for (const task of step.result.discoveredTasks ?? []) discovered.push(task);
  }
  return discovered;
}

function sumUsage(steps: readonly RunStep[]): UsageSummary | undefined {
  let total: UsageSummary | undefined;
  for (const step of steps) {
    if (step.result?.kind !== "agent" || step.result.usage === undefined) continue;
    const usage = step.result.usage;
    total = {
      inputTokens: (total?.inputTokens ?? 0) + usage.inputTokens,
      outputTokens: (total?.outputTokens ?? 0) + usage.outputTokens,
      cacheReadInputTokens: (total?.cacheReadInputTokens ?? 0) + usage.cacheReadInputTokens,
      cacheCreationInputTokens:
        (total?.cacheCreationInputTokens ?? 0) + usage.cacheCreationInputTokens,
      ...(usage.costUsd === undefined && total?.costUsd === undefined
        ? {}
        : { costUsd: (total?.costUsd ?? 0) + (usage.costUsd ?? 0) }),
    };
  }
  return total;
}

/** Os steps pulados e as validações reprovadas, em frases para a interface. */
function collectWarnings(steps: readonly RunStep[]): string[] {
  const warnings: string[] = [];
  for (const step of steps) {
    if (step.status === "SKIPPED") {
      warnings.push(
        `Passo «${step.name}» (${step.key}) pulado` +
          (step.error === null ? "." : `: ${step.error.message}`),
      );
    }
    if (step.result?.kind === "validation" && step.result.verdict === "failed") {
      warnings.push(
        `Validação «${step.name}» (${step.key}) reprovou com código ${String(step.result.exitCode)}.`,
      );
    }
  }
  return warnings;
}
