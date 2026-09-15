CREATE TYPE "public"."billing_kind" AS ENUM('PER_TOKEN', 'SUBSCRIPTION');--> statement-breakpoint
CREATE TYPE "public"."metric_dimension" AS ENUM('ALL', 'PROJECT', 'HARNESS', 'MODEL', 'PROVIDER', 'LOADOUT', 'CREATED_BY', 'TASK_KIND', 'EXECUTION_MODE');--> statement-breakpoint
CREATE TYPE "public"."metric_source" AS ENUM('run');--> statement-breakpoint
CREATE TABLE "metric_cursor" (
	"source" "metric_source" NOT NULL,
	"user_id" uuid NOT NULL,
	"position_at" timestamp with time zone,
	"position_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_cursor_pk" PRIMARY KEY("source","user_id")
);
--> statement-breakpoint
CREATE TABLE "metric_daily" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"dimension" "metric_dimension" NOT NULL,
	"dimension_key" text NOT NULL,
	"runs_total" integer DEFAULT 0 NOT NULL,
	"runs_succeeded" integer DEFAULT 0 NOT NULL,
	"runs_failed" integer DEFAULT 0 NOT NULL,
	"runs_timed_out" integer DEFAULT 0 NOT NULL,
	"runs_cancelled" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_write_tokens" bigint DEFAULT 0 NOT NULL,
	"tokens_known_runs" integer DEFAULT 0 NOT NULL,
	"duration_ms_total" bigint DEFAULT 0 NOT NULL,
	"duration_ms_max" bigint DEFAULT 0 NOT NULL,
	"duration_runs" integer DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"cost_by_currency" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priced_runs" integer DEFAULT 0 NOT NULL,
	"unpriced_runs" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_daily_pk" PRIMARY KEY("user_id","day","dimension","dimension_key")
);
--> statement-breakpoint
CREATE TABLE "model_price" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"input_per_million" numeric(20, 8) NOT NULL,
	"output_per_million" numeric(20, 8) NOT NULL,
	"cache_read_per_million" numeric(20, 8) NOT NULL,
	"cache_write_per_million" numeric(20, 8) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_price_currency_ck" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "model_price_range_ck" CHECK ("effective_to" is null or "effective_to" > "effective_from"),
	CONSTRAINT "model_price_nonnegative_ck" CHECK ("input_per_million" >= 0 and "output_per_million" >= 0 and "cache_read_per_million" >= 0 and "cache_write_per_million" >= 0)
);
--> statement-breakpoint
CREATE TABLE "run_metric" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"task_id" uuid NOT NULL,
	"task_kind" "task_kind" NOT NULL,
	"harness_key" "harness_key" NOT NULL,
	"model_key" text,
	"provider_id" uuid,
	"loadout_id" uuid NOT NULL,
	"loadout_version" integer NOT NULL,
	"execution_mode" "execution_mode" NOT NULL,
	"created_by" "run_created_by" NOT NULL,
	"parent_run_id" uuid,
	"status" "run_status" NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone NOT NULL,
	"duration_ms" bigint,
	"queue_ms" bigint,
	"input_tokens" bigint,
	"output_tokens" bigint,
	"cache_read_tokens" bigint,
	"cache_write_tokens" bigint,
	"tokens_known" boolean DEFAULT false NOT NULL,
	"context_tokens" integer,
	"context_items" integer,
	"context_sections" integer,
	"context_truncations" integer,
	"tool_calls_by_server" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"steps_by_type" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"gates_granted_user" integer DEFAULT 0 NOT NULL,
	"gates_granted_policy" integer DEFAULT 0 NOT NULL,
	"children_delegated" integer DEFAULT 0 NOT NULL,
	"day" date NOT NULL,
	"projected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_metric_tool_calls_nonnegative_ck" CHECK ("tool_calls" >= 0),
	CONSTRAINT "run_metric_duration_nonnegative_ck" CHECK ("duration_ms" is null or "duration_ms" >= 0),
	CONSTRAINT "run_metric_queue_nonnegative_ck" CHECK ("queue_ms" is null or "queue_ms" >= 0),
	CONSTRAINT "run_metric_status_terminal_ck" CHECK ("status" in ('SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "worker" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"pid" integer NOT NULL,
	"version" text NOT NULL,
	"node_version" text NOT NULL,
	"capacity" integer NOT NULL,
	"harnesses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"stale_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_pid_positive_ck" CHECK ("pid" > 0),
	CONSTRAINT "worker_capacity_positive_ck" CHECK ("capacity" > 0)
);
--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "billing_kind" "billing_kind";--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "monthly_cost" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "metric_cursor" ADD CONSTRAINT "metric_cursor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_daily" ADD CONSTRAINT "metric_daily_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_price" ADD CONSTRAINT "model_price_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_price" ADD CONSTRAINT "model_price_model_id_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_metric" ADD CONSTRAINT "run_metric_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_metric" ADD CONSTRAINT "run_metric_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_metric" ADD CONSTRAINT "run_metric_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_metric" ADD CONSTRAINT "run_metric_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker" ADD CONSTRAINT "worker_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "metric_daily_dimension_idx" ON "metric_daily" USING btree ("user_id","dimension","day");--> statement-breakpoint
CREATE UNIQUE INDEX "model_price_current_uq" ON "model_price" USING btree ("model_id") WHERE effective_to is null;--> statement-breakpoint
CREATE INDEX "model_price_model_from_idx" ON "model_price" USING btree ("model_id","effective_from");--> statement-breakpoint
CREATE INDEX "run_metric_user_day_idx" ON "run_metric" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "run_metric_user_model_day_idx" ON "run_metric" USING btree ("user_id","model_key","day");--> statement-breakpoint
CREATE INDEX "run_metric_project_day_idx" ON "run_metric" USING btree ("project_id","day");--> statement-breakpoint
CREATE INDEX "worker_user_heartbeat_idx" ON "worker" USING btree ("user_id","last_heartbeat_at");--> statement-breakpoint
CREATE INDEX "run_user_finished_idx" ON "run" USING btree ("user_id","finished_at","id") WHERE finished_at is not null;--> statement-breakpoint
ALTER TABLE "provider" ADD CONSTRAINT "provider_monthly_cost_ck" CHECK (("monthly_cost" is null) = ("currency" is null) and ("monthly_cost" is null or "billing_kind" = 'SUBSCRIPTION'));--> statement-breakpoint
ALTER TABLE "provider" ADD CONSTRAINT "provider_monthly_cost_nonnegative_ck" CHECK ("monthly_cost" is null or "monthly_cost" >= 0);--> statement-breakpoint
ALTER TABLE "provider" ADD CONSTRAINT "provider_currency_ck" CHECK ("currency" is null or "currency" ~ '^[A-Z]{3}$');