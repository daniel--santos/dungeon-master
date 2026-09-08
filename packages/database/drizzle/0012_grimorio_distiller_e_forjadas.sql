CREATE TYPE "public"."achievement_review_status" AS ENUM('PENDING_REVIEW', 'APPROVED', 'DISCARDED');--> statement-breakpoint
CREATE TYPE "public"."knowledge_item_status" AS ENUM('PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."knowledge_item_type" AS ENUM('FACT', 'DECISION', 'DISCOVERY', 'CONSTRAINT', 'PROCEDURE', 'SUMMARY');--> statement-breakpoint
CREATE TYPE "public"."distillation_run_status" AS ENUM('RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."distillation_trigger" AS ENUM('TIMER', 'IDLE', 'NOTIFY', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."knowledge_candidate_decision" AS ENUM('PROMOTE', 'REJECT', 'MERGE');--> statement-breakpoint
ALTER TYPE "public"."knowledge_candidate_status" ADD VALUE 'MERGED';--> statement-breakpoint
CREATE TABLE "knowledge_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"type" "knowledge_item_type" NOT NULL,
	"status" "knowledge_item_status" NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"archived_at" timestamp with time zone,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("content", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_item_reviewed_ck" CHECK (("status" in ('ACTIVE', 'REJECTED', 'ARCHIVED') or "reviewed_at" is null)),
	CONSTRAINT "knowledge_item_archived_ck" CHECK (("status" = 'ARCHIVED') = ("archived_at" is not null)),
	CONSTRAINT "knowledge_item_version_positive_ck" CHECK ("version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "distillation_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "distillation_run_status" DEFAULT 'RUNNING' NOT NULL,
	"trigger" "distillation_trigger" NOT NULL,
	"loadout_id" uuid,
	"harness_session_id" text,
	"usage" jsonb,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"promoted" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"merged" integer DEFAULT 0 NOT NULL,
	"summary_regenerated" boolean DEFAULT false NOT NULL,
	"forged_achievement_id" uuid,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "distillation_run_finished_ck" CHECK (("status" = 'RUNNING') = ("finished_at" is null)),
	CONSTRAINT "distillation_run_error_ck" CHECK (("error" is null) or ("status" = 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "achievement_definition" ADD COLUMN "review_status" "achievement_review_status";--> statement-breakpoint
ALTER TABLE "achievement_definition" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "achievement_definition" ADD COLUMN "forged_provenance" jsonb;--> statement-breakpoint
ALTER TABLE "knowledge_candidate" ADD COLUMN "decision" "knowledge_candidate_decision";--> statement-breakpoint
ALTER TABLE "knowledge_candidate" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "knowledge_candidate" ADD COLUMN "knowledge_item_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_candidate" ADD COLUMN "distillation_run_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_candidate" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_item" ADD CONSTRAINT "knowledge_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item" ADD CONSTRAINT "knowledge_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distillation_run" ADD CONSTRAINT "distillation_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distillation_run" ADD CONSTRAINT "distillation_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distillation_run" ADD CONSTRAINT "distillation_run_loadout_id_loadout_id_fk" FOREIGN KEY ("loadout_id") REFERENCES "public"."loadout"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distillation_run" ADD CONSTRAINT "distillation_run_forged_achievement_id_achievement_definition_id_fk" FOREIGN KEY ("forged_achievement_id") REFERENCES "public"."achievement_definition"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_item_project_status_idx" ON "knowledge_item" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_item_project_type_idx" ON "knowledge_item" USING btree ("project_id","type");--> statement-breakpoint
CREATE INDEX "knowledge_item_search_idx" ON "knowledge_item" USING gin ("search");--> statement-breakpoint
CREATE INDEX "distillation_run_project_started_idx" ON "distillation_run" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "distillation_run_user_status_idx" ON "distillation_run" USING btree ("user_id","status");--> statement-breakpoint
ALTER TABLE "knowledge_candidate" ADD CONSTRAINT "knowledge_candidate_knowledge_item_id_knowledge_item_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_candidate" ADD CONSTRAINT "knowledge_candidate_distillation_run_id_distillation_run_id_fk" FOREIGN KEY ("distillation_run_id") REFERENCES "public"."distillation_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_candidate_item_idx" ON "knowledge_candidate" USING btree ("knowledge_item_id");--> statement-breakpoint
ALTER TABLE "achievement_definition" ADD CONSTRAINT "achievement_definition_forged_review_ck" CHECK (("origin" = 'FORGED') = ("review_status" is not null) and ("origin" = 'FORGED') = ("forged_provenance" is not null));--> statement-breakpoint
ALTER TABLE "knowledge_candidate" ADD CONSTRAINT "knowledge_candidate_processed_ck" CHECK (("status" = 'PENDING') = ("processed_at" is null) and ("status" = 'PENDING') = ("decision" is null));--> statement-breakpoint
-- Daqui para baixo é escrito à mão: o Drizzle não modela triggers, então este
-- trecho não aparece no snapshot de `drizzle/meta` e `pnpm db:check` continua
-- verde. Mesmo padrão das migrações `0001`, `0004` e `0005`, adaptado do Archon
-- (packages/core/src/db/adapters/postgres.ts@0773b97).
--
-- O canal acorda o **Distiller** do Worker quando um candidato novo é gravado
-- no desfecho de um Run. Como todos os nossos, o NOTIFY não carrega payload
-- (documento técnico, seção 10.1): ele só acorda quem já sabe consultar, e o
-- pior caso de uma notificação perdida é o lote esperar o timer.
CREATE OR REPLACE FUNCTION dm_notify_knowledge_candidate() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('dm_knowledge_candidate', '');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS knowledge_candidate_inserted_notify ON "knowledge_candidate";--> statement-breakpoint
CREATE TRIGGER knowledge_candidate_inserted_notify
  AFTER INSERT ON "knowledge_candidate"
  FOR EACH STATEMENT
  EXECUTE FUNCTION dm_notify_knowledge_candidate();
