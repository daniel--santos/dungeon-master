ALTER TYPE "public"."task_created_by" ADD VALUE 'DELEGATION';--> statement-breakpoint
ALTER TYPE "public"."workflow_step_type" ADD VALUE 'delegate';--> statement-breakpoint
ALTER TYPE "public"."run_status" ADD VALUE 'WAITING_CHILD' BEFORE 'SUCCEEDED';--> statement-breakpoint
ALTER TYPE "public"."run_step_status" ADD VALUE 'WAITING_CHILD' BEFORE 'SUCCEEDED';