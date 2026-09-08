import {
  DECISION_CANDIDATE_KIND,
  type DiscoveredTask,
  DiscoveredTaskSchema,
  type ExecutionDecision,
  ExecutionDecisionSchema,
  type KnowledgeCandidateInput,
  KnowledgeCandidateInputSchema,
  type RunResult,
} from "@dungeon-master/contracts";
import type { EventsLogger } from "@dungeon-master/events";

import type { DatabaseExecutor } from "./dashboard-event.js";
import { persistKnowledgeCandidates } from "./knowledge-candidate.js";
import { persistDiscoveredTasks } from "./proposed-task.js";

/**
 * O que o resultado de um Run alimenta no domínio, além do próprio Run
 * (documento técnico, seção 39: "resultado de uma execução não é apenas
 * texto").
 *
 * Chamada por `writeRunTerminalStatus`, **na transação** que grava
 * `run.result` e o status terminal. Vale para os dois caminhos — o Run simples
 * e o Run com Workflow, cujo resultado agregado tem o mesmo formato —, e a
 * idempotência por `(run_id, position)` de cada tabela é o que permite
 * reprocessar um resultado sem duplicar.
 *
 * As `decisions` (Fase 6) entram como candidatos com `kind` = `decision`,
 * numa faixa de posição própria: o Distiller as promove como itens
 * `DECISION`, e a mesma idempotência por Run e posição vale para elas.
 *
 * `RunResult` é um objeto aberto, e o que chega em `discoveredTasks`,
 * `knowledgeCandidates` e `decisions` foi validado pelo runtime contra
 * `TaskExecutionResultSchema` antes de virar `RunCompleted`. A validação é
 * repetida aqui, item a item, por causa do caminho agregado e de resultados
 * escritos por versões anteriores: um item torto é pulado com aviso, e não
 * derruba a escrita terminal — que é a pior escrita para falhar.
 */

export interface PersistRunResultOutputsInput {
  userId: string;
  runId: string;
  taskId: string;
  projectId: string;
  result: RunResult;
  logger?: EventsLogger | undefined;
}

export interface RunResultOutputs {
  readonly proposedTasks: number;
  readonly knowledgeCandidates: number;
  /** As `decisions` gravadas como candidatos `DECISION`. */
  readonly decisions: number;
}

/**
 * A faixa de posição das `decisions` em `knowledge_candidate`.
 *
 * Os `knowledgeCandidates` ocupam `0..n-1`; as decisões começam aqui. Um
 * resultado com dez mil candidatos não existe, e se existisse o excedente
 * colidiria na chave única e seria pulado pelo `ON CONFLICT DO NOTHING`, e
 * não gravado errado.
 */
export const DECISION_POSITION_OFFSET = 10_000;

function itensValidos<T>(
  value: unknown,
  parse: (item: unknown) => { success: true; data: T } | { success: false },
  input: PersistRunResultOutputsInput,
  field: string,
): T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    input.logger?.warn?.(
      { runId: input.runId, field },
      "campo do resultado do Run não é uma lista; nada gravado",
    );
    return [];
  }

  const validos: T[] = [];
  value.forEach((item: unknown, position) => {
    const parsed = parse(item);
    if (parsed.success) {
      validos.push(parsed.data);
      return;
    }
    input.logger?.warn?.(
      { runId: input.runId, field, position },
      "item do resultado do Run fora do contrato; pulado",
    );
  });
  return validos;
}

/** Uma `decision` como candidato: o resumo é o título; o porquê vai no conteúdo. */
export function decisionToCandidate(decision: ExecutionDecision): KnowledgeCandidateInput {
  const summary = decision.summary.trim();
  const rationale = decision.rationale?.trim() ?? "";
  return {
    title: summary,
    content: rationale.length === 0 ? summary : `${summary}\n\n${rationale}`,
    kind: DECISION_CANDIDATE_KIND,
  };
}

export async function persistRunResultOutputs(
  db: DatabaseExecutor,
  input: PersistRunResultOutputsInput,
): Promise<RunResultOutputs> {
  const discovered = itensValidos<DiscoveredTask>(
    input.result["discoveredTasks"],
    (item) => DiscoveredTaskSchema.safeParse(item),
    input,
    "discoveredTasks",
  );
  const candidates = itensValidos<KnowledgeCandidateInput>(
    input.result["knowledgeCandidates"],
    (item) => KnowledgeCandidateInputSchema.safeParse(item),
    input,
    "knowledgeCandidates",
  );
  const decisions = itensValidos<ExecutionDecision>(
    input.result["decisions"],
    (item) => ExecutionDecisionSchema.safeParse(item),
    input,
    "decisions",
  );

  const propostas = await persistDiscoveredTasks(db, {
    userId: input.userId,
    projectId: input.projectId,
    originTaskId: input.taskId,
    originRunId: input.runId,
    discovered,
  });

  const conhecimento = await persistKnowledgeCandidates(db, {
    userId: input.userId,
    projectId: input.projectId,
    taskId: input.taskId,
    runId: input.runId,
    candidates,
  });

  const decididas = await persistKnowledgeCandidates(db, {
    userId: input.userId,
    projectId: input.projectId,
    taskId: input.taskId,
    runId: input.runId,
    candidates: decisions.map(decisionToCandidate),
    positionOffset: DECISION_POSITION_OFFSET,
  });

  return {
    proposedTasks: propostas.inserted,
    knowledgeCandidates: conhecimento.inserted,
    decisions: decididas.inserted,
  };
}
