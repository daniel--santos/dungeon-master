import {
  AchievementDefinitionSchema as DefinitionSchema,
  AchievementOriginSchema,
  AchievementRaritySchema,
  AchievementScopeSchema,
  AchievementTemplateSchema as TemplateSchema,
} from "@dungeon-master/achievements";
import {
  AchievementCountsSchema,
  AchievementProgressSchema,
  AchievementStateSchema,
  AchievementTierSchema,
  AchievementUnlockListQuerySchema,
  HeroStatsResponseSchema,
  paginatedSchema,
  ProblemDetailsSchema,
} from "@dungeon-master/contracts";
import { createRoute, z } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";

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

// --------------------------------------------------------------------------
// O Hall com estado: progresso, desbloqueios e Heróis (Fase 2.5B)
// --------------------------------------------------------------------------

/**
 * As rotas abaixo leem a **projeção**, e não o arquivo.
 *
 * `GET /achievements/catalog` continua sendo o catálogo puro, sem usuário e sem
 * banco: é o que o Hall da Fase 1 mostra antes de existir Run. Daqui para
 * baixo, tudo tem progresso, e é o projetor do Worker que escreve.
 *
 * Os enums de origem, escopo e raridade vêm de `@dungeon-master/achievements`,
 * que é a fonte única daquele vocabulário; o que `packages/contracts` declara é
 * o que a API inventa por cima — estado, tier e progresso (CLAUDE.md, seção 5).
 */

const localizedText = z.object({
  theme: z.string().describe("A versão temática, com a voz do Dungeon Master."),
  plain: z.string().describe("A versão sóbria, para o tema desligado."),
});

export const AchievementListItemSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 da definição gravada."),
    origin: AchievementOriginSchema.describe("Quem definiu: catálogo, template ou forjada."),
    key: z.string().nullable().describe("A chave do catálogo ou do template. Nula numa forjada."),
    scopeType: AchievementScopeSchema.describe("A que a Conquista está presa."),
    scopeId: z.string().nullable().describe("Id do Project/Agent/Task, ou a chave do Harness."),
    scopeLabel: z
      .string()
      .nullable()
      .describe("Nome atual da entidade do escopo, resolvido na leitura."),
    name: localizedText.describe(
      "Já formatado: o placeholder de um template é trocado pelo nome atual " +
        "da entidade, para a Conquista acompanhar uma renomeação.",
    ),
    description: localizedText,
    flavor: z.string().nullable().describe("Só existe no tema; com ele desligado, fica oculto."),
    icon: z.string().describe("Nome do ícone do lucide, em kebab-case."),
    rarity: AchievementRaritySchema.describe("Raridade do tier corrente, que pode subir com ele."),
    hidden: z.boolean().describe("Nasce oculta? Vira visível no primeiro progresso."),
    state: AchievementStateSchema,
    tier: AchievementTierSchema,
    progress: AchievementProgressSchema,
    unlockedAt: z.iso.datetime().nullable().describe("Instante do último desbloqueio, em UTC."),
  })
  .meta({
    id: "AchievementListItem",
    description: "Uma Conquista do usuário, com progresso e estado calculado.",
  });

export const AchievementListResponseSchema = z
  .object({
    items: z.array(AchievementListItemSchema).describe("As Conquistas que casam com o filtro."),
    counts: AchievementCountsSchema,
  })
  .meta({
    id: "AchievementListResponse",
    description: "As Conquistas do usuário e a contagem por estado, sempre sobre o total.",
  });

export const AchievementListQuerySchema = z
  .object({
    origin: AchievementOriginSchema.optional().describe("Só as Conquistas desta origem."),
    rarity: AchievementRaritySchema.optional().describe("Raridade do tier corrente."),
    state: AchievementStateSchema.optional().describe("Só as neste estado."),
  })
  .meta({ id: "AchievementListQuery" });

export const AchievementUnlockSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do desbloqueio."),
    definitionId: z.uuid(),
    key: z.string().nullable(),
    origin: AchievementOriginSchema,
    name: localizedText,
    icon: z.string(),
    rarity: AchievementRaritySchema,
    tier: z.number().int().positive().describe("Qual limiar foi cruzado. `1` no caso comum."),
    tierLabel: z.string().nullable(),
    runId: z.uuid().nullable().describe("Run que causou o desbloqueio, quando houve um."),
    taskId: z.uuid().nullable(),
    unlockedAt: z.iso
      .datetime()
      .describe(
        "Instante do **fato** que desbloqueou, não o da gravação. É por isso " +
          "que uma reconstrução produz a mesma crônica, com as mesmas datas.",
      ),
    seenAt: z.iso.datetime().nullable().describe("Nulo até o usuário ver o toast ou a crônica."),
  })
  .meta({ id: "AchievementUnlock", description: "Um desbloqueio, com a Conquista resolvida." });

export const AchievementUnlockPageSchema = paginatedSchema(
  AchievementUnlockSchema,
  "AchievementUnlockPage",
  "Uma página da crônica, do desbloqueio mais recente para o mais antigo.",
);

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
});

export const achievementsListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/achievements`,
  tags: ["achievements"],
  summary: "As Conquistas do usuário, com progresso",
  description:
    "A projeção que o Worker mantém: catálogo carregado, templates já " +
    "instanciados, progresso, tier e estado calculado. `state` é derivado em " +
    "toda leitura e nunca é coluna. `counts` ignora os filtros de propósito: é " +
    "o 'desbloqueadas de N' que fica ao lado deles.",
  request: { query: AchievementListQuerySchema },
  responses: {
    200: {
      description: "As Conquistas e a contagem por estado.",
      content: { "application/json": { schema: AchievementListResponseSchema } },
    },
    400: problem("Filtro inválido."),
  },
});

export const achievementUnlocksListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/achievements/unlocks`,
  tags: ["achievements"],
  summary: "A crônica de desbloqueios",
  description:
    "Do mais recente para o mais antigo. O desempate é por id descendente, " +
    "que em UUIDv7 é a ordem de inserção: sem ele, dois desbloqueios do mesmo " +
    "instante — o que acontece quando um fato cruza dois limiares — poderiam " +
    "trocar de lugar entre páginas.",
  request: { query: AchievementUnlockListQuerySchema },
  responses: {
    200: {
      description: "Uma página da crônica.",
      content: { "application/json": { schema: AchievementUnlockPageSchema } },
    },
    400: problem("Paginação inválida."),
  },
});

export const achievementUnlockSeenRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/achievements/unlocks/{id}/seen`,
  tags: ["achievements"],
  summary: "Marca um desbloqueio como visto",
  description:
    "Idempotente: marcar de novo devolve o mesmo `seenAt` em vez de reescrevê-lo. " +
    "É o que apaga o destaque de novo no Hall depois do toast.",
  request: { params: z.object({ id: z.uuid().describe("UUIDv7 do desbloqueio.") }) },
  responses: {
    200: {
      description: "O desbloqueio, já marcado.",
      content: { "application/json": { schema: AchievementUnlockSchema } },
    },
    404: problem("Não existe desbloqueio com este id."),
  },
});

export const heroStatsRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/heroes/stats`,
  tags: ["heroes"],
  summary: "As estatísticas de Herói e de Equipamento",
  description:
    "Projeção, como tudo na Fase 2.5, e cosmética: nenhuma funcionalidade " +
    "depende de nível. Os nomes vêm por junção na leitura, então acompanham " +
    "uma renomeação; ficam nulos quando a entidade foi apagada.",
  responses: {
    200: {
      description: "Os acumulados por Agent e por Loadout.",
      content: { "application/json": { schema: HeroStatsResponseSchema } },
    },
  },
});
