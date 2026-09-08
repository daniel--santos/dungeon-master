import { z } from "zod";

/**
 * ExecutionProfile: onde e sob quais regras um Run roda.
 *
 * `mode` e `workspaceStrategy` são **eixos ortogonais** (planejamento v0.4,
 * Fase 2C): worktree não é backend de execução. Um Run pode rodar no host com
 * worktree, no host sobre o diretório atual, ou em Docker com worktree — e a
 * segurança de cada combinação é dita por `enforcement`, não deduzida do modo.
 *
 * Segurança não é booleano (documento técnico, seção 15). `ADVISORY` significa
 * que pedimos e não há barreira técnica; `HARNESS_NATIVE` que a própria CLI
 * aplica; `SANDBOX_ENFORCED` que o ambiente externo limita de fato. A interface
 * mostra a diferença: "política pedida" nunca é exibida como "política imposta".
 */

export const EXECUTION_MODE_VALUES = ["HOST", "DOCKER"] as const;

export const ExecutionModeSchema = z.enum(EXECUTION_MODE_VALUES).meta({
  id: "ExecutionMode",
  description: "`HOST` roda na máquina, sem isolamento. `DOCKER` roda em container.",
});

export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const WORKSPACE_STRATEGY_VALUES = ["CURRENT", "GIT_WORKTREE", "COPY"] as const;

export const WorkspaceStrategySchema = z.enum(WORKSPACE_STRATEGY_VALUES).meta({
  id: "WorkspaceStrategy",
  description: "Isolamento operacional do código: diretório atual, worktree por Run, ou cópia.",
});

export type WorkspaceStrategy = z.infer<typeof WorkspaceStrategySchema>;

export const ENFORCEMENT_LEVEL_VALUES = ["ADVISORY", "HARNESS_NATIVE", "SANDBOX_ENFORCED"] as const;

export const EnforcementLevelSchema = z.enum(ENFORCEMENT_LEVEL_VALUES).meta({
  id: "EnforcementLevel",
  description:
    "Quão forte é a barreira: pedido sem garantia, permissão nativa da CLI, ou sandbox real.",
});

export type EnforcementLevel = z.infer<typeof EnforcementLevelSchema>;

// --------------------------------------------------------------------------
// Políticas
// --------------------------------------------------------------------------

export const COMMAND_ACCESS_VALUES = ["NONE", "ALLOWLIST", "ALL"] as const;

export const CommandAccessSchema = z
  .enum(COMMAND_ACCESS_VALUES)
  .meta({ id: "CommandAccess", description: "Quais comandos o agente pode executar." });

export type CommandAccess = z.infer<typeof CommandAccessSchema>;

/**
 * Os comandos que um Run recebe por padrão quando a política libera execução.
 *
 * São **subcomandos**, e não o programa inteiro: `git add` e `git commit`, nunca
 * `git`. A diferença é `git push` e `git reset --hard`, que uma tarefa de código
 * autônoma não precisa e que ninguém quer descobrir depois que aconteceram.
 *
 * A lista é o mínimo que faz uma tarefa terminar: sem poder commitar, o agente
 * edita o arquivo e reporta `blocked`. Ler o repositório é assunto das
 * ferramentas de leitura do harness, não do shell, então `ls` e `cat` ficam de
 * fora — quem os quiser acrescenta em `allowedCommands`, e a escolha fica
 * visível no perfil.
 *
 * Verificado com o Claude Code 2.1.263: com estes cinco prefixos, "crie um
 * arquivo e faça commit" termina sem nenhuma permissão negada.
 */
export const DEFAULT_TRUSTED_COMMANDS: readonly string[] = [
  "git add",
  "git commit",
  "git status",
  "git diff",
  "git log",
];

export const PermissionPolicySchema = z
  .object({
    workspaceWrite: z.boolean().describe("O agente pode escrever no workspace."),
    commandExecution: CommandAccessSchema,
    allowedCommands: z
      .array(z.string())
      .describe("Comandos liberados quando `commandExecution` é `ALLOWLIST`."),
    deniedCommands: z.array(z.string()).describe("Comandos recusados mesmo em `ALL`."),
    allowUnsafeBypass: z
      .boolean()
      .optional()
      .describe(
        "Autoriza desligar as checagens da CLI (`bypass`) fora de um ambiente com " +
          "isolamento imposto. Opt-in visível e nunca o padrão: sem ele, " +
          "`commandExecution: ALL` em `HOST` vira o modo de auto-aprovação nativo do " +
          "harness, e não bypass. Ligado, o Run registra um `Diagnostic` e uma linha " +
          "de diário dizendo que rodou sem barreira.",
      ),
  })
  .meta({
    id: "PermissionPolicy",
    description: "O que o agente pode fazer. O quanto disso é imposto depende de `enforcement`.",
  });

export type PermissionPolicy = z.infer<typeof PermissionPolicySchema>;

/**
 * Allow-list de variáveis de ambiente.
 *
 * É allow-list e não deny-list porque o processo do worker carrega o ambiente
 * inteiro do usuário, incluindo tokens que não têm nada a ver com o Run. Uma
 * lista de negação erra por omissão: a variável de segredo que ninguém lembrou
 * de negar vaza para o agente.
 */
export const EnvironmentPolicySchema = z
  .object({
    allowedVariables: z
      .array(z.string())
      .describe("Nomes de variáveis do ambiente do worker repassadas ao processo do agente."),
    inheritPath: z
      .boolean()
      .describe("Repassa `PATH`. Sem ele o harness não encontra as ferramentas dele."),
  })
  .meta({
    id: "EnvironmentPolicy",
    description: "Allow-list de variáveis de ambiente. O que não está aqui não chega ao agente.",
  });

export type EnvironmentPolicy = z.infer<typeof EnvironmentPolicySchema>;

export const NETWORK_ACCESS_VALUES = ["NONE", "ALLOWLIST", "ALL"] as const;

export const NetworkAccessSchema = z
  .enum(NETWORK_ACCESS_VALUES)
  .meta({ id: "NetworkAccess", description: "Quanto de rede o Run enxerga." });

export type NetworkAccess = z.infer<typeof NetworkAccessSchema>;

export const NetworkPolicySchema = z
  .object({
    access: NetworkAccessSchema,
    allowedHosts: z.array(z.string()).describe("Hosts liberados quando `access` é `ALLOWLIST`."),
  })
  .meta({
    id: "NetworkPolicy",
    description: "Política de rede. Só é imposta de fato em `SANDBOX_ENFORCED`.",
  });

export type NetworkPolicy = z.infer<typeof NetworkPolicySchema>;

// --------------------------------------------------------------------------
// O perfil
// --------------------------------------------------------------------------

export const EXECUTION_PROFILE_NAME_MAX_LENGTH = 200;

const NameSchema = z.string().trim().min(1).max(EXECUTION_PROFILE_NAME_MAX_LENGTH);

export const ExecutionProfileSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do ExecutionProfile."),
    name: z.string().describe("Nome do perfil. Único por usuário."),
    mode: ExecutionModeSchema,
    workspaceStrategy: WorkspaceStrategySchema,
    enforcement: EnforcementLevelSchema,
    permissionPolicy: PermissionPolicySchema,
    environmentPolicy: EnvironmentPolicySchema,
    networkPolicy: NetworkPolicySchema,
    enabled: z
      .boolean()
      .describe(
        "Perfil desligado não pode ser escolhido por um Run novo. " +
          "O perfil Docker nasce desligado e é ligado na Fase 2C.",
      ),
    isDefault: z.boolean().describe("Escolhido quando o Run não indica um perfil."),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "ExecutionProfile", description: "Onde e sob quais regras um Run roda." });

export type ExecutionProfile = z.infer<typeof ExecutionProfileSchema>;

export const CreateExecutionProfileSchema = z
  .object({
    name: NameSchema,
    mode: ExecutionModeSchema,
    workspaceStrategy: WorkspaceStrategySchema,
    enforcement: EnforcementLevelSchema,
    permissionPolicy: PermissionPolicySchema.optional().describe(
      "Padrão: escrita no workspace liberada, comandos por allow-list vazia.",
    ),
    environmentPolicy: EnvironmentPolicySchema.optional().describe(
      "Padrão: nenhuma variável repassada além de `PATH`.",
    ),
    networkPolicy: NetworkPolicySchema.optional().describe("Padrão: rede liberada."),
    enabled: z.boolean().optional().describe("Padrão: ligado."),
    isDefault: z.boolean().optional(),
  })
  .meta({
    id: "CreateExecutionProfile",
    description: "Corpo de `POST /api/v1/execution-profiles`.",
  });

export type CreateExecutionProfile = z.infer<typeof CreateExecutionProfileSchema>;

export const UpdateExecutionProfileSchema = z
  .object({
    name: NameSchema.optional(),
    mode: ExecutionModeSchema.optional(),
    workspaceStrategy: WorkspaceStrategySchema.optional(),
    enforcement: EnforcementLevelSchema.optional(),
    permissionPolicy: PermissionPolicySchema.optional(),
    environmentPolicy: EnvironmentPolicySchema.optional(),
    networkPolicy: NetworkPolicySchema.optional(),
    enabled: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  })
  .meta({
    id: "UpdateExecutionProfile",
    description: "Corpo de `PATCH /api/v1/execution-profiles/{id}`.",
  });

export type UpdateExecutionProfile = z.infer<typeof UpdateExecutionProfileSchema>;

export const ExecutionProfileListSchema = z
  .object({
    items: z.array(ExecutionProfileSchema).describe("Os perfis, em ordem alfabética."),
  })
  .meta({ id: "ExecutionProfileList", description: "O cadastro de ExecutionProfiles." });

export type ExecutionProfileList = z.infer<typeof ExecutionProfileListSchema>;

/**
 * A cópia congelada do perfil, guardada no Run.
 *
 * Sem o congelamento, editar um perfil reescreveria a história: um Run de
 * ontem passaria a dizer que rodou com a política de hoje. O snapshot carrega
 * o `id` para dar rastro, mas o que vale para auditoria é o corpo.
 */
export const ExecutionProfileSnapshotSchema = z
  .object({
    executionProfileId: z.uuid(),
    name: z.string(),
    mode: ExecutionModeSchema,
    workspaceStrategy: WorkspaceStrategySchema,
    enforcement: EnforcementLevelSchema,
    permissionPolicy: PermissionPolicySchema,
    environmentPolicy: EnvironmentPolicySchema,
    networkPolicy: NetworkPolicySchema,
    capturedAt: z.iso.datetime().describe("Instante da captura, em UTC (ISO 8601)."),
  })
  .meta({
    id: "ExecutionProfileSnapshot",
    description: "O ExecutionProfile como estava quando o Run foi criado.",
  });

export type ExecutionProfileSnapshot = z.infer<typeof ExecutionProfileSnapshotSchema>;
