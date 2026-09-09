import { z } from "zod";

import { PageQuerySchema, paginatedSchema } from "./pagination.js";

/**
 * Tool: uma entrada do registro de ferramentas (planejamento v0.4, Fase 8A).
 *
 * Duas espécies, e só duas:
 *
 * - `COMMAND`: um prefixo de argv que o agente pode executar, no mesmo formato
 *   da allow-list do ExecutionProfile (`git add`, nunca `git`). É o que o
 *   Worker soma à concessão de comandos do Run.
 * - `MCP_TOOL`: o nome de uma ferramenta de um servidor MCP do registro. É o
 *   que entra na allow-list por ferramenta dos harnesses que a têm.
 *
 * A distinção fica no `kind`, e não em duas tabelas, porque o Loadout lista as
 * duas juntas e o Run congela as duas do mesmo jeito.
 */

export const TOOL_KIND_VALUES = ["COMMAND", "MCP_TOOL"] as const;

export const ToolKindSchema = z.enum(TOOL_KIND_VALUES).meta({
  id: "ToolKind",
  description:
    "`COMMAND` é um prefixo de argv liberado; `MCP_TOOL` é a ferramenta de um servidor MCP.",
});

export type ToolKind = z.infer<typeof ToolKindSchema>;

export const TOOL_NAME_MAX_LENGTH = 200;
export const TOOL_COMMAND_MAX_LENGTH = 500;
export const TOOL_DESCRIPTION_MAX_LENGTH = 2_000;
export const MCP_TOOL_NAME_MAX_LENGTH = 200;

const NameSchema = z.string().trim().min(1).max(TOOL_NAME_MAX_LENGTH);
const CommandSchema = z
  .string()
  .trim()
  .min(1)
  .max(TOOL_COMMAND_MAX_LENGTH)
  .describe("Prefixo de argv liberado, como `git add`. Sem shell: palavras separadas por espaço.");
const McpToolNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MCP_TOOL_NAME_MAX_LENGTH)
  .describe("O nome da ferramenta como o servidor MCP a anuncia (`search_knowledge`).");
const DescriptionSchema = z.string().max(TOOL_DESCRIPTION_MAX_LENGTH);

export const ToolSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 da Tool."),
    name: z.string().describe("Nome da Tool. Único por usuário."),
    kind: ToolKindSchema,
    command: z.string().nullable().describe("Só em `COMMAND`: o prefixo de argv."),
    mcpServerId: z.uuid().nullable().describe("Só em `MCP_TOOL`: o servidor do registro."),
    toolName: z.string().nullable().describe("Só em `MCP_TOOL`: o nome anunciado pelo servidor."),
    description: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({
    id: "Tool",
    description: "Uma ferramenta do registro: comando liberado ou ferramenta MCP.",
  });

export type Tool = z.infer<typeof ToolSchema>;

const CreateCommandToolSchema = z.object({
  kind: z.literal("COMMAND"),
  name: NameSchema,
  command: CommandSchema,
  description: DescriptionSchema.nullish(),
});

const CreateMcpToolSchema = z.object({
  kind: z.literal("MCP_TOOL"),
  name: NameSchema,
  mcpServerId: z.uuid().describe("Um servidor MCP do registro."),
  toolName: McpToolNameSchema,
  description: DescriptionSchema.nullish(),
});

export const CreateToolSchema = z
  .discriminatedUnion("kind", [CreateCommandToolSchema, CreateMcpToolSchema])
  .meta({
    id: "CreateTool",
    description: "Corpo de `POST /api/v1/tools`. A forma depende de `kind`.",
  });

export type CreateTool = z.infer<typeof CreateToolSchema>;

/**
 * `kind` não muda: trocar a espécie é apagar e criar. Os campos da outra
 * espécie são recusados com `409`, e não ignorados.
 */
export const UpdateToolSchema = z
  .object({
    name: NameSchema.optional(),
    command: CommandSchema.optional(),
    mcpServerId: z.uuid().optional(),
    toolName: McpToolNameSchema.optional(),
    description: DescriptionSchema.nullish(),
  })
  .meta({ id: "UpdateTool", description: "Corpo de `PATCH /api/v1/tools/{id}`." });

export type UpdateTool = z.infer<typeof UpdateToolSchema>;

export const ToolListQuerySchema = PageQuerySchema.extend({
  kind: ToolKindSchema.optional().describe("Só as Tools desta espécie."),
  mcpServerId: z.uuid().optional().describe("Só as ferramentas deste servidor MCP."),
}).meta({ id: "ToolListQuery" });

export type ToolListQuery = z.infer<typeof ToolListQuerySchema>;

export const ToolPageSchema = paginatedSchema(
  ToolSchema,
  "ToolPage",
  "Uma página de Tools, em ordem alfabética.",
);

export type ToolPage = z.infer<typeof ToolPageSchema>;
