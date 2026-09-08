CREATE TYPE "public"."proposed_task_status" AS ENUM('PROPOSED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."knowledge_candidate_status" AS ENUM('PENDING', 'PROMOTED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "proposed_task" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"origin_task_id" uuid NOT NULL,
	"origin_run_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"rationale" text,
	"status" "proposed_task_status" DEFAULT 'PROPOSED' NOT NULL,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposed_task_run_position_uq" UNIQUE("origin_run_id","position"),
	CONSTRAINT "proposed_task_position_nonnegative_ck" CHECK ("position" >= 0),
	CONSTRAINT "proposed_task_decided_ck" CHECK (("status" = 'PROPOSED') = ("decided_at" is null)),
	CONSTRAINT "proposed_task_created_task_ck" CHECK ("created_task_id" is null or "status" = 'APPROVED')
);
--> statement-breakpoint
CREATE TABLE "knowledge_candidate" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"kind" text,
	"status" "knowledge_candidate_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_candidate_run_position_uq" UNIQUE("run_id","position"),
	CONSTRAINT "knowledge_candidate_position_nonnegative_ck" CHECK ("position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "proposed_task" ADD CONSTRAINT "proposed_task_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposed_task" ADD CONSTRAINT "proposed_task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposed_task" ADD CONSTRAINT "proposed_task_origin_task_id_task_id_fk" FOREIGN KEY ("origin_task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposed_task" ADD CONSTRAINT "proposed_task_origin_run_id_run_id_fk" FOREIGN KEY ("origin_run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposed_task" ADD CONSTRAINT "proposed_task_created_task_id_task_id_fk" FOREIGN KEY ("created_task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_candidate" ADD CONSTRAINT "knowledge_candidate_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_candidate" ADD CONSTRAINT "knowledge_candidate_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_candidate" ADD CONSTRAINT "knowledge_candidate_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_candidate" ADD CONSTRAINT "knowledge_candidate_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposed_task_user_status_idx" ON "proposed_task" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "proposed_task_project_status_idx" ON "proposed_task" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "proposed_task_origin_task_status_idx" ON "proposed_task" USING btree ("origin_task_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_candidate_project_status_idx" ON "knowledge_candidate" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_candidate_task_idx" ON "knowledge_candidate" USING btree ("task_id");