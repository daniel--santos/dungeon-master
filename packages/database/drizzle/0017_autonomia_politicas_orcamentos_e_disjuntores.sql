CREATE TYPE "public"."task_created_by" AS ENUM('USER', 'PROPOSAL', 'POLICY');--> statement-breakpoint
CREATE TYPE "public"."run_created_by" AS ENUM('USER', 'POLICY', 'DELEGATION');--> statement-breakpoint
CREATE TYPE "public"."breaker_scope" AS ENUM('PROJECT', 'LOADOUT', 'HARNESS');--> statement-breakpoint
CREATE TYPE "public"."breaker_state" AS ENUM('CLOSED', 'OPEN', 'HALF_OPEN');--> statement-breakpoint
CREATE TYPE "public"."budget_action" AS ENUM('BLOCK', 'WARN');--> statement-breakpoint
CREATE TYPE "public"."budget_scope" AS ENUM('GLOBAL', 'PROJECT', 'LOADOUT');--> statement-breakpoint
CREATE TYPE "public"."budget_window" AS ENUM('DAY', 'WEEK', 'MONTH', 'PER_RUN');--> statement-breakpoint
CREATE TYPE "public"."policy_action" AS ENUM('REQUIRE_APPROVAL', 'AUTO_APPROVE', 'DENY');--> statement-breakpoint
CREATE TYPE "public"."policy_subject" AS ENUM('PROPOSAL', 'RUN_START', 'GATE');--> statement-breakpoint
CREATE TYPE "public"."routing_kind" AS ENUM('MODEL', 'LOADOUT', 'WORKFLOW');--> statement-breakpoint
CREATE TABLE "approval_policy" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"subject" "policy_subject" NOT NULL,
	"project_id" uuid,
	"priority" integer DEFAULT 100 NOT NULL,
	"conditions" jsonb NOT NULL,
	"action" "policy_action" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_policy_priority_ck" CHECK ("priority" >= 0)
);
--> statement-breakpoint
CREATE TABLE "budget" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scope" "budget_scope" NOT NULL,
	"project_id" uuid,
	"loadout_id" uuid,
	"window" "budget_window" NOT NULL,
	"max_tokens" bigint,
	"max_runs" integer,
	"max_wall_clock_ms" bigint,
	"max_concurrent_runs" integer,
	"action" "budget_action" DEFAULT 'BLOCK' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_project_scope_ck" CHECK (("scope" = 'PROJECT') = ("project_id" is not null)),
	CONSTRAINT "budget_loadout_scope_ck" CHECK (("scope" = 'LOADOUT') = ("loadout_id" is not null)),
	CONSTRAINT "budget_some_limit_ck" CHECK ("max_tokens" is not null or "max_runs" is not null or "max_wall_clock_ms" is not null or "max_concurrent_runs" is not null),
	CONSTRAINT "budget_limits_positive_ck" CHECK (coalesce("max_tokens", 1) > 0 and coalesce("max_runs", 1) > 0 and coalesce("max_wall_clock_ms", 1) > 0 and coalesce("max_concurrent_runs", 1) > 0)
);
--> statement-breakpoint
CREATE TABLE "circuit_breaker" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scope" "breaker_scope" NOT NULL,
	"project_id" uuid,
	"loadout_id" uuid,
	"harness_key" "harness_key",
	"triggers" jsonb NOT NULL,
	"cooldown_ms" integer NOT NULL,
	"state" "breaker_state" DEFAULT 'CLOSED' NOT NULL,
	"opened_at" timestamp with time zone,
	"reason" text,
	"probe_run_id" uuid,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "circuit_breaker_project_scope_ck" CHECK (("scope" = 'PROJECT') = ("project_id" is not null)),
	CONSTRAINT "circuit_breaker_loadout_scope_ck" CHECK (("scope" = 'LOADOUT') = ("loadout_id" is not null)),
	CONSTRAINT "circuit_breaker_harness_scope_ck" CHECK (("scope" = 'HARNESS') = ("harness_key" is not null)),
	CONSTRAINT "circuit_breaker_opened_ck" CHECK (("state" = 'CLOSED') = ("opened_at" is null)),
	CONSTRAINT "circuit_breaker_probe_ck" CHECK ("probe_run_id" is null or "state" = 'HALF_OPEN'),
	CONSTRAINT "circuit_breaker_cooldown_ck" CHECK ("cooldown_ms" > 0)
);
--> statement-breakpoint
CREATE TABLE "routing_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "routing_kind" NOT NULL,
	"project_id" uuid,
	"priority" integer DEFAULT 100 NOT NULL,
	"conditions" jsonb NOT NULL,
	"target_id" uuid NOT NULL,
	"fallback_ids" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routing_rule_priority_ck" CHECK ("priority" >= 0)
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "autonomy_level" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "created_by" "task_created_by" DEFAULT 'USER' NOT NULL;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "created_by" "run_created_by" DEFAULT 'USER' NOT NULL;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "parent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "parent_step_key" text;--> statement-breakpoint
ALTER TABLE "approval_policy" ADD CONSTRAINT "approval_policy_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policy" ADD CONSTRAINT "approval_policy_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_loadout_id_loadout_id_fk" FOREIGN KEY ("loadout_id") REFERENCES "public"."loadout"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circuit_breaker" ADD CONSTRAINT "circuit_breaker_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circuit_breaker" ADD CONSTRAINT "circuit_breaker_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circuit_breaker" ADD CONSTRAINT "circuit_breaker_loadout_id_loadout_id_fk" FOREIGN KEY ("loadout_id") REFERENCES "public"."loadout"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circuit_breaker" ADD CONSTRAINT "circuit_breaker_probe_run_id_run_id_fk" FOREIGN KEY ("probe_run_id") REFERENCES "public"."run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rule" ADD CONSTRAINT "routing_rule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rule" ADD CONSTRAINT "routing_rule_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_policy_user_subject_idx" ON "approval_policy" USING btree ("user_id","subject","enabled");--> statement-breakpoint
CREATE INDEX "approval_policy_project_idx" ON "approval_policy" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "budget_user_scope_idx" ON "budget" USING btree ("user_id","scope","enabled");--> statement-breakpoint
CREATE INDEX "budget_project_idx" ON "budget" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "budget_loadout_idx" ON "budget" USING btree ("loadout_id");--> statement-breakpoint
CREATE INDEX "circuit_breaker_user_scope_idx" ON "circuit_breaker" USING btree ("user_id","scope","enabled");--> statement-breakpoint
CREATE INDEX "circuit_breaker_project_idx" ON "circuit_breaker" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "circuit_breaker_loadout_idx" ON "circuit_breaker" USING btree ("loadout_id");--> statement-breakpoint
CREATE INDEX "routing_rule_user_kind_idx" ON "routing_rule" USING btree ("user_id","kind","enabled");--> statement-breakpoint
CREATE INDEX "routing_rule_project_idx" ON "routing_rule" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_parent_run_id_run_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_parent_idx" ON "run" USING btree ("parent_run_id");--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_autonomy_level_ck" CHECK ("autonomy_level" between 0 and 4);--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_parent_step_ck" CHECK ("parent_step_key" is null or "parent_run_id" is not null);