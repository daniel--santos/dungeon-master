import {
  APPROVAL_GATE_STATUS_VALUES,
  RUN_STEP_STATUS_VALUES,
  type RunStepError,
  type RunStepResult,
} from "@dungeon-master/contracts";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { runs } from "./run.js";
import { users } from "./user.js";
import { workflowSteps, workflowStepType } from "./workflow.js";

export const runStepStatus = pgEnum("run_step_status", RUN_STEP_STATUS_VALUES);
export const approvalGateStatus = pgEnum("approval_gate_status", APPROVAL_GATE_STATUS_VALUES);

/**
 * RunStep: um step de um Run, com estado próprio (planejamento v0.4, Fase 4).
 *
 * Nasce em `PENDING` na **mesma transação** que cria o Run e captura a
 * versão: um Run com `workflow_version_id` e sem RunSteps seria um Run que o
 * motor não sabe por onde começar. `key`, `name` e `type` são cópias do
 * WorkflowStep, pelo mesmo motivo de `harness_key` no Run: a linha precisa
 * continuar legível sozinha.
 *
 * `UNIQUE (run_id, key)` é o que faz a retomada segura: o motor procura o
 * step pela chave, e um Run reclamado de novo encontra o mesmo RunStep em
 * vez de criar outro.
 */
export const runSteps = pgTable(
  "run_step",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    // `restrict`: a versão congelada que o Run executa não pode sumir debaixo
    // dele. Apagar o Workflow com Run é recusado antes, na API.
    workflowStepId: uuid("workflow_step_id")
      .notNull()
      .references(() => workflowSteps.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    type: workflowStepType("type").notNull(),
    position: integer("position").notNull(),
    status: runStepStatus("status").notNull().default("PENDING"),
    attempt: integer("attempt").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    result: jsonb("result").$type<RunStepResult>(),
    error: jsonb("error").$type<RunStepError>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("run_step_run_key_uq").on(table.runId, table.key),
    // "Quais steps deste Run ainda estão PENDING?" é a pergunta do motor a cada volta.
    index("run_step_run_status_idx").on(table.runId, table.status),
    check("run_step_attempt_nonnegative_ck", sql`"attempt" >= 0`),
  ],
);

/**
 * ApprovalGate: um pedido de aprovação humana dentro de um Run.
 *
 * `UNIQUE (run_id, gate_key)` é o que impede um Run retomado de pular o gate
 * humano ou de criar um segundo (documento técnico, seção 19.1, item 4): a
 * criação é `ON CONFLICT DO NOTHING` e devolve o gate que já existe.
 *
 * A resolução é um CAS (seção 26): `UPDATE ... WHERE status = 'PENDING' AND
 * resolved_at IS NULL`, com o evento de auditoria na mesma transação. Zero
 * linhas afetadas é "outra decisão chegou antes", nunca sobrescrita.
 */
export const approvalGates = pgTable(
  "approval_gate",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    runStepId: uuid("run_step_id")
      .notNull()
      .references(() => runSteps.id, { onDelete: "cascade" }),
    gateKey: text("gate_key").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: approvalGateStatus("status").notNull().default("PENDING"),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    note: text("note"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("approval_gate_run_key_uq").on(table.runId, table.gateKey),
    // A lista de pendências da interface: por usuário, por estado, do pedido mais recente.
    index("approval_gate_user_status_idx").on(table.userId, table.status, table.requestedAt),
    // Um gate resolvido tem instante de resolução; um pendente não tem. O
    // `CHECK` fecha a metade estrutural do CAS: `PENDING` com `resolved_at`
    // preenchido seria um estado que a consulta condicional nunca esperaria.
    check("approval_gate_resolved_ck", sql`("status" = 'PENDING') = ("resolved_at" is null)`),
  ],
);

export type RunStepRow = typeof runSteps.$inferSelect;
export type NewRunStepRow = typeof runSteps.$inferInsert;
export type ApprovalGateRow = typeof approvalGates.$inferSelect;
export type NewApprovalGateRow = typeof approvalGates.$inferInsert;
