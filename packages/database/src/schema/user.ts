import type { JsonValue } from "@dungeon-master/contracts";
import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * O sistema é single-user por decisão de produto, mas toda tabela já nasce
 * escopada por `user_id`. Um usuário local é semeado por `pnpm db:seed`.
 *
 * `id` é UUIDv7 gerado na aplicação (`newId()`), não pelo banco.
 * Todo timestamp é `timestamptz` e é lido e escrito em UTC.
 */
export const users = pgTable("user", {
  id: uuid("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * Par chave/valor por usuário. Guarda, entre outras coisas, a preferência do
 * interruptor "Tema Dungeon Master" (planejamento v0.4, seção 47.1).
 * A chave primária é composta por (`user_id`, `key`).
 */
export const userSettings = pgTable(
  "user_setting",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").$type<JsonValue>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.key], name: "user_setting_pk" })],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type UserSettingRow = typeof userSettings.$inferSelect;
export type NewUserSettingRow = typeof userSettings.$inferInsert;
