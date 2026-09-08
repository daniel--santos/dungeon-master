import { z } from "zod";

import { ConditionSchema } from "./condition.js";

/**
 * Definição de Conquista (planejamento v0.4, Fase 2.5A).
 *
 * Nome e descrição existem em duas versões, `theme` e `plain`, para acompanhar
 * o interruptor de tema. O texto de sabor é só do tema: com o tema desligado
 * ele fica oculto e o nome `plain` aparece (seção 14, terceira regra).
 *
 * Todo objeto é estrito. Campo desconhecido reprova a definição inteira, que o
 * carregador então descarta: fail-closed.
 */

/** Texto nas duas versões. `plain` nunca é opcional numa definição de catálogo. */
export const LocalizedTextSchema = z.strictObject({
  theme: z.string().min(1).max(120),
  plain: z.string().min(1).max(120),
});

export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

/**
 * Quem definiu a Conquista.
 *
 * O array vem antes do schema, como em `TASK_STATUS_VALUES`: o `z.enum` daqui e
 * o `pgEnum` de `@dungeon-master/database` precisam concordar, e usar o mesmo
 * array nos dois é a única forma de garantir isso sem disciplina.
 */
export const ACHIEVEMENT_ORIGIN_VALUES = ["CATALOG", "TEMPLATE", "FORGED"] as const;

export const AchievementOriginSchema = z.enum(ACHIEVEMENT_ORIGIN_VALUES);

export type AchievementOrigin = z.infer<typeof AchievementOriginSchema>;

/** A que a Conquista está presa. `GLOBAL` não tem `scopeId`. */
export const ACHIEVEMENT_SCOPE_VALUES = ["GLOBAL", "PROJECT", "HARNESS", "AGENT", "TASK"] as const;

export const AchievementScopeSchema = z.enum(ACHIEVEMENT_SCOPE_VALUES);

export type AchievementScope = z.infer<typeof AchievementScopeSchema>;

/** Raridade, só cosmética. */
export const ACHIEVEMENT_RARITY_VALUES = ["COMMON", "RARE", "EPIC", "LEGENDARY"] as const;

export const AchievementRaritySchema = z.enum(ACHIEVEMENT_RARITY_VALUES);

export type AchievementRarity = z.infer<typeof AchievementRaritySchema>;

/** Chave estável de uma Conquista: `snake_case` em inglês, igual à do catálogo. */
export const AchievementKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "A chave usa minúsculas, dígitos e sublinhado.");

export type AchievementKey = z.infer<typeof AchievementKeySchema>;

/** Nome de ícone do lucide, em `kebab-case`. O ícone é o mesmo nos dois temas. */
export const IconNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, "O ícone é um nome do lucide em kebab-case.");

/** De onde a definição veio. Uma forjada guarda o Run que a inspirou. */
export const ProvenanceSchema = z.strictObject({
  catalogVersion: z.string().min(1).max(16).optional(),
  templateKey: AchievementKeySchema.optional(),
  runId: z.uuid().optional(),
  taskId: z.uuid().optional(),
  createdAt: z.iso.datetime().optional(),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;

const achievementShape = {
  key: AchievementKeySchema,
  origin: AchievementOriginSchema,
  scope: AchievementScopeSchema,
  name: LocalizedTextSchema,
  description: LocalizedTextSchema,
  /** Só existe no tema; com o tema desligado, fica oculto. */
  flavor: z.string().min(1).max(240).optional(),
  icon: IconNameSchema,
  rarity: AchievementRaritySchema,
  hidden: z.boolean(),
  condition: ConditionSchema,
  /** Rótulos dos tiers, um por limiar de um `count`. */
  tiers: z.array(z.string().min(1).max(8)).min(1).max(8).optional(),
  /** Raridade por tier, quando ela cresce ao longo dos limiares. */
  tierRarities: z.array(AchievementRaritySchema).min(1).max(8).optional(),
  provenance: ProvenanceSchema.optional(),
};

type TieredShape = {
  condition: z.infer<typeof ConditionSchema>;
  tiers?: readonly string[] | undefined;
  tierRarities?: readonly string[] | undefined;
};

/** Tiers só fazem sentido em `count`, e precisam casar um a um com os limiares. */
function checkTiers(value: TieredShape, ctx: z.RefinementCtx): void {
  const thresholds = value.condition.predicate === "count" ? value.condition.thresholds : undefined;

  for (const field of ["tiers", "tierRarities"] as const) {
    const list = value[field];
    if (list === undefined) continue;
    if (thresholds === undefined) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: `${field} só existe quando a condição é count.`,
      });
      continue;
    }
    if (list.length !== thresholds.length) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: `${field} precisa ter um item por limiar: ${String(thresholds.length)} esperado(s), ${String(list.length)} encontrado(s).`,
      });
    }
  }
}

/** Uma Conquista concreta: do catálogo, instanciada de um template ou forjada. */
export const AchievementDefinitionSchema = z.strictObject(achievementShape).superRefine(checkTiers);

export type AchievementDefinition = z.infer<typeof AchievementDefinitionSchema>;

/** O que a aplicação preenche ao instanciar um template. */
export const TEMPLATE_PLACEHOLDERS = ["project", "harness", "agent", "task"] as const;

export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

/** Qual entidade, ao aparecer, instancia o template. */
export const InstantiatedBySchema = z.enum(["project", "harness", "agent", "task.bug.reopened"]);

export type InstantiatedBy = z.infer<typeof InstantiatedBySchema>;

/**
 * Campo do filtro que a instanciação amarra à entidade.
 *
 * O template não carrega placeholder dentro da condição: ele diz por qual campo
 * a condição é escopada, e a aplicação preenche o `id` real.
 */
export const ScopeFromSchema = z.enum(["project.id", "run.harness", "agent.id", "task.id"]);

export type ScopeFrom = z.infer<typeof ScopeFromSchema>;

const PLACEHOLDER = /\{([A-Za-z0-9_.]+)\}/g;

function placeholdersOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");
}

type NamedShape = {
  name: { theme: string; plain: string };
  description: { theme: string; plain: string };
};

/** Nome de template precisa de pelo menos um placeholder, e só dos conhecidos. */
function checkPlaceholders(value: NamedShape, ctx: z.RefinementCtx): void {
  const known: readonly string[] = TEMPLATE_PLACEHOLDERS;

  for (const field of ["name", "description"] as const) {
    for (const variant of ["theme", "plain"] as const) {
      const used = placeholdersOf(value[field][variant]);
      if (field === "name" && used.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: [field, variant],
          message: "Nome de template precisa de pelo menos um placeholder.",
        });
      }
      for (const name of used) {
        if (!known.includes(name)) {
          ctx.addIssue({
            code: "custom",
            path: [field, variant],
            message: `Placeholder desconhecido: {${name}}.`,
          });
        }
      }
    }
  }
}

/**
 * Template de Conquista: a forma que a aplicação instancia por Project, Harness,
 * Agent ou Task `BUG` reaberta. Nasce oculta e aparece no primeiro progresso.
 */
export const AchievementTemplateSchema = z
  .strictObject({
    ...achievementShape,
    origin: z.literal("TEMPLATE"),
    instantiatedBy: InstantiatedBySchema,
    scopeFrom: ScopeFromSchema,
  })
  .superRefine((value, ctx) => {
    checkTiers(value, ctx);
    checkPlaceholders(value, ctx);
  });

export type AchievementTemplate = z.infer<typeof AchievementTemplateSchema>;
