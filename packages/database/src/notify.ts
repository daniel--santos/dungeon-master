// Adapted from Archon — packages/core/src/db/adapters/postgres.ts@0773b97 (`listen()`)
// Copyright (c) 2026 Cole Medin. Licensed under the MIT License.
// Changes: extraído do `PostgresAdapter` para uma função sobre um `Pool` do `pg`;
// o logger do Archon virou um callback opcional; a espera pelo `schemaInitPromise`
// saiu (as migrações já rodaram antes); a validação do nome do canal e o descarte
// da conexão em vez de devolvê-la ao pool foram mantidos como no original.

import type { Pool, PoolClient } from "pg";

import { DASHBOARD_EVENT_CHANNEL } from "@dungeon-master/contracts";

export { DASHBOARD_EVENT_CHANNEL };

/**
 * Assina um canal de `LISTEN` do PostgreSQL numa conexão dedicada.
 *
 * A conexão fica retirada do pool para continuar recebendo notificações, e é
 * **destruída** em vez de devolvida quando a assinatura acaba: um cliente que
 * deu `LISTEN` não pode voltar para o rodízio normal do pool, senão a próxima
 * consulta qualquer herda a assinatura.
 *
 * O `NOTIFY` deste canal não carrega payload; `onNotify` existe só para acordar
 * o drain por cursor (documento técnico, seção 10.1).
 */
export interface ListenOptions {
  /** Chamado a cada notificação. O payload é sempre string vazia neste canal. */
  onNotify: (payload: string) => void;
  /** Chamado quando a conexão dedicada morre. Quem chama decide se reconecta. */
  onError: (error: Error) => void;
}

/** Cancela a assinatura e destrói a conexão dedicada. Idempotente. */
export type Unlisten = () => void;

export async function listenToChannel(
  pool: Pool,
  channel: string,
  options: ListenOptions,
): Promise<Unlisten> {
  // `LISTEN` não aceita parâmetro, então o nome do canal é validado antes de
  // ser interpolado. Na prática só passamos uma constante.
  if (!/^[a-z_][a-z0-9_]*$/i.test(channel)) {
    throw new Error(`Nome de canal inválido para LISTEN: ${JSON.stringify(channel)}`);
  }

  const client: PoolClient = await pool.connect();
  let released = false;

  const release = (destroy: boolean | Error): void => {
    if (released) return;
    released = true;
    client.removeAllListeners("notification");
    client.removeAllListeners("error");
    client.release(destroy);
  };

  try {
    client.on("notification", (message) => {
      if (message.channel === channel) options.onNotify(message.payload ?? "");
    });

    client.on("error", (error: unknown) => {
      const wrapped = error instanceof Error ? error : new Error(String(error));
      release(wrapped);
      options.onError(wrapped);
    });

    // Se o `LISTEN` falhar, a conexão precisa voltar: um laço de reconexão com
    // falha repetida esgotaria o pool e travaria todo o resto do banco.
    await client.query(`LISTEN ${channel}`);
  } catch (error) {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    release(wrapped);
    throw wrapped;
  }

  return () => release(true);
}

/**
 * Fecha sobre o pool e devolve o formato que o `PgNotifyListener` de
 * `@dungeon-master/events` espera. O pacote de eventos não conhece `pg`.
 */
export function createPgNotifier(pool: Pool): {
  listen: (
    channel: string,
    onNotify: (payload: string) => void,
    onError: (error: Error) => void,
  ) => Promise<Unlisten>;
} {
  return {
    listen: (channel, onNotify, onError) => listenToChannel(pool, channel, { onNotify, onError }),
  };
}
