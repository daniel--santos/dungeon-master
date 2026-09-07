CREATE TABLE "dashboard_event" (
	"sequence" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dashboard_event" ADD CONSTRAINT "dashboard_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dashboard_event_user_sequence_idx" ON "dashboard_event" USING btree ("user_id","sequence");--> statement-breakpoint
-- Daqui para baixo é escrito à mão: o Drizzle não modela triggers, então este
-- trecho não aparece no snapshot de `drizzle/meta` e `pnpm db:check` continua
-- verde. Adaptado do Archon (packages/core/src/db/adapters/postgres.ts@0773b97).
--
-- O NOTIFY não carrega payload de propósito (documento técnico, seção 10.1):
-- ele só acorda o drain por cursor da API, que lê a tabela a partir da última
-- `sequence` entregue. Cursor, mapeamento e dedup ficam num lugar só, então uma
-- notificação perdida ou coalescida nunca dessincroniza o browser.
--
-- `FOR EACH STATEMENT`, e não `FOR EACH ROW`: sem payload não há nada a dizer
-- por linha, e o PostgreSQL já colapsa notificações idênticas dentro de uma
-- transação. Uma inserção em lote acorda o drain uma vez, não N vezes.
--
-- O NOTIFY é transacional: só chega ao ouvinte depois do COMMIT. É o que faz o
-- upsert de `user_setting` mais o evento na mesma transação chegarem juntos à
-- tela, ou não chegarem.
CREATE OR REPLACE FUNCTION dm_notify_dashboard_event() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('dm_dashboard_event', '');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS dashboard_event_notify ON "dashboard_event";--> statement-breakpoint
CREATE TRIGGER dashboard_event_notify
  AFTER INSERT ON "dashboard_event"
  FOR EACH STATEMENT EXECUTE FUNCTION dm_notify_dashboard_event();
