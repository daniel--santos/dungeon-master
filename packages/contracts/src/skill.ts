import { z } from "zod";

import { PageQuerySchema, paginatedSchema } from "./pagination.js";

/**
 * Skill: instruções em markdown que um Loadout oferece ao agente (planejamento
 * v0.4, Fase 8A).
 *
 * É **dado versionado, não código**. O registro (`Skill`) tem nome e descrição
 * e muda de lugar; o conteúdo mora em versões imutáveis (`SkillVersion`),
 * numeradas a partir de 1 e só acrescentadas — publicar uma versão nova nunca
 * reescreve a anterior. É isso que permite ao Loadout **pinar** uma versão e a
 * um Run antigo continuar dizendo exatamente que texto o agente recebeu.
 */

export const SKILL_NAME_MAX_LENGTH = 200;
export const SKILL_DESCRIPTION_MAX_LENGTH = 2_000;
export const SKILL_CONTENT_MAX_LENGTH = 100_000;
export const SKILL_CHANGELOG_MAX_LENGTH = 2_000;

const NameSchema = z.string().trim().min(1).max(SKILL_NAME_MAX_LENGTH);
const DescriptionSchema = z.string().max(SKILL_DESCRIPTION_MAX_LENGTH);
const ContentSchema = z.string().max(SKILL_CONTENT_MAX_LENGTH);
const ChangelogSchema = z.string().max(SKILL_CHANGELOG_MAX_LENGTH);

export const SkillVersionSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 da versão."),
    skillId: z.uuid(),
    version: z.number().int().positive().describe("Número sequencial, a partir de 1. Imutável."),
    content: z.string().describe("O markdown que o agente recebe."),
    changelog: z.string().nullable().describe("O que mudou nesta versão, para quem escolhe o pin."),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "SkillVersion", description: "Uma versão imutável do conteúdo de uma Skill." });

export type SkillVersion = z.infer<typeof SkillVersionSchema>;

export const SkillSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 da Skill."),
    name: z.string().describe("Nome da Skill. Único por usuário."),
    description: z.string().nullable().describe("Nota livre para quem monta o Loadout."),
    latestVersion: z
      .number()
      .int()
      .positive()
      .describe("A versão mais recente. É a efetiva quando o Loadout não pina nenhuma."),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Skill", description: "Instruções versionadas oferecidas ao agente." });

export type Skill = z.infer<typeof SkillSchema>;

export const SkillDetailSchema = SkillSchema.extend({
  latest: SkillVersionSchema.describe("A versão mais recente, com o conteúdo."),
}).meta({ id: "SkillDetail", description: "A Skill com a versão mais recente resolvida." });

export type SkillDetail = z.infer<typeof SkillDetailSchema>;

export const CreateSkillSchema = z
  .object({
    name: NameSchema,
    description: DescriptionSchema.nullish(),
    content: ContentSchema.optional().describe("O conteúdo da versão 1. Padrão: vazio."),
    changelog: ChangelogSchema.nullish().describe("Nota da versão 1."),
  })
  .meta({ id: "CreateSkill", description: "Corpo de `POST /api/v1/skills`. Nasce na versão 1." });

export type CreateSkill = z.infer<typeof CreateSkillSchema>;

/**
 * Só nome e descrição. O conteúdo não se edita: publica-se uma versão nova em
 * `POST /api/v1/skills/{id}/versions`.
 */
export const UpdateSkillSchema = z
  .object({
    name: NameSchema.optional(),
    description: DescriptionSchema.nullish(),
  })
  .meta({ id: "UpdateSkill", description: "Corpo de `PATCH /api/v1/skills/{id}`." });

export type UpdateSkill = z.infer<typeof UpdateSkillSchema>;

export const PublishSkillVersionSchema = z
  .object({
    content: ContentSchema,
    changelog: ChangelogSchema.nullish(),
    expectedLatestVersion: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "CAS opcional: recusa com `409` se a versão mais recente já não for esta. Quem " +
          "edita a partir de uma versão que leu não sobrescreve o que outra aba publicou.",
      ),
  })
  .meta({
    id: "PublishSkillVersion",
    description:
      "Corpo de `POST /api/v1/skills/{id}/versions`. Append-only: cria a versão seguinte.",
  });

export type PublishSkillVersion = z.infer<typeof PublishSkillVersionSchema>;

export const SkillListQuerySchema = PageQuerySchema.meta({ id: "SkillListQuery" });

export type SkillListQuery = z.infer<typeof SkillListQuerySchema>;

export const SkillPageSchema = paginatedSchema(
  SkillSchema,
  "SkillPage",
  "Uma página de Skills, em ordem alfabética.",
);

export type SkillPage = z.infer<typeof SkillPageSchema>;

export const SkillVersionListQuerySchema = PageQuerySchema.meta({ id: "SkillVersionListQuery" });

export type SkillVersionListQuery = z.infer<typeof SkillVersionListQuerySchema>;

export const SkillVersionPageSchema = paginatedSchema(
  SkillVersionSchema,
  "SkillVersionPage",
  "Uma página de versões, da mais recente para a mais antiga.",
);

export type SkillVersionPage = z.infer<typeof SkillVersionPageSchema>;
