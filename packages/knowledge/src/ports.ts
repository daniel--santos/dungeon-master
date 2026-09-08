import type { z } from "zod";

import type { NotableFacts } from "./forge.js";
import type { SummaryTriggerFacts } from "./summary-trigger.js";
import type {
  ApplyDecisionsInput,
  ApplyDecisionsResult,
  DistillCandidate,
  DistillationRunFinish,
  DistillationRunStart,
  ExistingKnowledgeItem,
  ForgedAchievementInput,
  LlmProvenance,
  ProjectContext,
  RunTranscript,
  UpsertSummaryInput,
} from "./types.js";

/**
 * Os contratos pelos quais a infraestrutura entra no Distiller.
 *
 * `@dungeon-master/knowledge` decide **o que** acontece com cada candidato e
 * em que ordem; quem grava linha, pega o advisory lock e chama o harness é
 * quem implementa estas portas — o Worker, com os repositórios reais e o
 * `AgentRuntime`, ou a memória dos testes. É a mesma disciplina de
 * `@dungeon-master/workflow` (planejamento v0.4, seção 5): o pacote não
 * importa banco, e o ESLint garante.
 *
 * Duas regras atravessam as portas:
 *
 * 1. **O lote inteiro roda dentro do lock.** `withProjectLock` abre uma
 *    transação, tenta o `pg_advisory_xact_lock` derivado do Project e só
 *    chama o callback se conseguiu. Tudo o que o callback escreve pelo
 *    `LockedProjectStore` sai no mesmo COMMIT, e uma exceção desfaz tudo — é
 *    o que garante que uma falha do modelo deixa os candidatos `PENDING`.
 * 2. **O `DistillationRun` vive fora da transação.** É criado antes e
 *    terminado depois, pelo `KnowledgeStore`, para sobreviver ao rollback:
 *    um lote que falhou precisa continuar existindo, com o erro, senão o
 *    retry morto do TencentDB (documento técnico, seção 20.1) volta.
 */

export type LockOutcome<T> =
  { readonly acquired: false } | { readonly acquired: true; readonly value: T };

export interface KnowledgeStore {
  /** Grava o lote como `RUNNING`, fora de qualquer transação. */
  createDistillationRun(input: DistillationRunStart): Promise<{ id: string }>;
  /** Termina o lote. Fora da transação, pelo mesmo motivo. */
  finishDistillationRun(input: DistillationRunFinish): Promise<void>;
  /**
   * Abre a transação, tenta o lock do Project e roda o callback dentro dela.
   *
   * `acquired: false` quando outro lote está com o Project; nada é escrito e
   * nada é esperado. O callback que lança desfaz a transação inteira e a
   * exceção sobe para quem chamou.
   */
  withProjectLock<T>(
    projectId: string,
    fn: (locked: LockedProjectStore) => Promise<T>,
  ): Promise<LockOutcome<T>>;
}

/** A persistência de um Project, dentro da transação do lock. */
export interface LockedProjectStore {
  loadProject(): Promise<ProjectContext | null>;
  /** Os candidatos `PENDING`, do mais antigo para o mais novo, até o teto. */
  listPendingCandidates(limit: number): Promise<DistillCandidate[]>;
  /** O L0 dos Runs, já com o texto cru; o filtro de ruído é do Distiller. */
  loadRunTranscripts(runIds: readonly string[]): Promise<RunTranscript[]>;
  /** Recall de candidatos a duplicata, por FTS. Nunca lança: vazio na dúvida. */
  recallSimilarItems(text: string, limit: number): Promise<ExistingKnowledgeItem[]>;
  /** Grava as decisões e emite `knowledge.distilled`. */
  applyDecisions(input: ApplyDecisionsInput): Promise<ApplyDecisionsResult>;
  summaryFacts(): Promise<SummaryTriggerFacts>;
  /** O `SUMMARY` corrente, ou nulo. */
  currentSummary(): Promise<ExistingKnowledgeItem | null>;
  /** Os itens `ACTIVE` que o resumo consolida, do mais antigo ao mais novo, até o teto. */
  listItemsForSummary(limit: number): Promise<ExistingKnowledgeItem[]>;
  /** Regenera o resumo corrente ou cria o primeiro. */
  upsertSummary(input: UpsertSummaryInput): Promise<{ id: string }>;
  notableFacts(): Promise<NotableFacts>;
  /** Grava a forjada em revisão e emite `achievement.forged`. */
  createForgedAchievement(input: ForgedAchievementInput): Promise<{ id: string }>;
}

/** O que cada chamada ao modelo pede. */
export interface KnowledgeAgentRequest<T> {
  /** Para o log e para o Worker escolher timeouts: `distill`, `summary` ou `forge`. */
  readonly purpose: "distill" | "summary" | "forge";
  readonly prompt: string;
  /** O schema da resposta. O Worker o entrega ao runtime como Standard Schema e como JSON Schema. */
  readonly schema: z.ZodType<T>;
}

export type KnowledgeAgentResult<T> =
  | { readonly ok: true; readonly output: T; readonly provenance: LlmProvenance }
  | { readonly ok: false; readonly error: string; readonly provenance: LlmProvenance };

/**
 * O modelo visto pelo Distiller.
 *
 * Mais estreito que `AgentRuntime` de propósito: quem sabe montar o
 * `ExecutionRequest` inteiro — o Loadout do Escriba, o workspace temporário,
 * a política sem comandos, os timeouts — é o Worker. O Distiller só sabe o
 * prompt e o schema. **Nunca lança**: toda falha volta em `ok: false`.
 */
export interface KnowledgeAgentRuntime {
  execute<T>(request: KnowledgeAgentRequest<T>): Promise<KnowledgeAgentResult<T>>;
}

export interface KnowledgeClock {
  now(): Date;
}

export const systemKnowledgeClock: KnowledgeClock = { now: () => new Date() };
