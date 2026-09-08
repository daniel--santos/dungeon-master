import {
  WORKFLOW_STEP_TYPE_VALUES,
  type WorkflowDefinition,
  type WorkflowStepDefinition,
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

import { users } from "./user.js";

/**
 * Workflow, WorkflowVersion e WorkflowStep (planejamento v0.4, Fase 4).
 *
 * Três tabelas para uma ideia: a definição **vigente** (`workflow`), as
 * definições **congeladas** que Runs referenciam (`workflow_version`) e os
 * steps de cada versão como linhas próprias (`workflow_step`), para o RunStep
 * ter a que apontar sem reabrir o JSON.
 *
 * `run_step` e `approval_gate` moram em `run-step.ts`, e não aqui, porque
 * dependem de `run`, e `run` depende de `workflow_version`: um arquivo só
 * fecharia um ciclo de imports entre os módulos do schema.
 */

/**
 * Minúsculo, como no contrato: é vocabulário de um documento escrito pelo
 * usuário, não um enum da máquina de estados.
 */
export const workflowStepType = pgEnum("workflow_step_type", WORKFLOW_STEP_TYPE_VALUES);

/**
 * A definição vigente de um Workflow.
 *
 * `name` e `description` repetem `definition.name` e `definition.description`
 * de propósito: o nome precisa de índice único e a listagem lê só as colunas;
 * o documento inteiro é o que a captura congela. Quem escreve mantém os dois
 * iguais, e é uma função só (`createWorkflow`/`updateWorkflow`).
 */
export const workflows = pgTable(
  "workflow",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    definition: jsonb("definition").$type<WorkflowDefinition>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique("workflow_user_name_uq").on(table.userId, table.name)],
);

/**
 * Uma definição congelada.
 *
 * Imutável: sem `updated_at`, e nenhuma função de escrita faz `UPDATE` aqui.
 * `version` é sequencial por Workflow, e a captura só cria uma linha nova
 * quando a definição mudou desde a última — comparação canônica do JSON, em
 * `captureWorkflowVersion`. `on delete cascade` do Workflow para cá é seguro
 * porque `run.workflow_version_id` é `restrict`: um Workflow com versão usada
 * por Run não pode ser apagado, e a API diz isso no `409` antes de o banco
 * precisar recusar.
 */
export const workflowVersions = pgTable(
  "workflow_version",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    definition: jsonb("definition").$type<WorkflowDefinition>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("workflow_version_workflow_version_uq").on(table.workflowId, table.version),
    check("workflow_version_positive_ck", sql`"version" > 0`),
  ],
);

/**
 * Um step de uma versão, materializado.
 *
 * `position` é a ordem topológica calculada na captura, e `definition` é o
 * pedaço do documento que descreve só este step. Tão imutável quanto a versão.
 */
export const workflowSteps = pgTable(
  "workflow_step",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workflowVersionId: uuid("workflow_version_id")
      .notNull()
      .references(() => workflowVersions.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    type: workflowStepType("type").notNull(),
    position: integer("position").notNull(),
    definition: jsonb("definition").$type<WorkflowStepDefinition>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("workflow_step_version_key_uq").on(table.workflowVersionId, table.key),
    index("workflow_step_version_position_idx").on(table.workflowVersionId, table.position),
    check("workflow_step_position_nonnegative_ck", sql`"position" >= 0`),
  ],
);

export type WorkflowRow = typeof workflows.$inferSelect;
export type NewWorkflowRow = typeof workflows.$inferInsert;
export type WorkflowVersionRow = typeof workflowVersions.$inferSelect;
export type NewWorkflowVersionRow = typeof workflowVersions.$inferInsert;
export type WorkflowStepRow = typeof workflowSteps.$inferSelect;
export type NewWorkflowStepRow = typeof workflowSteps.$inferInsert;
