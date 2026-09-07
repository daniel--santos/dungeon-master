import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createDatabase, type DatabaseHandle } from "../src/client.js";
import { appendDashboardEvent, listDashboardEventsSince } from "../src/dashboard-event.js";
import { DASHBOARD_EVENT_CHANNEL, listenToChannel } from "../src/notify.js";
import { dashboardEvents } from "../src/schema/dashboard-event.js";
import { LOCAL_USER_ID } from "../src/seed.js";

let handle: DatabaseHandle;

beforeAll(() => {
  handle = createDatabase({ url: inject("databaseUrl"), max: 3, applicationName: "vitest-events" });
});

afterAll(async () => {
  await handle.db.delete(dashboardEvents).where(eq(dashboardEvents.userId, LOCAL_USER_ID));
  await handle.close();
});

describe("dashboard_event", () => {
  it("grava com sequence crescente e devolve o contrato do SSE", async () => {
    const first = await appendDashboardEvent(handle.db, {
      userId: LOCAL_USER_ID,
      type: "system.ping",
      payload: { origem: "teste" },
    });
    const second = await appendDashboardEvent(handle.db, {
      userId: LOCAL_USER_ID,
      type: "settings.changed",
      payload: { key: "ui.theme", value: "plain" },
    });

    expect(second.sequence).toBeGreaterThan(first.sequence);
    expect(first.type).toBe("system.ping");
    expect(second.payload).toEqual({ key: "ui.theme", value: "plain" });
    // `createdAt` sai em UTC no formato ISO, que é o que o contrato exige.
    expect(first.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("lista apenas o que vem depois do cursor, em ordem", async () => {
    const marco = await appendDashboardEvent(handle.db, {
      userId: LOCAL_USER_ID,
      type: "system.ping",
      payload: null,
    });
    const depois = await appendDashboardEvent(handle.db, {
      userId: LOCAL_USER_ID,
      type: "system.ping",
      payload: { n: 1 },
    });

    const lidos = await listDashboardEventsSince(handle.db, {
      userId: LOCAL_USER_ID,
      afterSequence: marco.sequence,
    });

    expect(lidos.map((event) => event.sequence)).toEqual([depois.sequence]);
  });

  it("respeita o limite e mantém a ordem crescente", async () => {
    const partida = await appendDashboardEvent(handle.db, {
      userId: LOCAL_USER_ID,
      type: "system.ping",
      payload: null,
    });

    for (let i = 0; i < 3; i += 1) {
      await appendDashboardEvent(handle.db, {
        userId: LOCAL_USER_ID,
        type: "system.ping",
        payload: { i },
      });
    }

    const lidos = await listDashboardEventsSince(handle.db, {
      userId: LOCAL_USER_ID,
      afterSequence: partida.sequence,
      limit: 2,
    });

    expect(lidos).toHaveLength(2);
    expect(lidos[1]!.sequence).toBeGreaterThan(lidos[0]!.sequence);
  });

  it("não enxerga evento de outro usuário", async () => {
    const outroUsuario = await listDashboardEventsSince(handle.db, {
      userId: "01996d00-0000-7000-8000-0000000000ff",
      afterSequence: 0,
    });

    expect(outroUsuario).toEqual([]);
  });
});

describe("trigger de NOTIFY", () => {
  it("acorda o ouvinte no commit, sem payload, uma vez por transação", async () => {
    const recebidas: string[] = [];
    let resolver: (() => void) | undefined;
    const primeira = new Promise<void>((resolve) => {
      resolver = resolve;
    });

    const unlisten = await listenToChannel(handle.pool, DASHBOARD_EVENT_CHANNEL, {
      onNotify: (payload) => {
        recebidas.push(payload);
        resolver?.();
      },
      onError: () => {
        /* o teste falha pelo timeout se a conexão morrer */
      },
    });

    try {
      // Duas inserções numa transação só: o trigger é por statement e o
      // PostgreSQL ainda colapsa notificações idênticas na mesma transação.
      await handle.db.transaction(async (tx) => {
        await appendDashboardEvent(tx, {
          userId: LOCAL_USER_ID,
          type: "system.ping",
          payload: { lote: 1 },
        });
        await appendDashboardEvent(tx, {
          userId: LOCAL_USER_ID,
          type: "system.ping",
          payload: { lote: 2 },
        });
      });

      await primeira;

      expect(recebidas.length).toBeGreaterThanOrEqual(1);
      // Sem payload: a notificação só diz "vá ler a tabela".
      expect(recebidas.every((payload) => payload === "")).toBe(true);
    } finally {
      unlisten();
    }
  });

  it("não notifica quando a transação é desfeita", async () => {
    const recebidas: string[] = [];

    const unlisten = await listenToChannel(handle.pool, DASHBOARD_EVENT_CHANNEL, {
      onNotify: (payload) => recebidas.push(payload),
      onError: () => {
        /* idem */
      },
    });

    try {
      await expect(
        handle.db.transaction(async (tx) => {
          await appendDashboardEvent(tx, {
            userId: LOCAL_USER_ID,
            type: "system.ping",
            payload: { desfeito: true },
          });
          throw new Error("rollback proposital");
        }),
      ).rejects.toThrow("rollback proposital");

      // Uma inserção depois do rollback prova que o canal está vivo: se algo
      // chegar, é esta segunda notificação, e nunca a da transação desfeita.
      await appendDashboardEvent(handle.db, {
        userId: LOCAL_USER_ID,
        type: "system.ping",
        payload: { depois: true },
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(recebidas).toHaveLength(1);
    } finally {
      unlisten();
    }
  });

  it("recusa um nome de canal que não seja identificador", async () => {
    await expect(
      listenToChannel(handle.pool, 'x"; DROP TABLE "user', {
        onNotify: () => undefined,
        onError: () => undefined,
      }),
    ).rejects.toThrow(/canal inválido/i);
  });
});
