/**
 * Os tipos mínimos que o runtime consome do domínio.
 *
 * `Loadout` e `ExecutionProfile` são entidades de banco, com id, versão e dono;
 * o runtime nunca vê a entidade, só o **snapshot** congelado no início do Run.
 * O snapshot é o que torna um Run antigo auditável depois que o Loadout mudou
 * (documento técnico, seção 13).
 *
 * Enquanto as entidades não existem em `@dungeon-master/contracts`, estes são
 * os campos que o runtime realmente lê. Quando os schemas chegarem, o
 * snapshot passa a ser derivado deles; nada aqui muda de forma.
 */

import type { HarnessKey } from "@dungeon-master/contracts";

/** Onde o processo do agente roda. `DOCKER` chega na Fase 2C. */
export const EXECUTION_MODE_VALUES = ["HOST", "DOCKER"] as const;
export type ExecutionMode = (typeof EXECUTION_MODE_VALUES)[number];

/**
 * Como o código é isolado operacionalmente. Eixo **ortogonal** ao modo de
 * execução: worktree não é backend (planejamento v0.4, Fase 2C).
 *
 * - `CURRENT` roda no próprio `workspace_path` do Run.
 * - `GIT_WORKTREE` roda num worktree por Run, criado por nós, com trava por
 *   par (repositório, caminho) no PostgreSQL antes de qualquer processo subir.
 * - `COPY` ainda não existe; pedir por ele falha com mensagem clara.
 */
export const WORKSPACE_STRATEGY_VALUES = ["CURRENT", "GIT_WORKTREE", "COPY"] as const;
export type WorkspaceStrategy = (typeof WORKSPACE_STRATEGY_VALUES)[number];

/**
 * O quanto a política de permissão é realmente imposta (documento técnico,
 * seção 15). A UI mostra a diferença; `ADVISORY` nunca é apresentado como
 * proteção.
 */
export const ENFORCEMENT_LEVEL_VALUES = ["ADVISORY", "HARNESS_NATIVE", "SANDBOX_ENFORCED"] as const;
export type EnforcementLevel = (typeof ENFORCEMENT_LEVEL_VALUES)[number];

/**
 * Modo de permissão pedido ao harness (planejamento v0.4, Fase 3C).
 *
 * - `DEFAULT` não passa flag nenhuma: vale o padrão da CLI.
 * - `CONFIGURED` passa o modo nomeado em `harnessMode`, que é vocabulário do
 *   harness (`acceptEdits` no Claude, `workspace-write` no Codex).
 * - `BYPASS` desliga as checagens. Nunca é o padrão e só passa com
 *   `SANDBOX_ENFORCED` ou opt-in explícito, registrado como `Diagnostic`.
 */
export const PERMISSION_MODE_VALUES = ["DEFAULT", "CONFIGURED", "BYPASS"] as const;
export type PermissionMode = (typeof PERMISSION_MODE_VALUES)[number];

export interface PermissionPolicy {
  readonly mode: PermissionMode;
  /** Modo nativo do harness, usado quando `mode` é `CONFIGURED`. */
  readonly harnessMode?: string;
  /**
   * Autoriza `BYPASS` fora de um ambiente com isolamento imposto.
   *
   * Sem isto, `BYPASS` em `HOST` é rebaixado para o padrão da CLI e o
   * rebaixamento aparece como `Diagnostic`. É a trava que impede um Loadout
   * copiado de virar bypass silencioso na máquina de alguém.
   */
  readonly allowBypassWithoutSandbox?: boolean;
}

/**
 * O que do ambiente chega ao processo do agente.
 *
 * Allow-list, nunca herança: `buildEnv` de `@dungeon-master/platform` monta o
 * ambiente do zero. O Sandcastle usa o mesmo mecanismo por outro caminho
 * (`.sandcastle/.env`); aqui ele é nosso, e é por isso que um `AWS_SECRET…` no
 * ambiente do worker não vaza para um agente por acidente.
 */
export interface EnvironmentPolicy {
  /** Chaves do ambiente do worker que podem passar. */
  readonly allowList?: readonly string[];
  /** Valores injetados de propósito. Ganham da allow-list na mesma chave. */
  readonly variables?: Readonly<Record<string, string>>;
  /**
   * Incluir o piso do SO (`PATH`, `SystemRoot`, `HOME`…) e as chaves que o
   * adapter declara como necessárias. Padrão: `true`. Desligar produz um
   * ambiente que quase nenhum processo consegue usar, e existe só para teste.
   */
  readonly inheritEssential?: boolean;
}

/** Referência ao harness escolhido para o Run. */
export interface HarnessRef {
  readonly key: HarnessKey;
  /** Id da linha de `harness` no banco, quando o Run veio de lá. */
  readonly id?: string;
}

/** Referência ao modelo. `id` é o que vai na linha de comando da CLI. */
export interface ModelRef {
  /** Identificador aceito pela CLI (`claude-sonnet-5`, `gpt-5-codex`). */
  readonly id: string;
  readonly name?: string;
}

/** O repositório e o checkout onde o Run acontece. */
export interface WorkspaceRef {
  /** Raiz do repositório git, absoluta. É a chave da trava de worktree. */
  readonly repoPath: string;
  /**
   * Checkout já preparado por quem chamou (o worker, depois de pegar a trava
   * no banco). Quando vem preenchido, o runtime usa e **não** cria nem remove
   * nada; quando falta em `GIT_WORKTREE`, o runtime cria e remove o dele.
   */
  readonly checkoutPath?: string;
  /** Ref base do worktree. Padrão: `HEAD`. */
  readonly baseRef?: string;
}

/** Snapshot do Loadout congelado no início do Run. */
export interface LoadoutSnapshot {
  readonly id?: string;
  readonly name?: string;
  readonly harness: HarnessRef;
  readonly model?: ModelRef;
  /** Texto acrescentado ao prompt do sistema, quando o harness aceitar. */
  readonly systemPromptAppend?: string;
  /** Argumentos extras da CLI. Elemento de array, nunca linha de comando. */
  readonly harnessArgs?: readonly string[];
}

/** Snapshot do ExecutionProfile congelado no início do Run. */
export interface ExecutionProfileSnapshot {
  readonly id?: string;
  readonly name?: string;
  readonly mode: ExecutionMode;
  readonly workspaceStrategy: WorkspaceStrategy;
  readonly permissionPolicy?: PermissionPolicy;
  readonly environmentPolicy?: EnvironmentPolicy;
}

/**
 * Os dois relógios da execução, ambos nossos.
 *
 * `idleMs` mede o silêncio: nenhum evento chegou nesse intervalo. `completionMs`
 * é o teto absoluto da execução inteira. O Sandcastle tem um par parecido, mas
 * o dele força a conclusão sem matar processo; aqui os dois terminam em kill de
 * árvore com confirmação (documento técnico, seção 13).
 */
export interface ExecutionTimeouts {
  readonly idleMs: number;
  readonly completionMs: number;
  /** Espera pelo término gracioso antes de escalar o kill. Padrão: 5000 ms. */
  readonly killGraceMs?: number;
  /** Espera pela confirmação de que a árvore sumiu. Padrão: 2000 ms. */
  readonly killConfirmMs?: number;
}

/** Padrões usados quando o perfil não diz outra coisa. */
export const DEFAULT_EXECUTION_TIMEOUTS: Required<ExecutionTimeouts> = {
  idleMs: 600_000,
  completionMs: 3_600_000,
  killGraceMs: 5_000,
  killConfirmMs: 2_000,
};

/** Como uma execução terminou, no vocabulário do Run. */
export const EXECUTION_STATUS_VALUES = ["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUS_VALUES)[number];
