/**
 * Os tipos que o runtime consome do domínio.
 *
 * `Loadout` e `ExecutionProfile` são entidades de banco, com id, versão e dono;
 * o runtime nunca vê a entidade, só o **snapshot** congelado no início do Run.
 * O snapshot é o que torna um Run antigo auditável depois que o Loadout mudou
 * (documento técnico, seção 13).
 *
 * **A costura com `@dungeon-master/contracts`.** Os enums de execução
 * (`ExecutionMode`, `WorkspaceStrategy`, `EnforcementLevel`) vêm de lá: são a
 * mesma coisa, e duas declarações da mesma forma criariam duas verdades. Já
 * `ExecutionProfileSnapshot` e `LoadoutSnapshot` existem nos dois lugares com
 * formas diferentes de propósito: o de contracts é o que a API expõe e o banco
 * guarda (política declarativa — `workspaceWrite`, `commandExecution`,
 * `allowedVariables`), e o daqui é o que o runtime precisa para montar um argv
 * e um ambiente. **Quem traduz um no outro é o worker**, e é ele quem decide,
 * por exemplo, que `commandExecution: ALL` vira qual modo de permissão de CLI.
 * Essa decisão é de domínio e não cabe a um adapter tomá-la sozinho.
 */

import type {
  EnforcementLevel,
  ExecutionMode,
  HarnessKey,
  WorkspaceStrategy,
} from "@dungeon-master/contracts";

export type { EnforcementLevel, ExecutionMode, WorkspaceStrategy };

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

/** Quanto de execução de comando foi concedido, no vocabulário do domínio. */
export const COMMAND_GRANT_VALUES = ["NONE", "ALLOWLIST"] as const;
export type CommandGrant = (typeof COMMAND_GRANT_VALUES)[number];

/**
 * O que o agente pode fazer, dito **sem** o vocabulário de nenhuma CLI.
 *
 * É o degrau que faltava entre "vale o padrão da ferramenta" e "desliga tudo".
 * Sem ele, `commandExecution: ALL` só tinha dois destinos possíveis, e os dois
 * erravam: o modo de auto-aprovação de edições não deixa o agente commitar, e
 * `bypass` entrega a máquina inteira.
 *
 * A divisão de responsabilidade é a mesma de sempre: **o worker decide o que
 * conceder**, porque isso é regra de domínio; **o adapter traduz a concessão
 * para os argumentos da CLI dele**, porque isso é vocabulário de ferramenta.
 * Sem ela, ou o worker passaria a escrever `Bash(git:*)` — e a saber o que é
 * Claude Code —, ou cada adapter decidiria sozinho o que "executar qualquer
 * comando" significa, e decidiria diferente.
 *
 * Não existe concessão "todos os comandos". Um agente sem barreira nenhuma é
 * `BYPASS`, que tem porta própria e exige opt-in visível.
 */
export interface PermissionGrant {
  /** O agente pode criar, editar e apagar arquivos no diretório de trabalho. */
  readonly workspaceWrite: boolean;
  readonly commandExecution: CommandGrant;
  /**
   * Prefixos de comando liberados, como se digitados num shell: `git`,
   * `pnpm test`, `node`. Cada adapter converte para o formato dele.
   */
  readonly allowedCommands: readonly string[];
  /** Prefixos recusados mesmo dentro do que foi liberado. */
  readonly deniedCommands: readonly string[];
}

export interface RuntimePermissionPolicy {
  readonly mode: PermissionMode;
  /** Modo nativo do harness, usado quando `mode` é `CONFIGURED`. */
  readonly harnessMode?: string;
  /**
   * A concessão que o adapter traduz em allow-list de ferramenta.
   *
   * Só é lida em `CONFIGURED`: em `DEFAULT` vale o padrão da CLI, e em `BYPASS`
   * não há o que restringir.
   */
  readonly grant?: PermissionGrant;
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
export interface RuntimeEnvironmentPolicy {
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

/**
 * Quanto de rede o Run enxerga.
 *
 * O eixo existe desde a 2A no contrato (`NetworkPolicy`), mas só o modo
 * `DOCKER` consegue impor alguma coisa: no host, um agente com shell alcança a
 * rede inteira independentemente do que o perfil diga. É por isso que a
 * política viaja **resolvida**, com `enforceable` dizendo se ela é barreira ou
 * intenção — a mesma distinção entre "policy requested" e "policy enforced" que
 * a 2B já faz para permissões.
 */
export interface RuntimeNetworkPolicy {
  readonly access: "NONE" | "ALLOWLIST" | "ALL";
  /** Hosts liberados quando `access` é `ALLOWLIST`. */
  readonly allowedHosts?: readonly string[];
}

/**
 * Limites de recurso do container.
 *
 * Ainda **não** têm campo no `ExecutionProfile` do banco (contrato da 2A); vêm
 * da configuração do worker, e existem aqui para que o dia em que virarem campo
 * não exija mexer no backend.
 */
export interface RuntimeResourceLimits {
  /** Fração de CPUs (`--cpus` do Docker). `2` são dois núcleos inteiros. */
  readonly cpus?: number;
  /** Memória em mebibytes. Vira `--memory <n>m`. */
  readonly memoryMb?: number;
  /** Teto de processos (`--pids-limit`). */
  readonly pidsLimit?: number;
}

/** Snapshot do ExecutionProfile congelado no início do Run. */
export interface ExecutionProfileSnapshot {
  readonly id?: string;
  readonly name?: string;
  readonly mode: ExecutionMode;
  readonly workspaceStrategy: WorkspaceStrategy;
  readonly permissionPolicy?: RuntimePermissionPolicy;
  readonly environmentPolicy?: RuntimeEnvironmentPolicy;
  readonly networkPolicy?: RuntimeNetworkPolicy;
  readonly resourceLimits?: RuntimeResourceLimits;
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
