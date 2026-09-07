import type { Activity, ActivityType, JsonValue } from "@dungeon-master/contracts";
import { and, count, desc, eq, or, sql } from "drizzle-orm";

import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import type { PageInput, PageResult } from "./result.js";
import { activities, type ActivityRow } from "./schema/activity.js";
import { tasks } from "./schema/task.js";

/**
 * Converte a linha do banco no contrato.
 *
 * `type` é `text` na tabela e enum no contrato: o afunilamento é seguro porque
 * a única porta de escrita é `recordDomainEvent`, que só aceita `ActivityType`.
 */
export function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    type: row.type as ActivityType,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface DomainEventInput {
  userId: string;
  /** Project a que o fato pertence. Nulo só numa captura de Inbox. */
  projectId: string | null;
  taskId: string | null;
  type: ActivityType;
  /** Já traz os ids: o evento de dashboard não tem colunas para eles. */
  payload: JsonValue;
}

/**
 * Grava o fato nos dois lugares: o diário do Project e o stream da tela.
 *
 * Recebe um `DatabaseExecutor`, e não um `Database`, porque nunca é chamada
 * sozinha: quem chama já está dentro da transação da mudança que este fato
 * descreve. Um diário que commita separado da mudança registra coisas que não
 * aconteceram, e um evento que commita separado deixa a tela pedindo um estado
 * que o banco não tem.
 *
 * O `NOTIFY` do stream sai do trigger de `dashboard_event`, no COMMIT, então o
 * browser só é acordado depois que a mudança inteira ficou visível.
 */
export async function recordDomainEvent(
  db: DatabaseExecutor,
  input: DomainEventInput,
): Promise<Activity> {
  const [row] = await db
    .insert(activities)
    .values({
      id: newId(),
      userId: input.userId,
      projectId: input.projectId,
      taskId: input.taskId,
      type: input.type,
      payload: input.payload,
    })
    .returning();

  if (row === undefined) {
    throw new Error("A inserção em activity não devolveu linha.");
  }

  await appendDashboardEvent(db, {
    userId: input.userId,
    type: input.type,
    payload: input.payload,
  });

  return toActivity(row);
}

export interface ListProjectActivityInput extends PageInput {
  userId: string;
  projectId: string;
}

/**
 * O diário de um Project, do mais recente para o mais antigo.
 *
 * Duas origens, unidas por `or`: a linha que já nasceu com este `project_id`, e
 * a linha de uma Task que **hoje** pertence a este Project. A segunda existe
 * por causa da Inbox — uma captura nasce sem Project, então o `task.created`
 * dela é gravado com `project_id` nulo, e sem o vínculo pela Task a história da
 * Task promovida começaria no meio, na promoção, como se ela tivesse surgido do
 * nada. `activity` continua append-only: nada é reescrito na promoção; o
 * pertencimento é resolvido na leitura, que é onde ele pode mudar.
 *
 * É `or` numa condição, e não um `join`: com `join` uma linha que casa pelos
 * dois lados apareceria duas vezes.
 *
 * O desempate é por `id` descendente, e não arbitrário: o id é UUIDv7, então a
 * ordem dele dentro do mesmo instante é a ordem de inserção. Sem desempate,
 * duas linhas do mesmo milissegundo poderiam trocar de lugar entre uma página e
 * a seguinte, e um item apareceria duas vezes ou nenhuma.
 */
export async function listProjectActivity(
  db: DatabaseExecutor,
  input: ListProjectActivityInput,
): Promise<PageResult<Activity>> {
  const daTaskDesteProject = sql`exists (
    select 1
    from ${tasks}
    where ${tasks.id} = ${activities.taskId}
      and ${tasks.userId} = ${input.userId}
      and ${tasks.projectId} = ${input.projectId}
  )`;

  const where = and(
    eq(activities.userId, input.userId),
    or(eq(activities.projectId, input.projectId), daTaskDesteProject),
  );

  const rows = await db
    .select()
    .from(activities)
    .where(where)
    .orderBy(desc(activities.createdAt), desc(activities.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);

  const [counted] = await db.select({ total: count() }).from(activities).where(where);

  return { items: rows.map(toActivity), total: counted?.total ?? 0 };
}
