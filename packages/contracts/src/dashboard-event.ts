import { z } from "zod";

import { ACTIVITY_TYPE_VALUES } from "./activity.js";

/**
 * Evento de dashboard: a unidade que a API empurra por SSE para a web.
 *
 * O modelo é o da seção 10.1 do documento técnico: o produtor grava a linha em
 * `dashboard_event` e o PostgreSQL emite um `NOTIFY` **sem payload**. A API faz
 * o *drain* a partir do último cursor e empurra o que leu. Cursor, mapeamento e
 * deduplicação ficam num lugar só, então uma notificação perdida ou coalescida
 * nunca dessincroniza o browser.
 *
 * `sequence` é a chave de reconexão: o browser guarda o último que recebeu e o
 * devolve em `?since=` (ou no header `Last-Event-ID`) quando reconecta.
 */

/**
 * Tipos de evento que o sistema emite hoje.
 *
 * O enum é fechado no **lado de quem escreve**: `appendDashboardEvent` só
 * aceita um destes.
 *
 * Os tipos de domínio são exatamente os de `ActivityType`, reaproveitados em
 * vez de reescritos: cada mudança de Project ou de Task grava uma linha de
 * `activity` e um evento deste tipo na mesma transação, e dois vocabulários
 * para o mesmo fato divergiriam na primeira adição.
 */
/**
 * Mudanças nos cadastros de execução.
 *
 * Ficam fora de `ActivityType` porque `activity` é o diário de um **Project**, e
 * um Agent ou um Loadout não pertencem a Project nenhum: gravar a criação de um
 * Loadout no diário obrigaria a escolher um Project arbitrário para pendurar o
 * fato. Estes eventos existem só para a tela de cadastros se atualizar sozinha.
 */
export const REGISTRY_EVENT_TYPE_VALUES = [
  "harness.updated",
  "model.created",
  "model.updated",
  "model.deleted",
  "agent.created",
  "agent.updated",
  "agent.deleted",
  "execution_profile.created",
  "execution_profile.updated",
  "execution_profile.deleted",
  "loadout.created",
  "loadout.updated",
  "loadout.deleted",
  // Workflow é cadastro pelo mesmo critério: não pertence a Project nenhum.
  "workflow.created",
  "workflow.updated",
  "workflow.deleted",
  // Os registros da Fase 8A (Skill, Tool, servidor MCP, Provider) saem num
  // tipo só, com `kind` no payload: são quatro cadastros com o mesmo ciclo, e
  // a tela que os mostra é uma.
  "registry.changed",
] as const;

export const RegistryEventTypeSchema = z.enum(REGISTRY_EVENT_TYPE_VALUES).meta({
  id: "RegistryEventType",
  description: "Mudanças nos cadastros de execução, que não pertencem a um Project.",
});

export type RegistryEventType = z.infer<typeof RegistryEventTypeSchema>;

/** Qual registro da Fase 8A mudou. São os nomes das tabelas. */
export const REGISTRY_KIND_VALUES = ["skill", "tool", "mcp_server", "provider"] as const;

export const RegistryKindSchema = z.enum(REGISTRY_KIND_VALUES).meta({
  id: "RegistryKind",
  description: "O registro que `registry.changed` anuncia.",
});

export type RegistryKind = z.infer<typeof RegistryKindSchema>;

export const REGISTRY_ACTION_VALUES = ["created", "updated", "deleted"] as const;

/** O payload de `registry.changed`. Fechado na escrita, como o tipo do evento. */
export const RegistryChangedPayloadSchema = z
  .object({
    kind: RegistryKindSchema,
    id: z.uuid(),
    action: z.enum(REGISTRY_ACTION_VALUES),
  })
  .meta({ id: "RegistryChangedPayload", description: "O que `registry.changed` carrega." });

export type RegistryChangedPayload = z.infer<typeof RegistryChangedPayloadSchema>;

/**
 * O que o projetor de Conquistas emite (planejamento v0.4, Fase 2.5B).
 *
 * Ficam fora de `ActivityType` porque não são fatos de um Project: são
 * projeção. Os dois saem na **mesma transação** do desbloqueio, e é isso que
 * garante que a tela nunca receba um toast de uma Conquista que o banco não
 * tem.
 */
export const ACHIEVEMENT_EVENT_TYPE_VALUES = [
  "achievement.unlocked",
  "hero_stats.updated",
] as const;

export const AchievementEventTypeSchema = z.enum(ACHIEVEMENT_EVENT_TYPE_VALUES).meta({
  id: "AchievementEventType",
  description: "Eventos de projeção das Conquistas: desbloqueio e estatísticas de Herói.",
});

export type AchievementEventType = z.infer<typeof AchievementEventTypeSchema>;

/**
 * O que o gate de aprovação emite (planejamento v0.4, Fase 4).
 *
 * Ficam fora de `ActivityType` porque o diário do Project já recebe o
 * `run.status_changed` que acompanha o gate; estes dois existem para a tela
 * de aprovações pendentes reagir sem repetir o fato no diário. Saem na
 * **mesma transação** do gate, então a tela nunca vê um pedido que o banco
 * não tem nem uma decisão que o CAS recusou.
 */
export const APPROVAL_EVENT_TYPE_VALUES = ["approval.requested", "approval.resolved"] as const;

export const ApprovalEventTypeSchema = z.enum(APPROVAL_EVENT_TYPE_VALUES).meta({
  id: "ApprovalEventType",
  description: "Eventos do gate de aprovação: pedido aberto e decisão gravada.",
});

export type ApprovalEventType = z.infer<typeof ApprovalEventTypeSchema>;

/**
 * O que o resultado de um Run e a decisão sobre uma proposta emitem
 * (planejamento v0.4, Fase 5).
 *
 * Ficam fora de `ActivityType` pelo mesmo critério do gate: o diário do
 * Project já recebe o `run.status_changed` do desfecho e o `task.created` da
 * aprovação; estes dois existem para a tela de propostas reagir sem repetir o
 * fato. `task.proposed` sai na **mesma transação** que grava `run.result` e as
 * linhas de `proposed_task`; `task.proposal.resolved` sai na transação do CAS
 * da decisão. A tela nunca vê uma proposta que o banco não tem.
 */
export const PROPOSAL_EVENT_TYPE_VALUES = ["task.proposed", "task.proposal.resolved"] as const;

export const ProposalEventTypeSchema = z.enum(PROPOSAL_EVENT_TYPE_VALUES).meta({
  id: "ProposalEventType",
  description: "Eventos de proposta de trabalho: propostas gravadas e decisão tomada.",
});

export type ProposalEventType = z.infer<typeof ProposalEventTypeSchema>;

/**
 * O que o Distiller e a revisão do Grimório emitem (planejamento v0.4, Fase 6).
 *
 * `knowledge.distilled` sai na transação que grava as decisões de um lote, com
 * as contagens; `knowledge.item.reviewed` sai na transação do CAS de aprovação
 * ou recusa de um item; `knowledge_item.promoted` é o fato que o projetor de
 * Conquistas consome (é a fonte de "Escriba do Grimório") e sai quando um item
 * **fica ativo** — na promoção sem revisão, ou na aprovação com ela —, nunca
 * antes; `achievement.forged` sai quando o lote grava uma Conquista forjada em
 * revisão, para a tela avisar sem mostrá-la no Hall.
 */
export const KNOWLEDGE_EVENT_TYPE_VALUES = [
  "knowledge.distilled",
  "knowledge.item.reviewed",
  "knowledge_item.promoted",
  "achievement.forged",
] as const;

export const KnowledgeEventTypeSchema = z.enum(KNOWLEDGE_EVENT_TYPE_VALUES).meta({
  id: "KnowledgeEventType",
  description: "Eventos do Grimório: lote destilado, item revisado, item ativo e forjada proposta.",
});

export type KnowledgeEventType = z.infer<typeof KnowledgeEventTypeSchema>;

export const DASHBOARD_EVENT_TYPE_VALUES = [
  "system.ping",
  "settings.changed",
  ...ACTIVITY_TYPE_VALUES,
  ...REGISTRY_EVENT_TYPE_VALUES,
  ...ACHIEVEMENT_EVENT_TYPE_VALUES,
  ...APPROVAL_EVENT_TYPE_VALUES,
  ...PROPOSAL_EVENT_TYPE_VALUES,
  ...KNOWLEDGE_EVENT_TYPE_VALUES,
] as const;

export const DashboardEventTypeSchema = z
  .enum(DASHBOARD_EVENT_TYPE_VALUES)
  .meta({ id: "DashboardEventType", description: "Tipos de evento de dashboard emitidos hoje." });

export type DashboardEventType = z.infer<typeof DashboardEventTypeSchema>;

/**
 * Corpo de um evento no stream.
 *
 * `type` é `string`, e não o enum, de propósito: quem **lê** o stream precisa
 * tolerar um tipo que ainda não conhece. Um cliente de uma versão anterior
 * continua funcionando quando a API passa a emitir um tipo novo, em vez de
 * quebrar a validação da resposta inteira. O fechamento vale na escrita.
 */
export const DashboardEventSchema = z
  .object({
    sequence: z
      .number()
      .int()
      .positive()
      .describe("Cursor do evento. Estritamente crescente; é o `id` do evento SSE."),
    type: z.string().describe("Tipo do evento. Os emitidos hoje estão em `DashboardEventType`."),
    payload: z.unknown().describe("Dados do evento, em JSON. A forma depende do `type`."),
    createdAt: z.iso.datetime().describe("Instante da gravação, em UTC (ISO 8601)."),
  })
  .meta({ id: "DashboardEvent", description: "Um evento entregue pelo stream SSE." });

export type DashboardEvent = z.infer<typeof DashboardEventSchema>;

/** Canal de `LISTEN`/`NOTIFY` do PostgreSQL. O `NOTIFY` não carrega payload. */
export const DASHBOARD_EVENT_CHANNEL = "dm_dashboard_event" as const;

/** Resposta de `POST /api/v1/events/ping`. */
export const PingEventResponseSchema = z
  .object({
    event: DashboardEventSchema,
  })
  .meta({ id: "PingEventResponse", description: "O evento `system.ping` recém-gravado." });

export type PingEventResponse = z.infer<typeof PingEventResponseSchema>;
