import { type DatabaseHandle, LOCAL_USER_ID } from "@dungeon-master/database";

import { type App, createApp } from "../src/app.js";
import { createWorkPort } from "../src/composition.js";
import { createSpecPorts } from "../src/ports.js";

/**
 * Fiação compartilhada dos testes de Project, Task e Inbox.
 *
 * O stream SSE não entra: as rotas daqui não o usam, e subir um
 * `createEventsRuntime` por arquivo custaria uma conexão dedicada de `LISTEN`
 * para nada. As portas de evento e de configuração são as inertes, que lançam
 * se alguém as chamar por engano — o que faria o teste falhar alto em vez de
 * passar por acidente.
 *
 * A verificação de que a mudança e o `dashboard_event` saem na mesma transação
 * é feita lendo a tabela, e não pelo stream: é a tabela que prova o COMMIT.
 */
export function criarApp(handle: DatabaseHandle): App {
  const inertes = createSpecPorts();

  return createApp({
    probeDatabase: async () => ({ ok: true, latencyMs: 0, error: null }),
    events: inertes.events,
    settings: inertes.settings,
    work: createWorkPort({ db: handle.db, userId: LOCAL_USER_ID }),
    pingEnabled: false,
  });
}

/**
 * Apaga tudo o que os testes escrevem, na ordem das chaves estrangeiras.
 *
 * SQL cru pelo pool, e não Drizzle: `apps/api` não importa o ORM — quem fala
 * com ele é `@dungeon-master/database`, e um import de `drizzle-orm` aqui só
 * para arrumar a mesa borraria essa linha.
 */
export async function limparTudo(handle: DatabaseHandle): Promise<void> {
  for (const tabela of ["activity", "task_dependency", "task", "project", "dashboard_event"]) {
    await handle.pool.query(`delete from ${tabela} where user_id = $1`, [LOCAL_USER_ID]);
  }
}

/** Os tipos dos eventos de dashboard gravados, na ordem da `sequence`. */
export async function tiposDeEvento(handle: DatabaseHandle): Promise<string[]> {
  const result = await handle.pool.query<{ type: string }>(
    "select type from dashboard_event where user_id = $1 order by sequence",
    [LOCAL_USER_ID],
  );
  return result.rows.map((row) => row.type);
}

/** Os tipos das linhas de `activity`, na ordem da gravação. */
export async function tiposDeActivity(handle: DatabaseHandle): Promise<string[]> {
  const result = await handle.pool.query<{ type: string }>(
    "select type from activity where user_id = $1 order by created_at, id",
    [LOCAL_USER_ID],
  );
  return result.rows.map((row) => row.type);
}

export interface RequisicaoJson {
  app: App;
  method: string;
  path: string;
  body?: unknown;
}

export async function pedir({ app, method, path, body }: RequisicaoJson): Promise<Response> {
  return await app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}
