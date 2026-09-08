CREATE TYPE "public"."workflow_step_type" AS ENUM('agent', 'command', 'validation', 'approval', 'knowledge');--> statement-breakpoint
CREATE TYPE "public"."approval_gate_status" AS ENUM('PENDING', 'GRANTED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."run_step_status" AS ENUM('PENDING', 'RUNNING', 'WAITING_APPROVAL', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'TIMED_OUT', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "workflow_step" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" "workflow_step_type" NOT NULL,
	"position" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_step_version_key_uq" UNIQUE("workflow_version_id","key"),
	CONSTRAINT "workflow_step_position_nonnegative_ck" CHECK ("position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workflow_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_version_workflow_version_uq" UNIQUE("workflow_id","version"),
	CONSTRAINT "workflow_version_positive_ck" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_user_name_uq" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "approval_gate" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"run_step_id" uuid NOT NULL,
	"gate_key" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "approval_gate_status" DEFAULT 'PENDING' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_gate_run_key_uq" UNIQUE("run_id","gate_key"),
	CONSTRAINT "approval_gate_resolved_ck" CHECK (("status" = 'PENDING') = ("resolved_at" is null))
);
--> statement-breakpoint
CREATE TABLE "run_step" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"workflow_step_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" "workflow_step_type" NOT NULL,
	"position" integer NOT NULL,
	"status" "run_step_status" DEFAULT 'PENDING' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"result" jsonb,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_step_run_key_uq" UNIQUE("run_id","key"),
	CONSTRAINT "run_step_attempt_nonnegative_ck" CHECK ("attempt" >= 0)
);
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "workflow_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step" ADD CONSTRAINT "workflow_step_workflow_version_id_workflow_version_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_version" ADD CONSTRAINT "workflow_version_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_version" ADD CONSTRAINT "workflow_version_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_gate" ADD CONSTRAINT "approval_gate_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_gate" ADD CONSTRAINT "approval_gate_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_gate" ADD CONSTRAINT "approval_gate_run_step_id_run_step_id_fk" FOREIGN KEY ("run_step_id") REFERENCES "public"."run_step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_step" ADD CONSTRAINT "run_step_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_step" ADD CONSTRAINT "run_step_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_step" ADD CONSTRAINT "run_step_workflow_step_id_workflow_step_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_step"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_step_version_position_idx" ON "workflow_step" USING btree ("workflow_version_id","position");--> statement-breakpoint
CREATE INDEX "approval_gate_user_status_idx" ON "approval_gate" USING btree ("user_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "run_step_run_status_idx" ON "run_step" USING btree ("run_id","status");--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_workflow_version_id_workflow_version_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_version"("id") ON DELETE restrict ON UPDATE no action;