import {
  achievementTargets,
  achievementTierCount,
  achievementValue,
  type AchievementDefinition,
  type AchievementOrigin,
  type AchievementProgress as PureProgress,
  type AchievementRarity,
  type AchievementScope,
  type AchievementTemplate,
  CATALOG_VERSION,
  EMPTY_PROGRESS,
  formatTemplateText,
  instantiateTemplate,
  parseCondition,
  placeholderForScope,
  type Condition,
} from "@dungeon-master/achievements";
import type { AchievementState, HarnessKey } from "@dungeon-master/contracts";
import type { EventsLogger } from "@dungeon-master/events";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";

import type { DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import type { PageInput, PageResult } from "./result.js";
import {
  achievementDefinitions,
  type AchievementDefinitionRow,
  achievementProgress,
  type AchievementProgressRow,
  achievementUnlocks,
  type AchievementUnlockRow,
  heroStats,
  type HeroStatsRow,
} from "./schema/achievement.js";
import { agents, loadouts } from "./schema/execution.js";
import { projects } from "./schema/project.js";
import { runs } from "./schema/run.js";
import { tasks } from "./schema/task.js";

/**
 * O repositório das Conquistas: carga do catálogo, instanciação de templates e
 * as leituras que o Hall dos Heróis consome (planejamento v0.4, Fase 2.5).
 *
 * O que **avalia** condições é o núcleo puro de `@dungeon-master/achievements`;
 * o que **consome eventos** é `achievement-projector.ts`. Aqui mora só o que
 * fala com o schema.
 */

// --------------------------------------------------------------------------
// Identidade
// --------------------------------------------------------------------------

/**
 * A chave estável de uma definição, única por usuário.
 *
 * É o que torna a carga do catálogo e a instanciação de templates idempotentes:
 * rodar de novo faz `ON CONFLICT DO UPDATE` na mesma linha, e nunca uma
 * segunda Conquista igual.
 */
export function achievementNaturalKey(
  origin: AchievementOrigin,
  key: string,
  scopeId?: string | null,
): string {
  switch (origin) {
    case "CATALOG":
      return `catalog:${key}`;
    case "TEMPLATE":
      return `template:${key}:${scopeId ?? ""}`;
    case "FORGED":
      return `forged:${key}`;
  }
}

function definitionValues(
  userId: string,
  definition: AchievementDefinition,
  extra: {
    naturalKey: string;
    scopeId: string | null;
    catalogKey: string | null;
    templateKey: string | null;
    catalogVersion: string | null;
    effectiveFrom: Date | null;
  },
) {
  return {
    id: newId(),
    userId,
    origin: definition.origin,
    naturalKey: extra.naturalKey,
    catalogKey: extra.catalogKey,
    templateKey: extra.templateKey,
    catalogVersion: extra.catalogVersion,
    scopeType: definition.scope,
    scopeId: extra.scopeId,
    nameTheme: definition.name.theme,
    namePlain: definition.name.plain,
    descriptionTheme: definition.description.theme,
    descriptionPlain: definition.description.plain,
    flavor: definition.flavor ?? null,
    icon: definition.icon,
    rarity: definition.rarity,
    tiers: definition.tiers === undefined ? null : [...definition.tiers],
    tierRarities: definition.tierRarities === undefined ? null : [...definition.tierRarities],
    hidden: definition.hidden,
    condition: definition.condition,
    provenance: definition.provenance ?? null,
    effectiveFrom: extra.effectiveFrom,
  };
}

/** O que muda quando a definição já existe. `id` e `effective_from` não mudam. */
function definitionUpdate(values: ReturnType<typeof definitionValues>) {
  const {
    id: _id,
    userId: _userId,
    naturalKey: _naturalKey,
    effectiveFrom: _from,
    ...rest
  } = values;
  return { ...rest, updatedAt: new Date() };
}

// --------------------------------------------------------------------------
// Carga do catálogo
// --------------------------------------------------------------------------

export interface SyncCatalogInput {
  userId: string;
  /** As definições já validadas por `loadCatalog`. Uma entrada torta nunca chega aqui. */
  definitions: readonly AchievementDefinition[];
  catalogVersion?: string;
}

/**
 * Sincroniza as definições fixas do catálogo com a tabela.
 *
 * **Nunca apaga.** Uma chave que sumiu do arquivo continua na tabela com os
 * desbloqueios dela: retirar uma Conquista do catálogo não pode tirar do
 * usuário algo que ele já conquistou. O que a carga faz é criar o que falta e
 * atualizar o texto do que mudou — mudar um limiar é uma versão nova do
 * catálogo, e a versão fica gravada na linha.
 */
export async function syncCatalogDefinitions(
  db: DatabaseExecutor,
  input: SyncCatalogInput,
): Promise<{ synced: number }> {
  const version = input.catalogVersion ?? CATALOG_VERSION;

  for (const definition of input.definitions) {
    if (definition.origin !== "CATALOG") continue;

    const values = definitionValues(input.userId, definition, {
      naturalKey: achievementNaturalKey("CATALOG", definition.key),
      scopeId: null,
      catalogKey: definition.key,
      templateKey: null,
      catalogVersion: version,
      effectiveFrom: null,
    });

    await db
      .insert(achievementDefinitions)
      .values(values)
      .onConflictDoUpdate({
        target: [achievementDefinitions.userId, achievementDefinitions.naturalKey],
        set: definitionUpdate(values),
      });
  }

  return { synced: input.definitions.length };
}

// --------------------------------------------------------------------------
// Instanciação de templates
// --------------------------------------------------------------------------

/** Uma entidade parametrizada que já apareceu, com o instante em que apareceu. */
interface ScopeCandidate {
  readonly scopeId: string;
  readonly since: Date;
}

/**
 * Os Projects do usuário. `effective_from` é a criação do Project.
 *
 * As quatro consultas abaixo derivam o `since` de **dados duráveis**, e não do
 * relógio: uma reconstrução recalcula o mesmo instante e reproduz o mesmo
 * desbloqueio.
 */
async function projectCandidates(db: DatabaseExecutor, userId: string): Promise<ScopeCandidate[]> {
  const rows = await db
    .select({ id: projects.id, createdAt: projects.createdAt })
    .from(projects)
    .where(eq(projects.userId, userId));

  return rows.map((row) => ({ scopeId: row.id, since: row.createdAt }));
}

/**
 * O slug da Guilda no vocabulário das Conquistas.
 *
 * `HarnessKey` é `SCREAMING_SNAKE_CASE` porque é enum de domínio; o filtro
 * `run.harness` de uma condição é um slug minúsculo, porque é dado de catálogo
 * e aparece escrito à mão no JSON. A tradução mora aqui, num mapa exaustivo:
 * um harness novo sem entrada é erro de compilação, e não uma Conquista que
 * silenciosamente deixa de contar.
 */
export const HARNESS_ACHIEVEMENT_SLUG = {
  CLAUDE_CODE: "claude",
  CODEX: "codex",
  PI: "pi",
  ANTIGRAVITY: "antigravity",
} as const satisfies Record<HarnessKey, string>;

export function harnessSlug(key: HarnessKey): string {
  return HARNESS_ACHIEVEMENT_SLUG[key];
}

/** As Guildas já usadas, pelo primeiro Run de cada uma. */
async function harnessCandidates(db: DatabaseExecutor, userId: string): Promise<ScopeCandidate[]> {
  const rows = await db
    .select({ key: runs.harnessKey, since: sql<Date>`min(${runs.createdAt})` })
    .from(runs)
    .where(eq(runs.userId, userId))
    .groupBy(runs.harnessKey);

  return rows.map((row) => ({ scopeId: harnessSlug(row.key), since: new Date(row.since) }));
}

/**
 * Os Heróis que já partiram em Expedição, pelo primeiro Run de cada um.
 *
 * O Agent sai do snapshot do Run, e não de uma junção com `loadout`: o snapshot
 * é quem de fato executou, e ele continua correto depois de alguém trocar o
 * Agent do Loadout.
 */
async function agentCandidates(db: DatabaseExecutor, userId: string): Promise<ScopeCandidate[]> {
  const result = await db.execute<{ agent_id: string | null; since: Date }>(
    sql`select loadout_snapshot -> 'agent' ->> 'id' as agent_id, min(created_at) as since
        from run where user_id = ${userId}
        group by 1`,
  );

  return result.rows
    .filter((row): row is { agent_id: string; since: Date } => row.agent_id !== null)
    .map((row) => ({ scopeId: row.agent_id, since: new Date(row.since) }));
}

/**
 * Os Monstros reabertos duas ou mais vezes.
 *
 * "Reaberta" é uma transição que **sai** de `COMPLETED`, lida do diário. Hoje a
 * máquina de estados de Task não tem essa aresta — `COMPLETED` é terminal —,
 * então a consulta não devolve nada e o template `nemesis` não é instanciado. A
 * consulta existe pronta porque é ela que passa a valer no dia em que reabrir
 * uma Task for possível, e escrevê-la depois seria escrever a Conquista de novo.
 */
async function reopenedBugCandidates(
  db: DatabaseExecutor,
  userId: string,
): Promise<ScopeCandidate[]> {
  const result = await db.execute<{ task_id: string; since: Date }>(
    sql`select t.task_id, t.created_at as since
        from (
          select a.task_id, a.created_at,
                 row_number() over (partition by a.task_id order by a.created_at, a.id) as rn
          from activity a
          join task k on k.id = a.task_id and k.kind = 'BUG'
          where a.user_id = ${userId}
            and a.type = 'task.status_changed'
            and a.payload ->> 'from' = 'COMPLETED'
            and a.task_id is not null
        ) t
        where t.rn = 2`,
  );

  return result.rows.map((row) => ({ scopeId: row.task_id, since: new Date(row.since) }));
}

export interface SyncTemplatesInput {
  userId: string;
  templates: readonly AchievementTemplate[];
  logger?: EventsLogger;
}

/**
 * Instancia os templates para as entidades que já existem.
 *
 * Roda **antes** de consumir eventos, e não em resposta a um evento: a entidade
 * que dispara a instanciação já está gravada quando o fato dela aparece na
 * fila, e derivar a lista do estado atual é o que torna a instanciação
 * idempotente e reconstruível. O `effective_from` de cada instância é o
 * instante em que a entidade apareceu, então o que aconteceu antes dela não
 * conta — nem no primeiro passe, nem numa reconstrução.
 */
export async function syncTemplateInstances(
  db: DatabaseExecutor,
  input: SyncTemplatesInput,
): Promise<{ instantiated: number; rejected: number }> {
  const porGatilho = new Map<string, ScopeCandidate[]>();

  const candidatos = async (gatilho: AchievementTemplate["instantiatedBy"]) => {
    const cache = porGatilho.get(gatilho);
    if (cache !== undefined) return cache;

    const lista =
      gatilho === "project"
        ? await projectCandidates(db, input.userId)
        : gatilho === "harness"
          ? await harnessCandidates(db, input.userId)
          : gatilho === "agent"
            ? await agentCandidates(db, input.userId)
            : await reopenedBugCandidates(db, input.userId);

    porGatilho.set(gatilho, lista);
    return lista;
  };

  let instantiated = 0;
  let rejected = 0;

  for (const template of input.templates) {
    for (const candidate of await candidatos(template.instantiatedBy)) {
      const instancia = instantiateTemplate(template, candidate.scopeId);

      if (!instancia.ok) {
        rejected += 1;
        input.logger?.warn?.(
          { template: template.key, scopeId: candidate.scopeId, error: instancia.rejection.error },
          "achievement_template_instance_rejected",
        );
        continue;
      }

      const values = definitionValues(input.userId, instancia.value.definition, {
        naturalKey: achievementNaturalKey("TEMPLATE", template.key, candidate.scopeId),
        scopeId: candidate.scopeId,
        catalogKey: null,
        templateKey: template.key,
        catalogVersion: CATALOG_VERSION,
        effectiveFrom: candidate.since,
      });

      await db
        .insert(achievementDefinitions)
        .values(values)
        .onConflictDoUpdate({
          target: [achievementDefinitions.userId, achievementDefinitions.naturalKey],
          set: definitionUpdate(values),
        });

      instantiated += 1;
    }
  }

  return { instantiated, rejected };
}

// --------------------------------------------------------------------------
// Leitura crua, para o projetor
// --------------------------------------------------------------------------

export async function listAchievementDefinitionRows(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<AchievementDefinitionRow[]> {
  return await db
    .select()
    .from(achievementDefinitions)
    .where(eq(achievementDefinitions.userId, input.userId))
    .orderBy(asc(achievementDefinitions.naturalKey));
}

export async function listAchievementProgressRows(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<AchievementProgressRow[]> {
  return await db
    .select()
    .from(achievementProgress)
    .where(eq(achievementProgress.userId, input.userId));
}

/** A linha do banco vira o estado puro que o projetor dobra. */
export function toPureProgress(row: AchievementProgressRow | undefined): PureProgress {
  if (row === undefined) return EMPTY_PROGRESS;
  return {
    counter: row.counter,
    best: row.bestValue,
    streak: row.currentStreak,
    bestStreak: row.bestStreak,
    seen: row.state.seen ?? [],
  };
}

// --------------------------------------------------------------------------
// Rótulos de escopo
// --------------------------------------------------------------------------

/** O nome atual da entidade a que cada instância de template está presa. */
export async function resolveScopeLabels(
  db: DatabaseExecutor,
  input: { userId: string; rows: readonly AchievementDefinitionRow[] },
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();

  const idsDe = (scope: AchievementScope): string[] => [
    ...new Set(
      input.rows
        .filter((row) => row.scopeType === scope && row.scopeId !== null)
        .map((row) => row.scopeId as string),
    ),
  ];

  const projectIds = idsDe("PROJECT");
  if (projectIds.length > 0) {
    const rows = await db
      .select({ id: projects.id, title: projects.title })
      .from(projects)
      .where(and(eq(projects.userId, input.userId), inArray(projects.id, projectIds)));
    for (const row of rows) labels.set(`PROJECT:${row.id}`, row.title);
  }

  const agentIds = idsDe("AGENT");
  if (agentIds.length > 0) {
    const rows = await db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(and(eq(agents.userId, input.userId), inArray(agents.id, agentIds)));
    for (const row of rows) labels.set(`AGENT:${row.id}`, row.name);
  }

  const taskIds = idsDe("TASK");
  if (taskIds.length > 0) {
    const rows = await db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(and(eq(tasks.userId, input.userId), inArray(tasks.id, taskIds)));
    for (const row of rows) labels.set(`TASK:${row.id}`, row.title);
  }

  // A Guilda é escopada por slug e o cadastro é fechado: o rótulo é o próprio
  // slug em maiúscula de nome próprio, sem ida ao banco.
  for (const row of input.rows) {
    if (row.scopeType !== "HARNESS" || row.scopeId === null) continue;
    labels.set(`HARNESS:${row.scopeId}`, row.scopeId);
  }

  return labels;
}

/** O nome, já com o placeholder trocado pelo nome atual da entidade. */
export function formatDefinitionName(
  row: AchievementDefinitionRow,
  labels: Map<string, string>,
): { theme: string; plain: string } {
  const placeholder = placeholderForScope(row.scopeType);
  if (placeholder === null || row.scopeId === null) {
    return { theme: row.nameTheme, plain: row.namePlain };
  }

  const label = labels.get(`${row.scopeType}:${row.scopeId}`);
  const values = label === undefined ? {} : { [placeholder]: label };

  return {
    theme: formatTemplateText(row.nameTheme, values),
    plain: formatTemplateText(row.namePlain, values),
  };
}

/** A descrição, com o mesmo tratamento de placeholder do nome. */
export function formatDefinitionDescription(
  row: AchievementDefinitionRow,
  labels: Map<string, string>,
): { theme: string; plain: string } {
  const placeholder = placeholderForScope(row.scopeType);
  if (placeholder === null || row.scopeId === null) {
    return { theme: row.descriptionTheme, plain: row.descriptionPlain };
  }

  const label = labels.get(`${row.scopeType}:${row.scopeId}`);
  const values = label === undefined ? {} : { [placeholder]: label };

  return {
    theme: formatTemplateText(row.descriptionTheme, values),
    plain: formatTemplateText(row.descriptionPlain, values),
  };
}

// --------------------------------------------------------------------------
// Leitura para o Hall
// --------------------------------------------------------------------------

/**
 * O estado calculado de uma Conquista.
 *
 * Não é coluna: é derivado do progresso e dos desbloqueios em toda leitura. Uma
 * coluna de estado seria uma quarta verdade sobre o mesmo fato, e ela ficaria
 * errada na primeira reconstrução.
 *
 * O tipo vem de `@dungeon-master/contracts`, que é onde a API o declara como
 * `z.enum` e valida o filtro da rota contra ele. Redeclarar os quatro nomes
 * aqui deixaria as duas listas livres para divergir em silêncio.
 */
export type { AchievementState };

export interface AchievementView {
  readonly id: string;
  readonly origin: AchievementOrigin;
  /** `catalog_key` ou `template_key`, o que existir. */
  readonly key: string | null;
  readonly scopeType: AchievementScope;
  readonly scopeId: string | null;
  /** Nome atual da entidade do escopo, quando houver uma. */
  readonly scopeLabel: string | null;
  readonly name: { readonly theme: string; readonly plain: string };
  readonly description: { readonly theme: string; readonly plain: string };
  readonly flavor: string | null;
  readonly icon: string;
  /** Raridade do tier atual, que pode ser maior que a raridade base. */
  readonly rarity: AchievementRarity;
  readonly hidden: boolean;
  readonly state: AchievementState;
  readonly tier: {
    readonly current: number;
    readonly total: number;
    readonly label: string | null;
  };
  readonly progress: {
    readonly current: number;
    readonly target: number;
    readonly percent: number;
  };
  readonly unlockedAt: string | null;
}

export interface AchievementCounts {
  readonly total: number;
  readonly unlocked: number;
  readonly inProgress: number;
  readonly locked: number;
  readonly hidden: number;
}

export interface AchievementListFilters {
  readonly origin?: AchievementOrigin | undefined;
  readonly rarity?: AchievementRarity | undefined;
  readonly state?: AchievementState | undefined;
}

export interface AchievementListResult {
  readonly items: AchievementView[];
  /** Sempre sobre o conjunto **inteiro**: é o "desbloqueadas de N" do Hall. */
  readonly counts: AchievementCounts;
}

function rarityForTier(row: AchievementDefinitionRow, tier: number): AchievementRarity {
  const escala = row.tierRarities;
  if (escala === null || escala.length === 0) return row.rarity;
  const indice = Math.min(Math.max(tier, 1), escala.length) - 1;
  return escala[indice] ?? row.rarity;
}

/**
 * O rótulo do tier, ou `null` quando não há tier nenhum a rotular.
 *
 * `tier` zero é "nada desbloqueado ainda", e ali o rótulo é nulo: uma carta
 * mostrando "Caçador de Monstros I" com o primeiro limiar ainda por cruzar
 * anunciaria um tier que o usuário não tem. O numeral aparece junto com o
 * desbloqueio, não antes dele.
 */
function tierLabel(row: AchievementDefinitionRow, tier: number): string | null {
  const rotulos = row.tiers;
  if (rotulos === null || rotulos.length <= 1) return null;
  if (tier < 1) return null;
  return rotulos[Math.min(tier, rotulos.length) - 1] ?? null;
}

function buildView(
  row: AchievementDefinitionRow,
  progress: PureProgress,
  unlocks: readonly AchievementUnlockRow[],
  labels: Map<string, string>,
): AchievementView {
  // A leitura é fail-closed como o projetor: uma condição gravada que não passa
  // no schema — de uma versão futura do catálogo, ou de uma edição manual — vira
  // uma carta bloqueada de alvo 1, em vez de derrubar o Hall inteiro.
  const parsed = parseCondition(row.condition);
  const condition = parsed.ok ? parsed.value : null;
  const targets = condition === null ? [1] : achievementTargets(condition);
  const total = condition === null ? 1 : achievementTierCount(condition);
  const value = condition === null ? 0 : achievementValue(condition, progress);

  const maiorTier = unlocks.reduce((maior, unlock) => Math.max(maior, unlock.tier), 0);
  const desbloqueada = maiorTier > 0;

  // O alvo mostrado é o do **próximo** tier: quem já fez 12 de 10/50/200 vê
  // 12/50, e não 12/10, que pareceria uma barra quebrada.
  const proximo = Math.min(maiorTier, total - 1);
  const target = targets[proximo] ?? targets[targets.length - 1] ?? 1;

  const state: AchievementState = desbloqueada
    ? "UNLOCKED"
    : value > 0
      ? "IN_PROGRESS"
      : row.hidden
        ? "HIDDEN"
        : "LOCKED";

  const ultimo = unlocks.reduce<AchievementUnlockRow | null>(
    (maior, unlock) => (maior === null || unlock.unlockedAt > maior.unlockedAt ? unlock : maior),
    null,
  );

  return {
    id: row.id,
    origin: row.origin,
    key: row.catalogKey ?? row.templateKey,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    scopeLabel:
      row.scopeId === null ? null : (labels.get(`${row.scopeType}:${row.scopeId}`) ?? null),
    name: formatDefinitionName(row, labels),
    description: formatDefinitionDescription(row, labels),
    flavor: row.flavor,
    icon: row.icon,
    rarity: rarityForTier(row, Math.max(maiorTier, 1)),
    hidden: row.hidden,
    state,
    tier: {
      current: maiorTier,
      total,
      label: tierLabel(row, maiorTier),
    },
    progress: {
      current: value,
      target,
      percent: target === 0 ? 0 : Math.min(100, Math.round((value / target) * 100)),
    },
    unlockedAt: ultimo?.unlockedAt.toISOString() ?? null,
  };
}

function countStates(items: readonly AchievementView[]): AchievementCounts {
  let unlocked = 0;
  let inProgress = 0;
  let locked = 0;
  let hidden = 0;

  for (const item of items) {
    if (item.state === "UNLOCKED") unlocked += 1;
    else if (item.state === "IN_PROGRESS") inProgress += 1;
    else if (item.state === "HIDDEN") hidden += 1;
    else locked += 1;
  }

  return { total: items.length, unlocked, inProgress, locked, hidden };
}

/**
 * As Conquistas do usuário, com progresso e estado calculado.
 *
 * Sem paginação de propósito: o conjunto é o catálogo mais as instâncias, na
 * casa das dezenas, e o Hall desenha a grade inteira. Filtrar e contar em
 * memória custa menos que três consultas com agregação, e mantém `counts`
 * sempre sobre o total — que é o número que a tela mostra ao lado do filtro.
 */
export async function listAchievementViews(
  db: DatabaseExecutor,
  input: { userId: string; filters?: AchievementListFilters },
): Promise<AchievementListResult> {
  const rows = await listAchievementDefinitionRows(db, input);
  const progressRows = await listAchievementProgressRows(db, input);
  const unlockRows = await db
    .select()
    .from(achievementUnlocks)
    .where(eq(achievementUnlocks.userId, input.userId));

  const labels = await resolveScopeLabels(db, { userId: input.userId, rows });

  const progressPorId = new Map(progressRows.map((row) => [row.definitionId, row]));
  const unlocksPorId = new Map<string, AchievementUnlockRow[]>();
  for (const unlock of unlockRows) {
    const lista = unlocksPorId.get(unlock.definitionId) ?? [];
    lista.push(unlock);
    unlocksPorId.set(unlock.definitionId, lista);
  }

  const todas = rows.map((row) =>
    buildView(
      row,
      toPureProgress(progressPorId.get(row.id)),
      unlocksPorId.get(row.id) ?? [],
      labels,
    ),
  );

  const filters = input.filters ?? {};
  const items = todas.filter(
    (item) =>
      (filters.origin === undefined || item.origin === filters.origin) &&
      (filters.rarity === undefined || item.rarity === filters.rarity) &&
      (filters.state === undefined || item.state === filters.state),
  );

  return { items, counts: countStates(todas) };
}

// --------------------------------------------------------------------------
// Crônica
// --------------------------------------------------------------------------

export interface AchievementUnlockView {
  readonly id: string;
  readonly definitionId: string;
  readonly key: string | null;
  readonly origin: AchievementOrigin;
  readonly name: { readonly theme: string; readonly plain: string };
  readonly icon: string;
  readonly rarity: AchievementRarity;
  readonly tier: number;
  readonly tierLabel: string | null;
  readonly runId: string | null;
  readonly taskId: string | null;
  readonly unlockedAt: string;
  readonly seenAt: string | null;
}

function buildUnlockView(
  unlock: AchievementUnlockRow,
  row: AchievementDefinitionRow,
  labels: Map<string, string>,
): AchievementUnlockView {
  return {
    id: unlock.id,
    definitionId: row.id,
    key: row.catalogKey ?? row.templateKey,
    origin: row.origin,
    name: formatDefinitionName(row, labels),
    icon: row.icon,
    rarity: rarityForTier(row, unlock.tier),
    tier: unlock.tier,
    tierLabel: tierLabel(row, unlock.tier),
    runId: unlock.runId,
    taskId: unlock.taskId,
    unlockedAt: unlock.unlockedAt.toISOString(),
    seenAt: unlock.seenAt?.toISOString() ?? null,
  };
}

/**
 * A crônica: os desbloqueios, do mais recente para o mais antigo.
 *
 * O desempate é por `id` descendente, e não arbitrário: o id é UUIDv7, então
 * dois desbloqueios do mesmo instante — o que acontece quando um evento cruza
 * dois limiares — mantêm a mesma ordem entre uma página e a seguinte.
 */
export async function listAchievementUnlockPage(
  db: DatabaseExecutor,
  input: PageInput & { userId: string },
): Promise<PageResult<AchievementUnlockView>> {
  const rows = await db
    .select({ unlock: achievementUnlocks, definition: achievementDefinitions })
    .from(achievementUnlocks)
    .innerJoin(
      achievementDefinitions,
      eq(achievementDefinitions.id, achievementUnlocks.definitionId),
    )
    .where(eq(achievementUnlocks.userId, input.userId))
    .orderBy(desc(achievementUnlocks.unlockedAt), desc(achievementUnlocks.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db
    .select({ total: count() })
    .from(achievementUnlocks)
    .where(eq(achievementUnlocks.userId, input.userId));

  const labels = await resolveScopeLabels(db, {
    userId: input.userId,
    rows: rows.map((row) => row.definition),
  });

  return {
    items: rows.map((row) => buildUnlockView(row.unlock, row.definition, labels)),
    total: counted?.total ?? 0,
  };
}

/** Marca um desbloqueio como visto. Idempotente: ver de novo não reescreve. */
export async function markAchievementUnlockSeen(
  db: DatabaseExecutor,
  input: { userId: string; unlockId: string },
): Promise<AchievementUnlockView | null> {
  const [existente] = await db
    .select()
    .from(achievementUnlocks)
    .where(
      and(eq(achievementUnlocks.id, input.unlockId), eq(achievementUnlocks.userId, input.userId)),
    );

  if (existente === undefined) return null;

  const unlock =
    existente.seenAt !== null
      ? existente
      : ((
          await db
            .update(achievementUnlocks)
            .set({ seenAt: new Date() })
            .where(
              and(
                eq(achievementUnlocks.id, input.unlockId),
                eq(achievementUnlocks.userId, input.userId),
              ),
            )
            .returning()
        )[0] ?? existente);

  const [definition] = await db
    .select()
    .from(achievementDefinitions)
    .where(eq(achievementDefinitions.id, unlock.definitionId));

  if (definition === undefined) return null;

  const labels = await resolveScopeLabels(db, { userId: input.userId, rows: [definition] });
  return buildUnlockView(unlock, definition, labels);
}

// --------------------------------------------------------------------------
// Estatísticas de Herói
// --------------------------------------------------------------------------

export interface HeroStatsView {
  readonly scopeId: string;
  /** Nome atual do Agent ou do Loadout. Nulo quando a entidade foi apagada. */
  readonly name: string | null;
  readonly xp: number;
  readonly level: number;
  readonly xpToNextLevel: number;
  readonly expeditions: number;
  readonly victories: number;
  readonly defeats: number;
  readonly monstersSlain: number;
  readonly tokens: number;
  readonly topHarness: string | null;
}

export interface HeroStatsResult {
  readonly agents: HeroStatsView[];
  readonly loadouts: HeroStatsView[];
}

function toHeroView(row: HeroStatsRow, name: string | null, xpToNext: number): HeroStatsView {
  return {
    scopeId: row.scopeId,
    name,
    xp: row.xp,
    level: row.level,
    xpToNextLevel: xpToNext,
    expeditions: row.expeditions,
    victories: row.victories,
    defeats: row.defeats,
    monstersSlain: row.monstersSlain,
    tokens: row.tokens,
    topHarness: row.topHarness,
  };
}

/**
 * As estatísticas por Herói e por Equipamento, com os nomes atuais.
 *
 * O nome vem por junção na leitura, e não gravado na linha: uma estatística é
 * um acumulado, não um registro histórico, e ela deve acompanhar a renomeação
 * do Herói. Um Herói apagado mantém as estatísticas com o nome nulo — o que ele
 * fez continua tendo acontecido.
 */
export async function readHeroStats(
  db: DatabaseExecutor,
  input: { userId: string; xpToNextLevel: (xp: number) => number },
): Promise<HeroStatsResult> {
  const rows = await db
    .select()
    .from(heroStats)
    .where(eq(heroStats.userId, input.userId))
    .orderBy(desc(heroStats.xp), asc(heroStats.scopeId));

  const nomes = new Map<string, string>();

  const agentIds = rows.filter((row) => row.scope === "AGENT").map((row) => row.scopeId);
  if (agentIds.length > 0) {
    const encontrados = await db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(and(eq(agents.userId, input.userId), inArray(agents.id, agentIds)));
    for (const agent of encontrados) nomes.set(`AGENT:${agent.id}`, agent.name);
  }

  const loadoutIds = rows.filter((row) => row.scope === "LOADOUT").map((row) => row.scopeId);
  if (loadoutIds.length > 0) {
    const encontrados = await db
      .select({ id: loadouts.id, name: loadouts.name })
      .from(loadouts)
      .where(and(eq(loadouts.userId, input.userId), inArray(loadouts.id, loadoutIds)));
    for (const loadout of encontrados) nomes.set(`LOADOUT:${loadout.id}`, loadout.name);
  }

  const view = (scope: "AGENT" | "LOADOUT"): HeroStatsView[] =>
    rows
      .filter((row) => row.scope === scope)
      .map((row) =>
        toHeroView(row, nomes.get(`${scope}:${row.scopeId}`) ?? null, input.xpToNextLevel(row.xp)),
      );

  return { agents: view("AGENT"), loadouts: view("LOADOUT") };
}

/** A condição gravada, tipada. Existe para o projetor não repetir o `as`. */
export function definitionCondition(row: AchievementDefinitionRow): Condition {
  return row.condition;
}
