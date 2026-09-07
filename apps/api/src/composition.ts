import type { DashboardEvent } from "@dungeon-master/contracts";
import {
  appendDashboardEvent,
  createPgNotifier,
  type Database,
  type DatabaseHandle,
  DASHBOARD_EVENT_CHANNEL,
  latestDashboardEventSequence,
  listDashboardEventsSince,
  readUserSettings,
  writeUserSetting,
} from "@dungeon-master/database";
import { DashboardEventPoller, PgNotifyListener, SseTransport } from "@dungeon-master/events";

import type { Logger } from "./logger.js";
import type { DashboardEventsPort, SettingsPort } from "./ports.js";

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
