import {
  AchievementDefinitionSchema as DefinitionSchema,
  AchievementTemplateSchema as TemplateSchema,
} from "@dungeon-master/achievements";
import { createRoute, z } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";

/**
 * O catálogo de Conquistas exposto como dado (planejamento v0.4, Fase 2.5A).
 *
 * O Hall dos Heróis existe em modo catálogo desde a Fase 1: o usuário vê o que
 * há para conquistar antes de existir Run que desbloqueie qualquer coisa. A
 * rota é, por isso, sem estado — não lê banco, não tem progresso e não depende
 * de usuário. É o arquivo versionado de `@dungeon-master/achievements`, já
 * validado, devolvido em JSON.
 *
 * Os schemas de Conquista **não** são redeclarados aqui. `@dungeon-master/
 * achievements` é um pacote puro que já tem os seus, e eles são a fonte única
 * daquele domínio; o que este módulo faz é registrá-los no OpenAPI com um `id`
 * (CLAUDE.md, seção 5). Duplicá-los em `packages/contracts` criaria duas
 * verdades sobre a mesma forma, e a que o carregador usa venceria em silêncio.
 */

/** Uma definição fixa do catálogo, nas duas versões de texto. */
export const AchievementDefinitionSchema = DefinitionSchema.meta({
  id: "AchievementDefinition",
  description:
    "Uma Conquista concreta. `name` e `description` vêm nas duas versões, " +
    "`theme` e `plain`, para acompanhar o interruptor de tema; `flavor` só " +
    "existe no tema. `condition` é o objeto validado do vocabulário fechado " +
    "de predicados, não uma expressão.",
});

/** Um template, que a aplicação instancia por Project, Harness, Agent ou Task. */
export const AchievementTemplateSchema = TemplateSchema.meta({
  id: "AchievementTemplate",
  description:
    "A forma que a aplicação instancia com os dados do usuário. `name` e " +
    "`description` carregam pelo menos um placeholder `{project}`, " +
    "`{harness}`, `{agent}` ou `{task}`; `instantiatedBy` diz o que a cria e " +
    "`scopeFrom` diz por qual campo a condição é escopada.",
});

/** Um problema de validação, já achatado, como o carregador o entrega. */
export const AchievementCatalogIssueSchema = z
  .object({
    path: z.string().describe("Caminho do campo, com pontos. Vazio quando o problema é da raiz."),
    message: z.string().describe("A mensagem do schema."),
  })
  .meta({ id: "AchievementCatalogIssue", description: "Um problema de validação do catálogo." });

/**
 * Uma entrada recusada.
 *
 * O carregamento é fail-closed e nunca lança: uma definição torta fica de fora
 * de `definitions`/`templates` e aparece aqui, para a tela e o log poderem
 * dizer qual entrada do arquivo está errada. Ela nunca desbloqueia nada.
 */
export const AchievementCatalogInvalidEntrySchema = z
  .object({
    source: z
      .enum(["catalog", "templates"])
      .describe("De qual dos dois arquivos versionados a entrada veio."),
    key: z.string().nullable().describe("A chave, quando legível; nulo quando nem isso deu."),
    index: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .describe("Posição na lista; nulo quando o arquivo inteiro falhou."),
    error: z.string().describe("Resumo do primeiro problema, para log."),
    issues: z.array(AchievementCatalogIssueSchema).describe("Todos os problemas encontrados."),
  })
  .meta({
    id: "AchievementCatalogInvalidEntry",
    description: "Uma entrada do catálogo que não passou no schema e ficou de fora.",
  });

export const AchievementCatalogSchema = z
  .object({
    definitions: z
      .array(AchievementDefinitionSchema)
      .describe("As Conquistas fixas, iguais para todos, na ordem do arquivo."),
    templates: z
      .array(AchievementTemplateSchema)
      .describe("Os templates, que ainda não são Conquistas de ninguém."),
    invalid: z
      .array(AchievementCatalogInvalidEntrySchema)
      .describe("O que foi recusado na carga. Vazio quando o catálogo está íntegro."),
  })
  .meta({
    id: "AchievementCatalog",
    description: "O catálogo versionado de Conquistas, já validado.",
  });

export type AchievementCatalog = z.infer<typeof AchievementCatalogSchema>;

export const achievementsCatalogRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/achievements/catalog`,
  tags: ["achievements"],
  summary: "O catálogo de Conquistas",
  description:
    "Sem estado: catálogo é dado. Lido e validado uma vez no boot, a partir " +
    "dos arquivos versionados de `@dungeon-master/achievements`. Não há " +
    "progresso nem desbloqueio aqui — o Hall dos Heróis da Fase 1 mostra tudo " +
    "como bloqueado. Uma entrada que não passa no schema não aparece em " +
    "`definitions` nem em `templates`; ela sai em `invalid`.",
  responses: {
    200: {
      description: "O catálogo inteiro.",
      content: { "application/json": { schema: AchievementCatalogSchema } },
    },
  },
});
