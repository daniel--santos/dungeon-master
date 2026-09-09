import { z } from "zod";

import { AgentRoleSchema } from "./agent.js";
import { HarnessCapabilitiesSchema, HarnessKeySchema } from "./harness.js";
import { McpServerNameSchema, McpTransportSchema, urlWithoutUserInfo } from "./mcp-server.js";
import { PageQuerySchema, paginatedSchema } from "./pagination.js";
import { ToolKindSchema } from "./tool.js";

/**
 * Loadout é o Equipamento: a configuração completa dada a um agente para
 * executar uma tarefa (documento técnico, seção 6).
 *
 * É o que torna uma execução reproduzível: Agent, Harness, Model, Skills,
 * Tools, servidores MCP, política de conhecimento, política de contexto e
 * ExecutionProfile num objeto só. O Run guarda um snapshot dele, e por isso
 * `version` existe — um Run antigo diz qual versão do equipamento usou, mesmo
 * depois de o equipamento ter mudado dez vezes.
 *
 * Desde a Fase 8A, Skills, Tools e servidores MCP são **referências** a
 * registros versionados (`skillRefs`, `toolRefs`, `mcpServerRefs`), e cada
 * versão do Loadout fica guardada em `LoadoutVersion`. As listas de nomes
 * (`skills`, `tools`) e a forma inline (`mcpServers`) continuam na resposta
 * como **forma curta derivada** das referências, para a interface da Fase 7
 * seguir funcionando até a 8C trocá-la; na escrita elas ainda são aceitas e
 * resolvidas pelo nome.
 */

export const LOADOUT_NAME_MAX_LENGTH = 200;

const NameSchema = z.string().trim().min(1).max(LOADOUT_NAME_MAX_LENGTH);

/**
 * A forma curta de um servidor MCP: o que o Loadout carregava inline até a
 * Fase 7 e o que o snapshot do Run continua carregando, agora como base de
 * `McpServerSnapshot`. `target` é o comando com os argumentos numa string só
 * (`STDIO`) ou a URL (`HTTP`).
 */
export const McpServerRefSchema = z
  .object({
    name: z.string().describe("Nome pelo qual o harness registra o servidor."),
    transport: McpTransportSchema,
    target: z
      .string()
      .describe("Comando, para `STDIO`; URL, para `HTTP`. Nunca montado por concatenação."),
  })
  .meta({
    id: "McpServerRef",
    description: "Um servidor MCP oferecido ao agente, na forma curta.",
  });

export type McpServerRef = z.infer<typeof McpServerRefSchema>;

/**
 * A forma curta na **escrita**: o mesmo `McpServerRef`, com o nome no padrão
 * que as CLIs aceitam e sem credencial na URL — as duas regras que o registro
 * impõe na criação por id, aplicadas aqui antes de criar pelo nome.
 */
export const McpServerInputSchema = z
  .object({
    name: McpServerNameSchema,
    transport: McpTransportSchema,
    target: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .describe("Comando com argumentos, para `STDIO`; URL, para `HTTP`."),
  })
  .refine((ref) => ref.transport !== "HTTP" || urlWithoutUserInfo(ref.target), {
    path: ["target"],
    message: "A URL não pode carregar `usuário:senha@`: ela vai inteira à linha de comando.",
  })
  .meta({ id: "McpServerInput", description: "Um servidor MCP na forma curta, para escrita." });

export type McpServerInput = z.infer<typeof McpServerInputSchema>;

export const KnowledgePolicySchema = z
  .object({
    includeProjectSummary: z.boolean().describe("Injeta o resumo do Project no contexto."),
    includeDecisions: z.boolean().describe("Injeta as decisões registradas do Project."),
    maxItems: z
      .number()
      .int()
      .nonnegative()
      .describe("Teto de itens de conhecimento injetados. `0` desliga."),
  })
  .meta({
    id: "KnowledgePolicy",
    description: "Quanto do Grimório do Project entra no contexto. Efetiva a partir da Fase 6.",
  });

export type KnowledgePolicy = z.infer<typeof KnowledgePolicySchema>;

export const ContextPolicySchema = z
  .object({
    includeParentContext: z.boolean().describe("Inclui título e resumo da Task mãe."),
    includeDependencyContext: z.boolean().describe("Inclui o resultado das dependências."),
    maxTokens: z
      .number()
      .int()
      .nonnegative()
      .describe("Orçamento de contexto. `0` significa sem teto declarado."),
  })
  .meta({
    id: "ContextPolicy",
    description: "O que o Context Assembler monta. Efetiva a partir da Fase 7.",
  });

export type ContextPolicy = z.infer<typeof ContextPolicySchema>;

// --------------------------------------------------------------------------
// Referências (Fase 8A)
// --------------------------------------------------------------------------

export const LoadoutSkillRefSchema = z
  .object({
    skillId: z.uuid(),
    name: z.string().describe("Nome da Skill no momento da leitura."),
    pinnedVersion: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe("A versão pinada. Nulo usa a mais recente na hora de congelar o Run."),
    latestVersion: z.number().int().positive().describe("A mais recente publicada."),
  })
  .meta({ id: "LoadoutSkillRef", description: "Uma Skill referenciada, com o pin." });

export type LoadoutSkillRef = z.infer<typeof LoadoutSkillRefSchema>;

export const LoadoutToolRefSchema = z
  .object({
    toolId: z.uuid(),
    name: z.string(),
    kind: ToolKindSchema,
  })
  .meta({ id: "LoadoutToolRef", description: "Uma Tool referenciada." });

export type LoadoutToolRef = z.infer<typeof LoadoutToolRefSchema>;

export const LoadoutMcpServerRefSchema = z
  .object({
    mcpServerId: z.uuid(),
    name: z.string(),
    transport: McpTransportSchema,
    builtIn: z.boolean(),
  })
  .meta({ id: "LoadoutMcpServerRef", description: "Um servidor MCP referenciado." });

export type LoadoutMcpServerRef = z.infer<typeof LoadoutMcpServerRefSchema>;

/** O que a escrita recebe para pinar uma Skill. */
export const SkillPinSchema = z
  .object({
    skillId: z.uuid(),
    pinnedVersion: z
      .number()
      .int()
      .positive()
      .nullish()
      .describe("Ausente ou nulo segue a versão mais recente."),
  })
  .meta({ id: "SkillPin", description: "Uma Skill a referenciar, com ou sem pin." });

export type SkillPin = z.infer<typeof SkillPinSchema>;

export const LoadoutSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do Loadout."),
    name: z.string().describe("Nome do Loadout. Único por usuário."),
    agentId: z.uuid(),
    harnessId: z.uuid(),
    modelId: z.uuid().nullable().describe("Nulo usa o Model padrão do Harness."),
    executionProfileId: z.uuid(),
    skillRefs: z.array(LoadoutSkillRefSchema).describe("As Skills, na ordem do Loadout."),
    toolRefs: z.array(LoadoutToolRefSchema).describe("As Tools, na ordem do Loadout."),
    mcpServerRefs: z
      .array(LoadoutMcpServerRefSchema)
      .describe("Os servidores MCP, na ordem do Loadout."),
    skills: z
      .array(z.string())
      .describe("Forma curta: os nomes das Skills de `skillRefs`, na mesma ordem."),
    tools: z.array(z.string()).describe("Forma curta: os nomes das Tools de `toolRefs`."),
    mcpServers: z
      .array(McpServerRefSchema)
      .describe("Forma curta: os servidores de `mcpServerRefs`, com comando e argumentos juntos."),
    knowledgePolicy: KnowledgePolicySchema,
    contextPolicy: ContextPolicySchema,
    version: z
      .number()
      .int()
      .positive()
      .describe("Sobe em toda edição. É o número que o Run guarda junto do snapshot."),
    isDefault: z.boolean().describe("Sugerido quando a Task não indica um Loadout."),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Loadout", description: "A configuração completa de uma execução." });

export type Loadout = z.infer<typeof LoadoutSchema>;

/**
 * As duas formas de escrever as referências.
 *
 * A forma por id (`skillRefs`, `toolIds`, `mcpServerIds`) é a da Fase 8. A
 * forma curta (`skills`, `tools`, `mcpServers`) é a que o formulário da Fase 7
 * envia e é resolvida pelo nome: uma Skill ou Tool que não existe é criada
 * (Skill com conteúdo vazio na versão 1; Tool como `COMMAND`), exatamente
 * como a migração de dados fez com o que já estava gravado. Mandar as duas
 * formas para a mesma coleção é recusado com `409`.
 */
const ReferenceInputShape = {
  skillRefs: z.array(SkillPinSchema).optional().describe("Skills por id, com pin opcional."),
  toolIds: z.array(z.uuid()).optional().describe("Tools por id."),
  mcpServerIds: z.array(z.uuid()).optional().describe("Servidores MCP por id."),
  skills: z
    .array(z.string().trim().min(1).max(200))
    .optional()
    .describe("Forma curta: nomes de Skills, resolvidos ou criados pelo nome."),
  tools: z
    .array(z.string().trim().min(1).max(200))
    .optional()
    .describe("Forma curta: nomes de Tools, resolvidos ou criados pelo nome como `COMMAND`."),
  mcpServers: z
    .array(McpServerInputSchema)
    .optional()
    .describe("Forma curta: servidores inline, resolvidos ou criados pelo nome."),
};

export const CreateLoadoutSchema = z
  .object({
    name: NameSchema,
    agentId: z.uuid(),
    harnessId: z.uuid(),
    modelId: z.uuid().nullish().describe("Nulo usa o Model padrão do Harness."),
    executionProfileId: z.uuid(),
    ...ReferenceInputShape,
    knowledgePolicy: KnowledgePolicySchema.optional(),
    contextPolicy: ContextPolicySchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .meta({ id: "CreateLoadout", description: "Corpo de `POST /api/v1/loadouts`. Nasce em `v1`." });

export type CreateLoadout = z.infer<typeof CreateLoadoutSchema>;

export const UpdateLoadoutSchema = z
  .object({
    name: NameSchema.optional(),
    agentId: z.uuid().optional(),
    harnessId: z.uuid().optional(),
    modelId: z.uuid().nullish(),
    executionProfileId: z.uuid().optional(),
    ...ReferenceInputShape,
    knowledgePolicy: KnowledgePolicySchema.optional(),
    contextPolicy: ContextPolicySchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .meta({
    id: "UpdateLoadout",
    description:
      "Corpo de `PATCH /api/v1/loadouts/{id}`. Toda edição que muda algo incrementa `version`.",
  });

export type UpdateLoadout = z.infer<typeof UpdateLoadoutSchema>;

export const LoadoutListSchema = z
  .object({
    items: z.array(LoadoutSchema).describe("Os Loadouts, em ordem alfabética."),
  })
  .meta({ id: "LoadoutList", description: "O cadastro de Loadouts." });

export type LoadoutList = z.infer<typeof LoadoutListSchema>;

// --------------------------------------------------------------------------
// Versões (Fase 8A)
// --------------------------------------------------------------------------

/**
 * A definição de um Loadout numa versão: só referências, nunca conteúdo.
 *
 * É o que `POST /loadouts/{id}/versions/{n}/restore` reaplica. Referências, e
 * não o snapshot resolvido, porque restaurar significa "apontar de novo para
 * estas Skills com estes pins" — a Skill continua a mesma entidade viva, com as
 * versões que ganhou desde então.
 */
export const LoadoutDefinitionSchema = z
  .object({
    name: z.string(),
    agentId: z.uuid(),
    harnessId: z.uuid(),
    modelId: z.uuid().nullable(),
    executionProfileId: z.uuid(),
    skillRefs: z.array(
      z.object({ skillId: z.uuid(), pinnedVersion: z.number().int().positive().nullable() }),
    ),
    toolIds: z.array(z.uuid()),
    mcpServerIds: z.array(z.uuid()),
    knowledgePolicy: KnowledgePolicySchema,
    contextPolicy: ContextPolicySchema,
    isDefault: z.boolean(),
  })
  .meta({ id: "LoadoutDefinition", description: "O Loadout numa versão, só por referências." });

export type LoadoutDefinition = z.infer<typeof LoadoutDefinitionSchema>;

export const LoadoutVersionSchema = z
  .object({
    id: z.uuid(),
    loadoutId: z.uuid(),
    version: z.number().int().positive(),
    definition: LoadoutDefinitionSchema,
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "LoadoutVersion", description: "Uma versão guardada do Loadout. Imutável." });

export type LoadoutVersion = z.infer<typeof LoadoutVersionSchema>;

export const LoadoutVersionListQuerySchema = PageQuerySchema.meta({
  id: "LoadoutVersionListQuery",
});

export type LoadoutVersionListQuery = z.infer<typeof LoadoutVersionListQuerySchema>;

export const LoadoutVersionPageSchema = paginatedSchema(
  LoadoutVersionSchema,
  "LoadoutVersionPage",
  "Uma página de versões do Loadout, da mais recente para a mais antiga.",
);

export type LoadoutVersionPage = z.infer<typeof LoadoutVersionPageSchema>;

// --------------------------------------------------------------------------
// Snapshot (o que o Run congela)
// --------------------------------------------------------------------------

export const SkillVersionSnapshotSchema = z
  .object({
    skillId: z.uuid(),
    name: z.string(),
    version: z.number().int().positive().describe("A versão efetiva: a pinada, ou a mais recente."),
    pinned: z.boolean().describe("Verdadeiro quando o Loadout pinava esta versão."),
    content: z.string().describe("O markdown exatamente como foi congelado."),
  })
  .meta({
    id: "SkillVersionSnapshot",
    description: "Uma Skill resolvida na versão efetiva, com o conteúdo.",
  });

export type SkillVersionSnapshot = z.infer<typeof SkillVersionSnapshotSchema>;

export const ToolSnapshotSchema = z
  .object({
    toolId: z.uuid(),
    name: z.string(),
    kind: ToolKindSchema,
    command: z.string().nullable().describe("Só em `COMMAND`."),
    mcpServerName: z.string().nullable().describe("Só em `MCP_TOOL`: o nome do servidor."),
    toolName: z.string().nullable().describe("Só em `MCP_TOOL`."),
  })
  .meta({ id: "ToolSnapshot", description: "Uma Tool resolvida, com a definição." });

export type ToolSnapshot = z.infer<typeof ToolSnapshotSchema>;

/**
 * Um servidor MCP no snapshot: a forma curta mais a definição do registro.
 *
 * Os campos novos são opcionais porque Runs anteriores à Fase 8 só têm a forma
 * curta. Um consumidor que encontra `command` usa `command` e `args`; sem
 * eles, quebra `target` por espaço, como a Fase 7 fazia.
 */
export const McpServerSnapshotSchema = McpServerRefSchema.extend({
  mcpServerId: z.uuid().optional(),
  command: z.string().nullable().optional().describe("Só em `STDIO`."),
  args: z.array(z.string()).optional().describe("Só em `STDIO`."),
  url: z.string().nullable().optional().describe("Só em `HTTP`."),
  envKeys: z.array(z.string()).optional().describe("Nomes de variáveis; nunca valores."),
  readOnly: z.boolean().optional(),
  builtIn: z.boolean().optional().describe("O Worker é quem sabe subi-lo."),
}).meta({
  id: "McpServerSnapshot",
  description: "Um servidor MCP congelado no Run, com a forma curta e a definição.",
});

export type McpServerSnapshot = z.infer<typeof McpServerSnapshotSchema>;

/**
 * A cópia congelada do Loadout, guardada no Run.
 *
 * Traz o Agent, o Harness e o Model **resolvidos**, e não só os ids: o Run
 * precisa continuar legível depois de alguém apagar o Agent, e as instruções do
 * papel são exatamente o que foi enviado ao harness naquele dia. Desde a Fase
 * 8A o mesmo vale para as Skills (conteúdo da versão efetiva), as Tools e os
 * servidores MCP. `skillVersions` e `toolDefinitions` são opcionais só porque
 * Runs anteriores à Fase 8 não os têm; todo Run novo os carrega.
 */
export const LoadoutSnapshotSchema = z
  .object({
    loadoutId: z.uuid(),
    name: z.string(),
    version: z.number().int().positive(),
    agent: z.object({
      id: z.uuid(),
      name: z.string(),
      role: AgentRoleSchema,
      instructions: z.string(),
    }),
    harness: z.object({
      id: z.uuid(),
      key: HarnessKeySchema,
      name: z.string(),
      capabilities: HarnessCapabilitiesSchema,
    }),
    model: z
      .object({ id: z.uuid(), key: z.string(), name: z.string() })
      .nullable()
      .describe("Nulo quando o Harness não tinha Model padrão nem o Loadout indicava um."),
    executionProfileId: z.uuid(),
    skills: z.array(z.string()).describe("Os nomes das Skills, na ordem do Loadout."),
    tools: z.array(z.string()).describe("Os nomes das Tools, na ordem do Loadout."),
    mcpServers: z.array(McpServerSnapshotSchema),
    skillVersions: z
      .array(SkillVersionSnapshotSchema)
      .optional()
      .describe("As Skills resolvidas, com conteúdo. Ausente em Runs anteriores à Fase 8."),
    toolDefinitions: z
      .array(ToolSnapshotSchema)
      .optional()
      .describe("As Tools resolvidas. Ausente em Runs anteriores à Fase 8."),
    knowledgePolicy: KnowledgePolicySchema,
    contextPolicy: ContextPolicySchema,
    capturedAt: z.iso.datetime().describe("Instante da captura, em UTC (ISO 8601)."),
  })
  .meta({
    id: "LoadoutSnapshot",
    description: "O Loadout como estava quando o Run foi criado, com tudo resolvido.",
  });

export type LoadoutSnapshot = z.infer<typeof LoadoutSnapshotSchema>;
