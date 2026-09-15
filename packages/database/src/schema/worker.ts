import type { WorkerHarness } from "@dungeon-master/contracts";
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./user.js";

/**
 * Presença de Worker (planejamento v0.4, Fase 10A).
 *
 * Até aqui o Worker não tinha linha nenhuma: a identidade dele existia só como
 * texto em `run.claimed_by`, e a reconciliação de partida adivinhava se o dono
 * de um Run estava vivo olhando o PID quando o host coincidia (post-mortem #6,
 * em `apps/worker/src/reconcile.ts`). Aquilo nunca foi um lease — um Worker de
 * outra máquina era indistinguível de um morto, e o comentário registrava que o
 * conserto pedia coluna nova, portanto migração. Esta é a migração.
 *
 * ## `id` é `text`, e é o `workerId`
 *
 * Não é um UUID novo: é exatamente o `host#pid#uuid` que já ia para
 * `run.claimed_by`. Um id próprio obrigaria a manter um mapa entre os dois, e
 * o primeiro Run reclamado por um Worker de uma versão anterior — sem linha
 * aqui — não teria como ser resolvido. Com a mesma chave, "quem reclamou este
 * Run?" vira um `join`, e "reclamado por alguém que nunca existiu nesta tabela"
 * continua significando o que significava antes: órfão.
 *
 * ## `stale_at` não é o estado
 *
 * O estado (`ONLINE`/`STALE`/`OFFLINE`) é calculado na leitura, subtraindo dois
 * instantes: gravá-lo exigiria alguém escrevendo `STALE` no segundo exato em
 * que o prazo vence. `stale_at` é outra coisa — a marca de que a transição já
 * foi **anunciada**, e é ela que faz `worker.stale` sair uma vez só mesmo com
 * três Workers vivos varrendo a tabela ao mesmo tempo.
 */
export const workers = pgTable(
  "worker",
  {
    /** O `workerId` do processo: `host#pid#uuid`. O mesmo de `run.claimed_by`. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull(),
    pid: integer("pid").notNull(),
    /** Versão da app do Worker, para o operador saber o que está no ar. */
    version: text("version").notNull(),
    nodeVersion: text("node_version").notNull(),
    /** Teto de Runs simultâneos deste processo. */
    capacity: integer("capacity").notNull(),
    /**
     * O resumo medido no boot: chave, versão e credencial de cada Harness.
     *
     * `jsonb` e não junção com `harness`: aquela tabela é o cadastro **do
     * usuário**, e isto é o que **esta máquina, neste processo** mediu. Duas
     * máquinas com CLIs diferentes precisam de duas respostas, e a junção só
     * saberia dar uma.
     */
    harnesses: jsonb("harnesses").$type<WorkerHarness[]>().notNull().default([]),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /** Preenchido só no desligamento gracioso. Nulo enquanto vivo — ou morto de repente. */
    stoppedAt: timestamp("stopped_at", { withTimezone: true, mode: "date" }),
    /** Quando a varredura anunciou o silêncio. Torna `worker.stale` idempotente. */
    staleAt: timestamp("stale_at", { withTimezone: true, mode: "date" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // A varredura é "deste usuário, quem não bate desde quando?".
    index("worker_user_heartbeat_idx").on(table.userId, table.lastHeartbeatAt),
    check("worker_pid_positive_ck", sql`"pid" > 0`),
    check("worker_capacity_positive_ck", sql`"capacity" > 0`),
  ],
);

export type WorkerRow = typeof workers.$inferSelect;
export type NewWorkerRow = typeof workers.$inferInsert;
