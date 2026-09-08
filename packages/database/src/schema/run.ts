import {
  type ExecutionProfileSnapshot,
  type LoadoutSnapshot,
  RUN_STATUS_VALUES,
  type RunError,
  type RunResult,
} from "@dungeon-master/contracts";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { executionMode, harnessKey, loadouts } from "./execution.js";
import { tasks } from "./task.js";
import { users } from "./user.js";
import { workflowVersions } from "./workflow.js";

export const runStatus = pgEnum("run_status", RUN_STATUS_VALUES);

/**
 * Run é uma tentativa concreta de realizar uma Task (documento técnico, 5.1).
 *
 * A fila **é** esta tabela: `status = 'QUEUED'` é o que o worker reclama com
 * `SELECT ... FOR UPDATE SKIP LOCKED`. Uma fila separada precisaria de uma
 * segunda verdade sobre o mesmo fato, e as duas divergiriam no primeiro crash
 * entre o `INSERT` na fila e o `UPDATE` no Run.
 *
 * `harness_key` e `model_key` são **cópias** do Loadout, e não junções: o Run
 * precisa continuar dizendo com o que rodou depois de alguém trocar o Model do
 * Loadout ou apagá-lo. `loadout_snapshot` e `execution_profile_snapshot`
 * seguem a mesma lógica no corpo inteiro (documento técnico, seção 13).
 *
 * `cancel_requested_at` é separado do `status` de propósito: pedir o
 * cancelamento não é cancelar. Quem transiciona para `CANCELLED` é quem matou a
 * árvore de processos e confirmou o término (planejamento v0.4, Fase 2A) — ou a
 * API, quando o Run ainda está `CREATED`/`QUEUED` e não há árvore nenhuma.
 */
export const runs = pgTable(
  "run",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    status: runStatus("status").notNull().default("CREATED"),
    harnessKey: harnessKey("harness_key").notNull(),
    harnessVersion: text("harness_version"),
    harnessSessionId: text("harness_session_id"),
    modelKey: text("model_key"),
    executionMode: executionMode("execution_mode").notNull(),
    workspacePath: text("workspace_path"),
    /**
     * A captura congelada do Workflow da Task no instante da criação.
     *
     * `restrict`, e não `set null`: um Run que perdesse a versão perderia a
     * explicação de por que os RunSteps dele existem. Apagar um Workflow com
     * Run é recusado pela API com `409`, e este `restrict` é a rede por baixo.
     */
    workflowVersionId: uuid("workflow_version_id").references(() => workflowVersions.id, {
      onDelete: "restrict",
    }),
    /**
     * Identidade do processo de Worker que reclamou este Run.
     *
     * Existe para a reconciliação de partida distinguir "meu" de "órfão": um
     * Worker que sobe encontra Runs em `PREPARING`/`RUNNING` e precisa saber se
     * eles são de uma execução viva ou o rastro de um processo que morreu. Um
     * `worker_id` novo por processo torna a resposta trivial — o que não é meu
     * não tem dono, porque só existe um Worker por vez.
     *
     * Fica fora do contrato `Run` de propósito: é estado de infraestrutura, e
     * nada na interface muda por causa dele.
     */
    claimedBy: text("claimed_by"),
    /**
     * Run de onde a sessão do harness foi retomada.
     *
     * `on delete set null`: apagar a tentativa antiga não pode apagar a nova, e
     * perder o vínculo é melhor que perder o Run. A sessão em si continua no
     * `harness_session_id` do Run de origem — é dele que o Worker lê o id.
     */
    resumedFromRunId: uuid("resumed_from_run_id").references((): AnyPgColumn => runs.id, {
      onDelete: "set null",
    }),
    loadoutId: uuid("loadout_id")
      .notNull()
      .references(() => loadouts.id, { onDelete: "restrict" }),
    loadoutVersion: integer("loadout_version").notNull(),
    loadoutSnapshot: jsonb("loadout_snapshot").$type<LoadoutSnapshot>().notNull(),
    executionProfileSnapshot: jsonb("execution_profile_snapshot")
      .$type<ExecutionProfileSnapshot>()
      .notNull(),
    prompt: text("prompt").notNull(),
    attempt: integer("attempt").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true, mode: "date" }),
    result: jsonb("result").$type<RunResult>(),
    error: jsonb("error").$type<RunError>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // O histórico de tentativas de uma Task, da mais recente para a mais antiga.
    index("run_task_idx").on(table.taskId, table.createdAt),
    // A fila e os filtros da tela de Expedições usam exatamente estas colunas.
    index("run_user_status_idx").on(table.userId, table.status, table.createdAt),
    unique("run_task_attempt_uq").on(table.taskId, table.attempt),
  ],
);

/**
 * O log append-only de uma execução (documento técnico, seção 11).
 *
 * `UNIQUE (run_id, sequence)` é a garantia de que o cursor do SSE faz sentido:
 * a `sequence` é atribuída dentro da transação que insere a linha, com a linha
 * do Run travada, então ela é **estritamente crescente e sem lacunas** por Run.
 *
 * Uma sequência do PostgreSQL por Run seria mais barata e daria a garantia
 * errada: sequências não voltam atrás em `ROLLBACK`, e o buraco que sobrasse
 * faria a marca d'água do poller (planejamento v0.4, Fase 2B) esperar para
 * sempre por um evento que nunca existiu.
 *
 * Não tem `updated_at`, pelo mesmo motivo de `activity`: um registro que pode
 * ser editado depois não serve de registro.
 */
export const runEvents = pgTable(
  "run_event",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    // `text` e não enum, como em `activity`: o vocabulário de `ExecutionEvent`
    // cresce a cada harness novo, e um `ALTER TYPE` por evento seria cerimônia.
    // O fechamento vale no lado de quem escreve.
    type: text("type").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("run_event_run_sequence_uq").on(table.runId, table.sequence),
    check("run_event_sequence_positive_ck", sql`"sequence" > 0`),
  ],
);

/**
 * Um Run ativo por par (repositório, caminho de checkout).
 *
 * O Sandcastle projetou o locking de worktree e não o implementou: dois `run()`
 * concorrentes com a mesma branch nomeada recebem o mesmo diretório e corrompem
 * em silêncio (documento técnico, seção 16). A trava mora aqui, e é conferida
 * **antes de qualquer processo subir**.
 *
 * A chave primária composta é a trava: o PostgreSQL recusa a segunda linha, e
 * não há janela entre "verifiquei" e "peguei".
 */
export const workspaceLocks = pgTable(
  "workspace_lock",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repoPath: text("repo_path").notNull(),
    checkoutPath: text("checkout_path").notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    acquiredAt: timestamp("acquired_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.repoPath, table.checkoutPath], name: "workspace_lock_pk" }),
    // "Qual caminho este Run segura?" é a pergunta que a liberação faz.
    index("workspace_lock_run_idx").on(table.runId),
  ],
);

export type RunRow = typeof runs.$inferSelect;
export type NewRunRow = typeof runs.$inferInsert;
export type RunEventRow = typeof runEvents.$inferSelect;
export type NewRunEventRow = typeof runEvents.$inferInsert;
export type WorkspaceLockRow = typeof workspaceLocks.$inferSelect;
export type NewWorkspaceLockRow = typeof workspaceLocks.$inferInsert;
