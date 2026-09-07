import { z } from "zod";

/**
 * Agent é o Herói: papel e comportamento, independentes de ferramenta e de
 * modelo (documento técnico, seção 5.2).
 *
 * O que um Agent guarda é a instrução do papel — "você é um arquiteto sênior,
 * planeje antes de escrever" —, e é isso que o Loadout congela no Run. Trocar o
 * harness ou o modelo não redefine o papel, que é justamente o ponto da
 * separação.
 */

export const AGENT_ROLE_VALUES = ["ARCHITECT", "ENGINEER", "REVIEWER", "EXPLORER"] as const;

export const AgentRoleSchema = z
  .enum(AGENT_ROLE_VALUES)
  .meta({ id: "AgentRole", description: "O papel do Agent. Classe, no tema." });

export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const AGENT_NAME_MAX_LENGTH = 200;
export const AGENT_DESCRIPTION_MAX_LENGTH = 2_000;
export const AGENT_INSTRUCTIONS_MAX_LENGTH = 20_000;

const NameSchema = z.string().trim().min(1).max(AGENT_NAME_MAX_LENGTH);
const DescriptionSchema = z.string().max(AGENT_DESCRIPTION_MAX_LENGTH);
const InstructionsSchema = z.string().trim().min(1).max(AGENT_INSTRUCTIONS_MAX_LENGTH);

export const AgentSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do Agent."),
    name: z.string().describe("Nome do Agent. Único por usuário."),
    role: AgentRoleSchema,
    instructions: z.string().describe("O texto do papel, injetado no prompt do Run."),
    description: z.string().nullable().describe("Nota livre para quem escolhe o Agent."),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Agent", description: "Papel e comportamento, sem ferramenta nem modelo." });

export type Agent = z.infer<typeof AgentSchema>;

export const CreateAgentSchema = z
  .object({
    name: NameSchema,
    role: AgentRoleSchema,
    instructions: InstructionsSchema.describe("O texto do papel."),
    description: DescriptionSchema.nullish(),
  })
  .meta({ id: "CreateAgent", description: "Corpo de `POST /api/v1/agents`." });

export type CreateAgent = z.infer<typeof CreateAgentSchema>;

export const UpdateAgentSchema = z
  .object({
    name: NameSchema.optional(),
    role: AgentRoleSchema.optional(),
    instructions: InstructionsSchema.optional(),
    description: DescriptionSchema.nullish(),
  })
  .meta({ id: "UpdateAgent", description: "Corpo de `PATCH /api/v1/agents/{id}`." });

export type UpdateAgent = z.infer<typeof UpdateAgentSchema>;

export const AgentListSchema = z
  .object({
    items: z.array(AgentSchema).describe("Os Agents, em ordem alfabética."),
  })
  .meta({ id: "AgentList", description: "O cadastro de Agents." });

export type AgentList = z.infer<typeof AgentListSchema>;
