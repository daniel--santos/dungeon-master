-- ADR 0003: a projeção de estatísticas perde o vocabulário temático.
--
-- Escrita à mão, porque o gerador emite DROP + CREATE para um rename e isso
-- apagaria os acumulados. Só RENAME: tabela, tipo, colunas, constraints e o
-- índice do PRIMARY KEY (o nome padrão do PostgreSQL segue o nome antigo da
-- tabela). `xp`, `level` e `tokens` são vocabulário genérico e ficam.
ALTER TABLE "hero_stats" RENAME TO "execution_stats";--> statement-breakpoint
ALTER TYPE "public"."hero_scope" RENAME TO "execution_stats_scope";--> statement-breakpoint
ALTER TABLE "execution_stats" RENAME COLUMN "expeditions" TO "runs_total";--> statement-breakpoint
ALTER TABLE "execution_stats" RENAME COLUMN "victories" TO "runs_succeeded";--> statement-breakpoint
ALTER TABLE "execution_stats" RENAME COLUMN "defeats" TO "runs_failed";--> statement-breakpoint
ALTER TABLE "execution_stats" RENAME COLUMN "monsters_slain" TO "bug_tasks_completed";--> statement-breakpoint
ALTER TABLE "execution_stats" RENAME COLUMN "docker_victories" TO "docker_runs_succeeded";--> statement-breakpoint
ALTER TABLE "execution_stats" RENAME CONSTRAINT "hero_stats_pkey" TO "execution_stats_pkey";--> statement-breakpoint
ALTER TABLE "execution_stats" RENAME CONSTRAINT "hero_stats_scope_uq" TO "execution_stats_scope_uq";--> statement-breakpoint
ALTER TABLE "execution_stats" RENAME CONSTRAINT "hero_stats_user_id_user_id_fk" TO "execution_stats_user_id_user_id_fk";--> statement-breakpoint
-- O histórico do painel: a web filtra o stream por string, e um toast de
-- antes da migração não pode ficar órfão do tipo novo.
UPDATE "dashboard_event" SET "type" = 'execution_stats.updated' WHERE "type" = 'hero_stats.updated';
