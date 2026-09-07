CREATE TYPE "public"."workspace_kind" AS ENUM('GIT_REPO', 'FOLDER');--> statement-breakpoint
CREATE TYPE "public"."agent_role" AS ENUM('ARCHITECT', 'ENGINEER', 'REVIEWER', 'EXPLORER');--> statement-breakpoint
CREATE TYPE "public"."enforcement_level" AS ENUM('ADVISORY', 'HARNESS_NATIVE', 'SANDBOX_ENFORCED');--> statement-breakpoint
CREATE TYPE "public"."execution_mode" AS ENUM('HOST', 'DOCKER');--> statement-breakpoint
CREATE TYPE "public"."harness_key" AS ENUM('CLAUDE_CODE', 'CODEX', 'PI', 'ANTIGRAVITY');--> statement-breakpoint
CREATE TYPE "public"."workspace_strategy" AS ENUM('CURRENT', 'GIT_WORKTREE', 'COPY');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('CREATED', 'QUEUED', 'PREPARING', 'RUNNING', 'WAITING_APPROVAL', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "agent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" "agent_role" NOT NULL,
	"instructions" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_user_name_uq" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "execution_profile" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mode" "execution_mode" NOT NULL,
	"workspace_strategy" "workspace_strategy" NOT NULL,
	"enforcement" "enforcement_level" NOT NULL,
	"permission_policy" jsonb NOT NULL,
	"environment_policy" jsonb NOT NULL,
	"network_policy" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_profile_user_name_uq" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "harness" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"key" "harness_key" NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"capabilities" jsonb NOT NULL,
	"installed_version" text,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "harness_user_key_uq" UNIQUE("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "loadout" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"harness_id" uuid NOT NULL,
	"model_id" uuid,
	"execution_profile_id" uuid NOT NULL,
	"skills" jsonb NOT NULL,
	"tools" jsonb NOT NULL,
	"mcp_servers" jsonb NOT NULL,
	"knowledge_policy" jsonb NOT NULL,
	"context_policy" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loadout_user_name_uq" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "model" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"harness_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_harness_key_uq" UNIQUE("harness_id","key")
);
--> statement-breakpoint
CREATE TABLE "run_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_event_run_sequence_uq" UNIQUE("run_id","sequence"),
	CONSTRAINT "run_event_sequence_positive_ck" CHECK ("sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'CREATED' NOT NULL,
	"harness_key" "harness_key" NOT NULL,
	"harness_version" text,
	"harness_session_id" text,
	"model_key" text,
	"execution_mode" "execution_mode" NOT NULL,
	"workspace_path" text,
	"workflow_version_id" uuid,
	"loadout_id" uuid NOT NULL,
	"loadout_version" integer NOT NULL,
	"loadout_snapshot" jsonb NOT NULL,
	"execution_profile_snapshot" jsonb NOT NULL,
	"prompt" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"result" jsonb,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_task_attempt_uq" UNIQUE("task_id","attempt")
);
--> statement-breakpoint
CREATE TABLE "workspace_lock" (
	"user_id" uuid NOT NULL,
	"repo_path" text NOT NULL,
	"checkout_path" text NOT NULL,
	"run_id" uuid NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_lock_pk" PRIMARY KEY("repo_path","checkout_path")
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "workspace_kind" "workspace_kind" DEFAULT 'GIT_REPO' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "workspace_path" text;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_profile" ADD CONSTRAINT "execution_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness" ADD CONSTRAINT "harness_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loadout" ADD CONSTRAINT "loadout_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loadout" ADD CONSTRAINT "loadout_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loadout" ADD CONSTRAINT "loadout_harness_id_harness_id_fk" FOREIGN KEY ("harness_id") REFERENCES "public"."harness"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loadout" ADD CONSTRAINT "loadout_model_id_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loadout" ADD CONSTRAINT "loadout_execution_profile_id_execution_profile_id_fk" FOREIGN KEY ("execution_profile_id") REFERENCES "public"."execution_profile"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model" ADD CONSTRAINT "model_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model" ADD CONSTRAINT "model_harness_id_harness_id_fk" FOREIGN KEY ("harness_id") REFERENCES "public"."harness"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_event" ADD CONSTRAINT "run_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_event" ADD CONSTRAINT "run_event_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_loadout_id_loadout_id_fk" FOREIGN KEY ("loadout_id") REFERENCES "public"."loadout"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_lock" ADD CONSTRAINT "workspace_lock_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_lock" ADD CONSTRAINT "workspace_lock_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loadout_agent_idx" ON "loadout" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "loadout_harness_idx" ON "loadout" USING btree ("harness_id");--> statement-breakpoint
CREATE INDEX "loadout_execution_profile_idx" ON "loadout" USING btree ("execution_profile_id");--> statement-breakpoint
CREATE INDEX "model_harness_idx" ON "model" USING btree ("harness_id","name");--> statement-breakpoint
CREATE INDEX "run_task_idx" ON "run" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "run_user_status_idx" ON "run" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "workspace_lock_run_idx" ON "workspace_lock" USING btree ("run_id");--> statement-breakpoint
-- Daqui para baixo é escrito à mão: o Drizzle não modela triggers, então este
-- trecho não aparece no snapshot de `drizzle/meta` e `pnpm db:check` continua
-- verde. Mesmo padrão da migração `0001` para `dashboard_event`, adaptado do
-- Archon (packages/core/src/db/adapters/postgres.ts@0773b97).
--
-- O NOTIFY não carrega payload (documento técnico, seção 10.1): ele só acorda o
-- drain por cursor da API, que lê `run_event` a partir da última `sequence`
-- entregue àquele Run. Sem payload, o canal também não vaza conteúdo de
-- execução para quem der `LISTEN` no banco.
--
-- `FOR EACH STATEMENT`, e não `FOR EACH ROW`: um `INSERT` em lote de eventos de
-- um Run acorda o drain uma vez, não N vezes, e o PostgreSQL já colapsa
-- notificações idênticas dentro da mesma transação.
--
-- O NOTIFY é transacional: só chega ao ouvinte depois do COMMIT. É o que faz o
-- status terminal do Run, a transição da Task e os eventos finais chegarem
-- juntos à tela, ou não chegarem.
CREATE OR REPLACE FUNCTION dm_notify_run_event() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('dm_run_event', '');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS run_event_notify ON "run_event";--> statement-breakpoint
CREATE TRIGGER run_event_notify
  AFTER INSERT ON "run_event"
  FOR EACH STATEMENT EXECUTE FUNCTION dm_notify_run_event();
