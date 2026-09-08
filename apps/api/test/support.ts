import { type DatabaseHandle, LOCAL_USER_ID } from "@dungeon-master/database";

import { type App, createApp } from "../src/app.js";
import {
  createAchievementsPort,
  createExecutionPort,
  createRunEventsRuntime,
} from "../src/composition.js";
import { createWorkPort } from "../src/composition.js";
import { createSpecPorts } from "../src/ports.js";

/**
 * Fiação compartilhada dos testes de Project, Task, Inbox e execução.
 *
 * O stream SSE **de dashboard** não entra: as rotas daqui não o usam, e subir um
 * `createEventsRuntime` por arquivo custaria uma conexão dedicada de `LISTEN`
 * para nada. As portas de evento e de configuração são as inertes, que lançam
 * se alguém as chamar por engano — o que faria o teste falhar alto em vez de
 * passar por acidente.
 *
 * O stream **por Run** entra, porque é rota testada. O `LISTEN` dele também
 * fica de fora: o poller de cada Run tem um tique de segurança próprio, e aqui
 * ele é apertado para 50 ms, o que substitui a notificação com uma latência que
 * um teste tolera. Sem isso, o replay funcionaria e o "ao vivo" dependeria de
 * uma conexão dedicada por arquivo de teste.
 *
 * A verificação de que a mudança e o `dashboard_event` saem na mesma transação
 * é feita lendo a tabela, e não pelo stream: é a tabela que prova o COMMIT.
 */
export function criarApp(handle: DatabaseHandle): App {
  const inertes = createSpecPorts();

  const runEvents = createRunEventsRuntime({
    db: handle.db,
    pool: handle.pool,
    userId: LOCAL_USER_ID,
    fallbackIntervalMs: 50,
    heartbeatIntervalMs: 0,
  });

  return createApp({
    probeDatabase: async () => ({ ok: true, latencyMs: 0, error: null }),
    events: inertes.events,
    settings: inertes.settings,
    work: createWorkPort({ db: handle.db, userId: LOCAL_USER_ID }),
    execution: createExecutionPort({ db: handle.db, userId: LOCAL_USER_ID, runEvents }),
    achievements: inertes.achievements,
    hall: createAchievementsPort({ db: handle.db, userId: LOCAL_USER_ID }),
    pingEnabled: false,
  });
}

/**
 * Apaga tudo o que os testes escrevem, na ordem das chaves estrangeiras.
 *
 * `harness` e `execution_profile` ficam: são semente do `db:seed`, não massa de
 * teste, e apagá-los deixaria os testes seguintes sem o vocabulário que a
 * aplicação precisa para criar um Loadout.
 *
 * SQL cru pelo pool, e não Drizzle: `apps/api` não importa o ORM — quem fala
 * com ele é `@dungeon-master/database`, e um import de `drizzle-orm` aqui só
 * para arrumar a mesa borraria essa linha.
 */
export async function limparTudo(handle: DatabaseHandle): Promise<void> {
  for (const tabela of [
    "achievement_unlock",
    "achievement_progress",
    "achievement_cursor",
    "achievement_definition",
    "hero_stats",
    "approval_gate",
    "run_step",
    "workspace_lock",
    "run_event",
    "run",
    "loadout",
    "model",
    "agent",
    "activity",
    "task_dependency",
    "task",
    "workflow_step",
    "workflow_version",
    "workflow",
    "project",
    "dashboard_event",
  ]) {
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

/** As linhas de `activity`, com o payload, na ordem da gravação. */
export async function linhasDeActivity(
  handle: DatabaseHandle,
): Promise<Array<{ type: string; payload: Record<string, unknown> | null }>> {
  const result = await handle.pool.query<{
    type: string;
    payload: Record<string, unknown> | null;
  }>("select type, payload from activity where user_id = $1 order by created_at, id", [
    LOCAL_USER_ID,
  ]);
  return result.rows;
}

/** Define o workspace de um Project direto no banco, sem passar pela API. */
export async function definirWorkspace(
  handle: DatabaseHandle,
  input: { projectId: string; workspacePath: string | null },
): Promise<void> {
  await handle.pool.query("update project set workspace_path = $1 where id = $2", [
    input.workspacePath,
    input.projectId,
  ]);
}

export interface RequisicaoJson {
  app: App;
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function pedir({
  app,
  method,
  path,
  body,
  headers,
}: RequisicaoJson): Promise<Response> {
  return await app.request(path, {
    method,
    ...(body === undefined
      ? { ...(headers === undefined ? {} : { headers }) }
      : {
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        }),
  });
}
