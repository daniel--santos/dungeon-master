import { z } from "zod";

import { PageQuerySchema, paginatedSchema } from "./pagination.js";

/**
 * `activity` é o diário append-only de um Project.
 *
 * Toda criação, edição e transição de status grava uma linha na **mesma
 * transação** da mudança. Sem isso o diário viraria uma reconstrução aproximada
 * do que aconteceu, em vez do registro do que aconteceu.
 *
 * O vocabulário é o mesmo dos eventos de dashboard, e não um segundo conjunto
 * de nomes: cada escrita gera uma linha de `activity` e um `dashboard_event` do
 * mesmo tipo, um para o histórico do Project e outro para acordar a tela.
 */

export const ACTIVITY_TYPE_VALUES = [
  "project.created",
  "project.updated",
  "task.created",
  "task.updated",
  "task.status_changed",
  "task.dependency_created",
  "task.dependency_removed",
] as const;

export const ActivityTypeSchema = z.enum(ACTIVITY_TYPE_VALUES).meta({
  id: "ActivityType",
  description: "O que aconteceu. Mesmo vocabulário dos eventos de dashboard de domínio.",
});

export type ActivityType = z.infer<typeof ActivityTypeSchema>;

/**
 * Uma linha do diário.
 *
 * `type` é o enum fechado, e não texto livre como no `DashboardEvent`: o stream
 * SSE precisa que um cliente antigo tolere um tipo novo, mas a lista de
 * activity é buscada pela mesma versão da web que a renderiza, e a união
 * fechada é o que permite um `switch` exaustivo para escolher o label.
 */
export const ActivitySchema = z
  .object({
    id: z.uuid().describe("UUIDv7 da linha."),
    projectId: z.uuid().nullable().describe("Project a que o registro pertence."),
    taskId: z.uuid().nullable().describe("Task envolvida, quando houver."),
    type: ActivityTypeSchema,
    payload: z.unknown().describe("Dados do registro, em JSON. A forma depende do `type`."),
    createdAt: z.iso.datetime().describe("Instante da gravação, em UTC (ISO 8601)."),
  })
  .meta({ id: "Activity", description: "Um registro do diário append-only de um Project." });

export type Activity = z.infer<typeof ActivitySchema>;

export const ActivityListQuerySchema = PageQuerySchema.meta({ id: "ActivityListQuery" });

export type ActivityListQuery = z.infer<typeof ActivityListQuerySchema>;

export const ActivityPageSchema = paginatedSchema(
  ActivitySchema,
  "ActivityPage",
  "Uma página do diário, do registro mais recente para o mais antigo.",
);

export type ActivityPage = z.infer<typeof ActivityPageSchema>;
