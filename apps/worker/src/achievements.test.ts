import type { Database } from "@dungeon-master/database";
import { describe, expect, it } from "vitest";

import { createAchievementProjector, loadAchievementCatalog } from "./achievements.js";

/**
 * O contrato da ligação entre o Worker e o projetor.
 *
 * O que o projetor **calcula** é testado com banco embutido em
 * `@dungeon-master/database`. O que se testa aqui é a única coisa que este
 * arquivo decide: quando projetar, e o que acontece quando projetar falha. Nada
 * disso precisa de PostgreSQL, e é por isso que o banco entra falso.
 */

/** Um banco que conta as transações e falha em todas, se pedirem. */
function bancoFalso(options: { falhar?: boolean } = {}) {
  let transacoes = 0;

  const db = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      transacoes += 1;
      if (options.falhar === true) throw new Error("banco fora do ar");
      return await fn({});
    },
  };

  return {
    get transacoes() {
      return transacoes;
    },
    db: db as unknown as Database,
  };
}

/** Um banco que segura a transação até alguém abrir a porta, e então falha. */
function bancoBloqueado() {
  let liberar!: () => void;
  const porta = new Promise<void>((resolve) => {
    liberar = resolve;
  });

  let transacoes = 0;

  const db = {
    transaction: async (): Promise<never> => {
      transacoes += 1;
      await porta;
      throw new Error("banco fora do ar");
    },
  };

  return {
    get transacoes() {
      return transacoes;
    },
    liberar: () => {
      liberar();
    },
    db: db as unknown as Database,
  };
}

describe("catálogo do Worker", () => {
  it("carrega o catálogo fixo e os templates do pacote", () => {
    const { definitions, templates } = loadAchievementCatalog();

    expect(definitions.length).toBeGreaterThan(0);
    expect(templates.length).toBeGreaterThan(0);
    // A Fase 2.5 pede estas duas; se alguma sair do catálogo, o critério de
    // conclusão da fase para de valer e o teste tem de dizer isso.
    expect(definitions.map((definition) => definition.key)).toContain("first_expedition");
    expect(definitions.map((definition) => definition.key)).toContain("monster_slayer");
  });
});

describe("projetor no laço do Worker", () => {
  it("um banco fora do ar não lança: o passe termina com o cursor parado", async () => {
    const banco = bancoFalso({ falhar: true });
    const projector = createAchievementProjector({ db: banco.db, userId: "u", logger: undefined });

    const relatorio = await projector.run("always");

    expect(relatorio.ok).toBe(false);
    expect(relatorio.unlocked).toBe(0);
    expect(relatorio.error).toContain("banco fora do ar");
  });

  it("`trigger` volta antes do passe terminar, e `drain` espera por ele", async () => {
    const bloqueado = bancoBloqueado();
    const projector = createAchievementProjector({
      db: bloqueado.db,
      userId: "u",
      logger: undefined,
    });

    // Sem `await`: se `trigger` esperasse o passe, o tique do Worker ficaria
    // preso atrás de uma projeção, que é o que a Fase 2.5 proíbe.
    projector.trigger();
    expect(bloqueado.transacoes).toBe(1);

    bloqueado.liberar();
    await projector.drain();
    expect(bloqueado.transacoes).toBe(1);
  });

  it("disparos durante um passe não empilham passes concorrentes", async () => {
    const bloqueado = bancoBloqueado();
    const projector = createAchievementProjector({
      db: bloqueado.db,
      userId: "u",
      logger: undefined,
    });

    projector.trigger();
    projector.trigger();
    projector.trigger();

    // Dois passes concorrentes disputariam o mesmo cursor e o mesmo `INSERT` de
    // desbloqueio. Os dois disparos extras viram no máximo uma segunda volta —
    // e ela nem acontece, porque a primeira falhou e o laço encerra.
    expect(bloqueado.transacoes).toBe(1);

    bloqueado.liberar();
    await projector.drain();
    expect(bloqueado.transacoes).toBe(1);
  });
});
