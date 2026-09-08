import type { ProposedTaskStatus, TaskStatus } from "@dungeon-master/contracts";

import { findDependencyCycle, type TaskDependencyEdge } from "./dependency-graph.js";

/**
 * As regras de uma ProposedTask (planejamento v0.4, Fase 5).
 *
 * Tudo aqui é função pura sobre dados já lidos. Quem chama lê a proposta, a
 * mãe, as dependências e o grafo **dentro da transação** que grava a decisão,
 * senão a checagem responde sobre um estado que já passou.
 */

/**
 * A máquina de estados da proposta.
 *
 * ```text
 * PROPOSED → APPROVED | REJECTED
 * ```
 *
 * `APPROVED` e `REJECTED` são terminais: uma decisão não se desfaz. Quem
 * mudou de ideia sobre uma recusa cria a Task à mão; quem se arrependeu de uma
 * aprovação cancela a Task criada. A proposta continua contando o que
 * aconteceu.
 */
export const PROPOSED_TASK_TRANSITIONS = {
  PROPOSED: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
} as const satisfies Record<ProposedTaskStatus, readonly ProposedTaskStatus[]>;

export function canTransitionProposedTask(
  from: ProposedTaskStatus,
  to: ProposedTaskStatus,
): boolean {
  return (PROPOSED_TASK_TRANSITIONS[from] as readonly ProposedTaskStatus[]).includes(to);
}

/** Só uma proposta ainda aberta aceita decisão. */
export function isProposedTaskOpen(status: ProposedTaskStatus): boolean {
  return status === "PROPOSED";
}

/** O mínimo que as regras de aprovação precisam saber sobre uma Task. */
export interface ProposalTaskRef {
  readonly id: string;
  readonly projectId: string | null;
  readonly status: TaskStatus;
}

/**
 * Por que uma aprovação ou uma troca de dependências foi recusada.
 *
 * Códigos, e não frases: o domínio não escreve texto de interface. A API
 * traduz cada código no `detail` do problem details.
 */
export type TaskDependencyRejection =
  | { readonly code: "SELF_DEPENDENCY"; readonly taskId: string }
  | { readonly code: "DEPENDENCY_IN_OTHER_PROJECT"; readonly taskId: string }
  | { readonly code: "DEPENDENCY_IN_INBOX"; readonly taskId: string }
  | { readonly code: "DEPENDENCY_CYCLE"; readonly path: readonly string[] };

export type ProposalApprovalRejection =
  | { readonly code: "PROPOSAL_ALREADY_DECIDED"; readonly status: ProposedTaskStatus }
  | { readonly code: "PARENT_IN_OTHER_PROJECT"; readonly parentTaskId: string }
  | { readonly code: "PARENT_IN_INBOX"; readonly parentTaskId: string }
  | TaskDependencyRejection;

export type RuleCheck<Rejection> =
  { readonly ok: true } | { readonly ok: false; readonly rejection: Rejection };

export interface TaskDependenciesInput {
  /** A Task que vai depender das outras. Pode ainda não existir no grafo. */
  readonly taskId: string;
  /** Project da Task. Toda dependência precisa estar nele. */
  readonly projectId: string;
  /** As Tasks das quais ela passa a depender, já lidas. */
  readonly dependencies: readonly ProposalTaskRef[];
  /**
   * As arestas do grafo **sem** as arestas atuais de `taskId`.
   *
   * Quem troca o conjunto inteiro de dependências não pode ser recusado por
   * causa de uma aresta que está justamente removendo.
   */
  readonly edges: readonly TaskDependencyEdge[];
}

/**
 * As dependências que uma Task pode ter: no mesmo Project, fora da Inbox, sem
 * apontar para si mesma e sem fechar ciclo com o resto do grafo.
 *
 * O ciclo é procurado sobre o grafo inteiro mais as arestas novas, todas de
 * uma vez: duas dependências novas que só fecham ciclo juntas seriam aceitas
 * se checadas uma a uma. O caminho devolvido é o do impasse inteiro.
 */
export function checkTaskDependencies(
  input: TaskDependenciesInput,
): RuleCheck<TaskDependencyRejection> {
  for (const dependency of input.dependencies) {
    if (dependency.id === input.taskId) {
      return { ok: false, rejection: { code: "SELF_DEPENDENCY", taskId: dependency.id } };
    }
    if (dependency.status === "INBOX") {
      return { ok: false, rejection: { code: "DEPENDENCY_IN_INBOX", taskId: dependency.id } };
    }
    if (dependency.projectId !== input.projectId) {
      return {
        ok: false,
        rejection: { code: "DEPENDENCY_IN_OTHER_PROJECT", taskId: dependency.id },
      };
    }
  }

  const candidates: TaskDependencyEdge[] = input.dependencies.map((dependency) => ({
    taskId: input.taskId,
    dependsOnTaskId: dependency.id,
  }));
  const cycle = findDependencyCycle([...input.edges, ...candidates]);
  if (cycle !== null) {
    return { ok: false, rejection: { code: "DEPENDENCY_CYCLE", path: cycle } };
  }

  return { ok: true };
}

export interface ProposalApprovalInput {
  readonly proposal: {
    readonly status: ProposedTaskStatus;
    readonly projectId: string;
  };
  /** A Task que vai nascer. O id é gerado antes, para entrar no grafo. */
  readonly newTaskId: string;
  /** A mãe escolhida, já lida. `null` cria uma Task sem mãe. */
  readonly parent: ProposalTaskRef | null;
  readonly dependencies: readonly ProposalTaskRef[];
  /** O grafo de dependências do usuário. A Task nova ainda não está nele. */
  readonly edges: readonly TaskDependencyEdge[];
}

/**
 * A checagem completa de uma aprovação: a proposta ainda aberta, a mãe no
 * mesmo Project e fora da Inbox, e as dependências pelas regras de sempre.
 *
 * A Task nova não pode fechar ciclo — nada aponta para ela ainda —, mas a
 * checagem passa pelo mesmo caminho de `checkTaskDependencies` de propósito:
 * é uma regra só, e o dia em que a aprovação aceitar "estas Tasks passam a
 * depender da nova" não precisa reescrevê-la.
 */
export function checkProposalApproval(
  input: ProposalApprovalInput,
): RuleCheck<ProposalApprovalRejection> {
  if (!isProposedTaskOpen(input.proposal.status)) {
    return {
      ok: false,
      rejection: { code: "PROPOSAL_ALREADY_DECIDED", status: input.proposal.status },
    };
  }

  if (input.parent !== null) {
    if (input.parent.status === "INBOX") {
      return { ok: false, rejection: { code: "PARENT_IN_INBOX", parentTaskId: input.parent.id } };
    }
    if (input.parent.projectId !== input.proposal.projectId) {
      return {
        ok: false,
        rejection: { code: "PARENT_IN_OTHER_PROJECT", parentTaskId: input.parent.id },
      };
    }
  }

  return checkTaskDependencies({
    taskId: input.newTaskId,
    projectId: input.proposal.projectId,
    dependencies: input.dependencies,
    edges: input.edges,
  });
}

// --------------------------------------------------------------------------
// Política de decisão
// --------------------------------------------------------------------------

/**
 * O que o sistema faz com uma proposta recém-gravada.
 *
 * `human-review` é o único valor que existe hoje. A união já tem os outros
 * dois para que o dia em que uma política automática entrar (nível de
 * autonomia 2 e acima, documento técnico, seção 40) seja uma mudança nesta
 * função e em quem a chama, e não um campo novo no contrato.
 */
export type ProposalPolicyDecision = "human-review" | "auto-approve" | "auto-reject";

export interface ProposalPolicyInput {
  readonly projectId: string;
  readonly originTaskId: string;
  readonly title: string;
  readonly rationale: string | null;
}

/**
 * **Ponto de extensão da autoaprovação.** Hoje devolve sempre `human-review`.
 *
 * Fica no domínio, e não no repositório, para a regra ser testável sem banco
 * e para ninguém a esconder num `if` da escrita. Nada de LLM aqui: uma
 * política futura decide por dados da proposta e do Project, de forma
 * determinística, e o Run que a propôs nunca espera por ela.
 */
export function decideProposalPolicy(_input: ProposalPolicyInput): ProposalPolicyDecision {
  return "human-review";
}
