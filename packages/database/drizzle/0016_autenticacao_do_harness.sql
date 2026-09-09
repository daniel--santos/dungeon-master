CREATE TYPE "public"."harness_auth_status" AS ENUM('AUTHENTICATED', 'NOT_AUTHENTICATED', 'UNKNOWN');--> statement-breakpoint
ALTER TABLE "harness" ADD COLUMN "auth_status" "harness_auth_status";--> statement-breakpoint
ALTER TABLE "harness" ADD COLUMN "auth_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "harness" ADD COLUMN "auth_reason" text;