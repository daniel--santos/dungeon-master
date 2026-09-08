CREATE TYPE "public"."run_context_status" AS ENUM('ASSEMBLED', 'EMPTY', 'DISABLED', 'FAILED');--> statement-breakpoint
CREATE TABLE "run_context" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "run_context_status" NOT NULL,
	"text" text NOT NULL,
	"query" text,
	"sections" jsonb NOT NULL,
	"excluded" jsonb NOT NULL,
	"budget" jsonb NOT NULL,
	"usage" jsonb NOT NULL,
	"policy" jsonb NOT NULL,
	"inherited_from_run_id" uuid,
	"error" text,
	"assembled_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_context_run_uq" UNIQUE("run_id"),
	CONSTRAINT "run_context_error_ck" CHECK (("error" is null) or ("status" = 'FAILED')),
	CONSTRAINT "run_context_text_ck" CHECK (("status" = 'ASSEMBLED') = ("text" <> ''))
);
--> statement-breakpoint
ALTER TABLE "run_context" ADD CONSTRAINT "run_context_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_context" ADD CONSTRAINT "run_context_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_context" ADD CONSTRAINT "run_context_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_context" ADD CONSTRAINT "run_context_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_context" ADD CONSTRAINT "run_context_inherited_from_run_id_run_id_fk" FOREIGN KEY ("inherited_from_run_id") REFERENCES "public"."run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_context_task_idx" ON "run_context" USING btree ("task_id","created_at");