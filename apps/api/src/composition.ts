import type { DashboardEvent } from "@dungeon-master/contracts";
import {
  addTaskDependency,
  appendDashboardEvent,
  captureInboxTask,
  changeTaskStatus,
  createPgNotifier,
  createProject,
  createTask,
  type Database,
  type DatabaseHandle,
  DASHBOARD_EVENT_CHANNEL,
  discardInboxTask,
  findProjectRow,
  getProject,
  getTaskDetail,
  latestDashboardEventSequence,
  listDashboardEventsSince,
  listInboxTasks,
  listProjectActivity,
  listProjects,
  listTasks,
  promoteInboxTask,
  readUserSettings,
  removeTaskDependency,
  setProjectArchived,
  updateProject,
  updateTask,
  writeUserSetting,
} from "@dungeon-master/database";
import { DashboardEventPoller, PgNotifyListener, SseTransport } from "@dungeon-master/events";

import type { Logger } from "./logger.js";
import type { DashboardEventsPort, SettingsPort, WorkPort } from "./ports.js";

/**
 * Monta as dependências concretas de `createApp` a partir de uma conexão.
 *
 * Fica separado de `server.ts` para que os testes de integração montem
 * exatamente a mesma fiação sobre o `embedded-postgres`, em vez de uma versão
 * paralela que pode divergir sem ninguém notar.
 */

export interface EventsRuntimeOptions {
  db: Database;
  /**
   * Pool do `pg`, para a conexão dedicada do `LISTEN`.
   *
   * O tipo vem do handle de `@dungeon-master/database` para a API não precisar
   * de `pg` nem de `@types/pg` só por causa desta assinatura.
   */
  pool: DatabaseHandle["pool"];
  userId: string;
  logger?: Logger;
  /** Tique de segurança do poller, para o caso de uma notificação se perder. */
  fallbackIntervalMs?: number;
  /** Intervalo do heartbeat do SSE. `0` desliga. */
  heartbeatIntervalMs?: number;
}

export interface EventsRuntime {
  port: DashboardEventsPort;
  /** Liga heartbeat, tique de segurança e `LISTEN`. */
  start: () => Promise<void>;
  /** Desliga tudo e fecha as conexões SSE abertas. */
  stop: () => Promise<void>;
}

/**
 * Transporte SSE, drain por cursor e ponte de NOTIFY, um conjunto por processo.
 *
 * A conexão do `LISTEN` é dedicada e não volta ao pool, então não pode haver um
 * `PgNotifyListener` por requisição — daí o conjunto nascer aqui, no boot, e
 * não dentro de um handler.
 */
export async function createEventsRuntime(options: EventsRuntimeOptions): Promise<EventsRuntime> {
  const { db, pool, userId, logger } = options;

  const transport = new SseTransport<DashboardEvent>({
    serialize: (event) => JSON.stringify(event),
    ...(options.heartbeatIntervalMs === undefined
      ? {}
      : { heartbeatIntervalMs: options.heartbeatIntervalMs }),
    ...(logger === undefined ? {} : { logger }),
  });

  const listSince = (afterSequence: number, limit: number): Promise<DashboardEvent[]> =>
    listDashboardEventsSince(db, { userId, afterSequence, limit });

  // O poller começa do que já existe: o histórico de quem conecta vem do
  // replay da própria rota, lido do banco, e não de uma reemissão do log
  // inteiro pelo transporte.
  const startCursor = await latestDashboardEventSequence(db, { userId });

  const poller = new DashboardEventPoller<DashboardEvent>({
    source: { listSince },
    transport,
    startCursor,
    ...(logger === undefined ? {} : { logger }),
  });

  const listener = new PgNotifyListener({
    notifier: createPgNotifier(pool),
    drainable: poller,
    channel: DASHBOARD_EVENT_CHANNEL,
    ...(logger === undefined ? {} : { logger }),
  });

  const port: DashboardEventsPort = {
    transport,
    listSince,
    append: (input) => appendDashboardEvent(db, { userId, ...input }),
  };

  return {
    port,
    start: async () => {
      transport.start();
      poller.start(options.fallbackIntervalMs);
      // Não é fatal: sem o `LISTEN` o stream continua funcionando pelo tique de
      // segurança, só com a latência do intervalo em vez de instantânea.
      await listener.start();
    },
    stop: async () => {
      listener.stop();
      poller.stop();
      await transport.stop();
    },
  };
}

export interface SettingsPortOptions {
  db: Database;
  userId: string;
}

export function createSettingsPort(options: SettingsPortOptions): SettingsPort {
  const { db, userId } = options;

  return {
    read: () => readUserSettings(db, { userId }),
    write: (key, value) => writeUserSetting(db, { userId, key, value }),
  };
}

export interface WorkPortOptions {
  db: Database;
  userId: string;
}

/**
 * Liga as rotas de Project, Task e Inbox ao repositório.
 *
 * O `userId` é fechado aqui, uma vez: nenhum handler recebe ou escolhe de quem
 * são os dados, então não existe rota que possa esquecer o escopo. Enquanto o
 * sistema é single-user isso é redundante; no dia em que deixar de ser, o lugar
 * a mudar é este e só este.
 */
export function createWorkPort(options: WorkPortOptions): WorkPort {
  const { db, userId } = options;

  return {
    projects: {
      list: (input) =>
        listProjects(db, {
          userId,
          page: input.page,
          pageSize: input.pageSize,
          status: input.status,
        }),
      create: (input) => createProject(db, { userId, ...input }),
      get: (projectId) => getProject(db, { userId, projectId }),
      update: (projectId, patch) => updateProject(db, { userId, projectId, patch }),
      setArchived: (projectId, archived) => setProjectArchived(db, { userId, projectId, archived }),
      activity: async (projectId, page) => {
        // A existência é checada antes de listar: sem isso, o diário de um
        // Project inexistente seria uma página vazia em vez de 404.
        const project = await findProjectRow(db, { userId, projectId });
        if (project === null) return null;

        return await listProjectActivity(db, { userId, projectId, ...page });
      },
    },
    tasks: {
      list: (input) =>
        listTasks(db, {
          userId,
          page: input.page,
          pageSize: input.pageSize,
          filters: input.filters,
        }),
      create: (input) => createTask(db, { userId, ...input }),
      get: (taskId) => getTaskDetail(db, { userId, taskId }),
      update: (taskId, patch) => updateTask(db, { userId, taskId, patch }),
      changeStatus: (taskId, to) => changeTaskStatus(db, { userId, taskId, to }),
      addDependency: (taskId, dependsOnTaskId) =>
        addTaskDependency(db, { userId, taskId, dependsOnTaskId }),
      removeDependency: (taskId, dependsOnTaskId) =>
        removeTaskDependency(db, { userId, taskId, dependsOnTaskId }),
    },
    inbox: {
      capture: (text) => captureInboxTask(db, { userId, text }),
      list: (page) => listInboxTasks(db, { userId, ...page }),
      promote: (taskId, input) => promoteInboxTask(db, { userId, taskId, ...input }),
      discard: (taskId) => discardInboxTask(db, { userId, taskId }),
    },
  };
}
