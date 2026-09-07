ALTER TABLE "run" ADD COLUMN "claimed_by" text;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "resumed_from_run_id" uuid;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_resumed_from_run_id_run_id_fk" FOREIGN KEY ("resumed_from_run_id") REFERENCES "public"."run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Daqui para baixo é escrito à mão: o Drizzle não modela triggers, então este
-- trecho não aparece no snapshot de `drizzle/meta` e `pnpm db:check` continua
-- verde. Mesmo padrão das migrações `0001` e `0004`, adaptado do Archon
-- (packages/core/src/db/adapters/postgres.ts@0773b97).
--
-- Os dois canais avisam o **Worker**, e não a interface: um Run novo na fila e
-- um pedido de cancelamento. Como todos os nossos, o NOTIFY não carrega
-- payload (documento técnico, seção 10.1) — ele só acorda quem já sabe
-- consultar. Um id no payload obrigaria a tratar notificação perdida ou
-- coalescida como trabalho perdido; sem payload, o pior caso é o Worker
-- descobrir no tique seguinte.
--
-- `FOR EACH ROW` com cláusula `WHEN`, e não `FOR EACH STATEMENT`: o gatilho
-- aqui é a **transição** de uma coluna, e um trigger de statement não enxerga
-- `OLD`/`NEW`. O PostgreSQL colapsa notificações idênticas dentro da mesma
-- transação, então um `UPDATE` em lote continua acordando o Worker uma vez.
CREATE OR REPLACE FUNCTION dm_notify_run_queue() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('dm_run_queue', '');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS run_queued_notify ON "run";--> statement-breakpoint
CREATE TRIGGER run_queued_notify
  AFTER INSERT OR UPDATE OF status ON "run"
  FOR EACH ROW
  WHEN (NEW.status = 'QUEUED')
  EXECUTE FUNCTION dm_notify_run_queue();--> statement-breakpoint
CREATE OR REPLACE FUNCTION dm_notify_run_cancel() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('dm_run_cancel', '');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS run_cancel_requested_notify ON "run";--> statement-breakpoint
CREATE TRIGGER run_cancel_requested_notify
  AFTER UPDATE OF cancel_requested_at ON "run"
  FOR EACH ROW
  WHEN (NEW.cancel_requested_at IS NOT NULL AND OLD.cancel_requested_at IS NULL)
  EXECUTE FUNCTION dm_notify_run_cancel();
