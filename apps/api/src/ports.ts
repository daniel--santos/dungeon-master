import type {
  DashboardEvent,
  DashboardEventType,
  JsonValue,
  UserSettings,
  UserSettingsKey,
} from "@dungeon-master/contracts";
import { SseTransport } from "@dungeon-master/events";

/**
 * As dependências que `createApp` recebe de fora.
 *
 * Toda uma por injeção, e nenhuma aberta no escopo do módulo: o
 * `scripts/gen-openapi.ts` instancia a app para gerar a spec sem servidor e sem
 * PostgreSQL, e um handler que abrisse conexão na importação quebraria o
 * `pnpm gen` e o CI junto.
 */

/** Resultado do `SELECT 1` que o health check reporta. */
export interface DatabaseProbe {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly error: string | null;
}

/** O transporte SSE já ligado ao poller e ao ouvinte de NOTIFY. */
export type DashboardEventTransport = SseTransport<DashboardEvent>;

export interface DashboardEventsPort {
  readonly transport: DashboardEventTransport;
  /** Eventos posteriores ao cursor, em ordem crescente de `sequence`. */
  listSince(afterSequence: number, limit: number): Promise<DashboardEvent[]>;
  /** Grava um evento. Hoje só o endpoint de ping usa. */
  append(input: { type: DashboardEventType; payload: JsonValue }): Promise<DashboardEvent>;
}

export interface SettingsPort {
  /** O objeto completo, com os padrões aplicados. */
  read(): Promise<UserSettings>;
  /**
   * Grava uma chave e emite `settings.changed` **na mesma transação**, e
   * devolve o objeto completo já atualizado.
   */
  write(key: UserSettingsKey, value: JsonValue): Promise<UserSettings>;
}

/**
 * Portas inertes, para quando a app é instanciada só pela forma das rotas.
 *
 * Usadas por `scripts/gen-openapi.ts` e pelos testes que só olham `/health`.
 * Toda chamada lança: se um handler que deveria estar desligado for exercitado,
 * o teste falha alto em vez de passar por acidente.
 */
export function createSpecPorts(): {
  probeDatabase: () => Promise<DatabaseProbe>;
  events: DashboardEventsPort;
  settings: SettingsPort;
} {
  const recusar = (recurso: string): never => {
    throw new Error(`Porta inerte: ${recurso} não está disponível nesta instância da app.`);
  };

  return {
    probeDatabase: async () => ({ ok: true, latencyMs: 0, error: null }),
    events: {
      // O transporte não abre nada até `start()`; construir é barato e sem efeito.
      transport: new SseTransport<DashboardEvent>({
        serialize: (event) => JSON.stringify(event),
        heartbeatIntervalMs: 0,
      }),
      listSince: async () => recusar("o replay de eventos"),
      append: async () => recusar("a gravação de eventos"),
    },
    settings: {
      read: async () => recusar("a leitura de configurações"),
      write: async () => recusar("a escrita de configurações"),
    },
  };
}
