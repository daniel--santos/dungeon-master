CREATE TYPE "public"."achievement_origin" AS ENUM('CATALOG', 'TEMPLATE', 'FORGED');--> statement-breakpoint
CREATE TYPE "public"."achievement_rarity" AS ENUM('COMMON', 'RARE', 'EPIC', 'LEGENDARY');--> statement-breakpoint
CREATE TYPE "public"."achievement_scope" AS ENUM('GLOBAL', 'PROJECT', 'HARNESS', 'AGENT', 'TASK');--> statement-breakpoint
CREATE TYPE "public"."achievement_source" AS ENUM('activity', 'run_event', 'dashboard_event');--> statement-breakpoint
CREATE TYPE "public"."hero_scope" AS ENUM('AGENT', 'LOADOUT');--> statement-breakpoint
CREATE TABLE "achievement_cursor" (
	"source" "achievement_source" NOT NULL,
	"user_id" uuid NOT NULL,
	"position_at" timestamp with time zone,
	"position_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievement_cursor_pk" PRIMARY KEY("source","user_id")
);
--> statement-breakpoint
CREATE TABLE "achievement_definition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"origin" "achievement_origin" NOT NULL,
	"natural_key" text NOT NULL,
	"catalog_key" text,
	"template_key" text,
	"catalog_version" text,
	"scope_type" "achievement_scope" NOT NULL,
	"scope_id" text,
	"name_theme" text NOT NULL,
	"name_plain" text NOT NULL,
	"description_theme" text NOT NULL,
	"description_plain" text NOT NULL,
	"flavor" text,
	"icon" text NOT NULL,
	"rarity" "achievement_rarity" NOT NULL,
	"tiers" jsonb,
	"tier_rarities" jsonb,
	"hidden" boolean DEFAULT false NOT NULL,
	"condition" jsonb NOT NULL,
	"provenance" jsonb,
	"effective_from" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievement_definition_natural_key_uq" UNIQUE("user_id","natural_key")
);
--> statement-breakpoint
CREATE TABLE "achievement_progress" (
	"definition_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"best_value" bigint,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"best_streak" integer DEFAULT 0 NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievement_progress_pk" PRIMARY KEY("definition_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "achievement_unlock" (
	"id" uuid PRIMARY KEY NOT NULL,
	"definition_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tier" integer DEFAULT 1 NOT NULL,
	"run_id" uuid,
	"task_id" uuid,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	CONSTRAINT "achievement_unlock_tier_uq" UNIQUE("definition_id","user_id","tier")
);
--> statement-breakpoint
CREATE TABLE "hero_stats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" "hero_scope" NOT NULL,
	"scope_id" uuid NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"expeditions" integer DEFAULT 0 NOT NULL,
	"victories" integer DEFAULT 0 NOT NULL,
	"defeats" integer DEFAULT 0 NOT NULL,
	"monsters_slain" integer DEFAULT 0 NOT NULL,
	"docker_victories" integer DEFAULT 0 NOT NULL,
	"tokens" bigint DEFAULT 0 NOT NULL,
	"harness_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"top_harness" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hero_stats_scope_uq" UNIQUE("user_id","scope","scope_id")
);
--> statement-breakpoint
ALTER TABLE "achievement_cursor" ADD CONSTRAINT "achievement_cursor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_definition" ADD CONSTRAINT "achievement_definition_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_progress" ADD CONSTRAINT "achievement_progress_definition_id_achievement_definition_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."achievement_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_progress" ADD CONSTRAINT "achievement_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_unlock" ADD CONSTRAINT "achievement_unlock_definition_id_achievement_definition_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."achievement_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_unlock" ADD CONSTRAINT "achievement_unlock_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_unlock" ADD CONSTRAINT "achievement_unlock_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_unlock" ADD CONSTRAINT "achievement_unlock_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hero_stats" ADD CONSTRAINT "hero_stats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "achievement_definition_user_origin_idx" ON "achievement_definition" USING btree ("user_id","origin");--> statement-breakpoint
CREATE INDEX "achievement_unlock_user_unlocked_idx" ON "achievement_unlock" USING btree ("user_id","unlocked_at");