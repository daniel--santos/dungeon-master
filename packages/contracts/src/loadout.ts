import { z } from "zod";

import { AgentRoleSchema } from "./agent.js";
import { HarnessCapabilitiesSchema, HarnessKeySchema } from "./harness.js";

/**
 * Loadout é o Equipamento: a configuração completa dada a um agente para
 * executar uma tarefa (documento técnico, seção 6).
 *
 * É o que torna uma execução reproduzível: Agent, Harness, Model, skills,
 * ferramentas, servidores MCP, política de conhecimento, política de contexto e
 * ExecutionProfile num objeto só. O Run guarda um snapshot dele, e por isso
 * `version` existe — um Run antigo diz qual versão do equipamento usou, mesmo
 * depois de o equipamento ter mudado dez vezes.
 *
 * Skills, tools e MCP viram registries versionados na Fase 8. Aqui eles são
 * listas de nomes, que é o que a Fase 2 sabe entregar ao harness.
 */

export const LOADOUT_NAME_MAX_LENGTH = 200;

const NameSchema = z.string().trim().min(1).max(LOADOUT_NAME_MAX_LENGTH);

export const MCP_TRANSPORT_VALUES = ["STDIO", "HTTP"] as const;

export const McpTransportSchema = z
  .enum(MCP_TRANSPORT_VALUES)
  .meta({ id: "McpTransport", description: "Como o servidor MCP é alcançado." });

export type McpTransport = z.infer<typeof McpTransportSchema>;

export const McpServerRefSchema = z
  .object({
    name: z.string().describe("Nome pelo qual o harness registra o servidor."),
    transport: McpTransportSchema,
    target: z
      .string()
      .describe("Comando, para `STDIO`; URL, para `HTTP`. Nunca montado por concatenação."),
  })
  .meta({ id: "McpServerRef", description: "Um servidor MCP oferecido ao agente." });

export type McpServerRef = z.infer<typeof McpServerRefSchema>;

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

export const LoadoutSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do Loadout."),
    name: z.string().describe("Nome do Loadout. Único por usuário."),
    agentId: z.uuid(),
    harnessId: z.uuid(),
    modelId: z.uuid().nullable().describe("Nulo usa o Model padrão do Harness."),
    executionProfileId: z.uuid(),
    skills: z.array(z.string()).describe("Nomes de skills oferecidas ao agente."),
    tools: z.array(z.string()).describe("Nomes de ferramentas liberadas."),
    mcpServers: z.array(McpServerRefSchema),
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

export const CreateLoadoutSchema = z
  .object({
    name: NameSchema,
    agentId: z.uuid(),
    harnessId: z.uuid(),
    modelId: z.uuid().nullish().describe("Nulo usa o Model padrão do Harness."),
    executionProfileId: z.uuid(),
    skills: z.array(z.string()).optional().describe("Padrão: vazio."),
    tools: z.array(z.string()).optional().describe("Padrão: vazio."),
    mcpServers: z.array(McpServerRefSchema).optional().describe("Padrão: vazio."),
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
    skills: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    mcpServers: z.array(McpServerRefSchema).optional(),
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

/**
 * A cópia congelada do Loadout, guardada no Run.
 *
 * Traz o Agent, o Harness e o Model **resolvidos**, e não só os ids: o Run
 * precisa continuar legível depois de alguém apagar o Agent, e as instruções do
 * papel são exatamente o que foi enviado ao harness naquele dia.
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
    skills: z.array(z.string()),
    tools: z.array(z.string()),
    mcpServers: z.array(McpServerRefSchema),
    knowledgePolicy: KnowledgePolicySchema,
    contextPolicy: ContextPolicySchema,
    capturedAt: z.iso.datetime().describe("Instante da captura, em UTC (ISO 8601)."),
  })
  .meta({
    id: "LoadoutSnapshot",
    description: "O Loadout como estava quando o Run foi criado, com Agent e Harness resolvidos.",
  });

export type LoadoutSnapshot = z.infer<typeof LoadoutSnapshotSchema>;
