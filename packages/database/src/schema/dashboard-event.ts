import type { JsonValue } from "@dungeon-master/contracts";
import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./user.js";

/**
 * Log append-only dos eventos que a API empurra por SSE para a web.
 *
 * A chave primária é a própria `sequence`, um `bigserial`: é o cursor que o
 * browser devolve em `?since=` (ou no header `Last-Event-ID`) ao reconectar, e
 * o `id` de cada evento SSE. `mode: "number"` porque a sequência é lida como
 * número em JavaScript; `bigserial` só passaria de `Number.MAX_SAFE_INTEGER`
 * depois de 9 quatrilhões de eventos.
 *
 * Um trigger `AFTER INSERT` nesta tabela emite `pg_notify` **sem payload** no
 * canal `dm_dashboard_event`; a notificação só acorda o drain por cursor
 * (documento técnico, seção 10.1). O trigger vive na migração `0001`, escrito à
 * mão: o Drizzle não modela triggers.
 */
export const dashboardEvents = pgTable(
  "dashboard_event",
  {
    sequence: bigserial("sequence", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    // Anulável de propósito. O Drizzle não passa `null` pelo encoder da coluna
    // (`sql/sql.ts`: `param.value === null ? null : encoder.mapToDriverValue`),
    // então um `payload: null` vindo do TypeScript vira SQL NULL e nunca o JSON
    // `null`. Com `NOT NULL` isso seria um erro em tempo de execução no lugar
    // mais escondido possível; anulável, os dois lados dizem a mesma coisa:
    // "este evento não carrega dados".
    payload: jsonb("payload").$type<JsonValue>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    // O drain é sempre "do usuário X, depois da sequência N": é exatamente esta
    // ordem de colunas. Sem o índice, cada NOTIFY viraria um seq scan.
    index("dashboard_event_user_sequence_idx").on(table.userId, table.sequence),
  ],
);

export type DashboardEventRow = typeof dashboardEvents.$inferSelect;
export type NewDashboardEventRow = typeof dashboardEvents.$inferInsert;
