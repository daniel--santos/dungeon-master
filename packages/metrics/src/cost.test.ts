import { describe, expect, it } from "vitest";

import { costOfRun, NOT_MEASURED, priceAt, prorateSubscription, sumByCurrency } from "./cost.js";
import { UNKNOWN_TOKENS } from "./facts.js";

const MARCO = Date.UTC(2026, 2, 1);
const ABRIL = Date.UTC(2026, 3, 1);
const MAIO = Date.UTC(2026, 4, 1);

const precoDeMarco = {
  currency: "USD",
  inputPerMillion: 3,
  outputPerMillion: 15,
  cacheReadPerMillion: 0.3,
  cacheWritePerMillion: 3.75,
  effectiveFrom: MARCO,
  effectiveTo: ABRIL,
};

const precoVigente = {
  ...precoDeMarco,
  inputPerMillion: 6,
  effectiveFrom: ABRIL,
  effectiveTo: null,
};

describe("priceAt", () => {
  it("escolhe a vigência da data, e não a mais recente", () => {
    const precos = [precoDeMarco, precoVigente];
    expect(priceAt(precos, Date.UTC(2026, 2, 15))?.inputPerMillion).toBe(3);
    expect(priceAt(precos, Date.UTC(2026, 4, 15))?.inputPerMillion).toBe(6);
  });

  it("devolve nulo antes da primeira vigência", () => {
    expect(priceAt([precoDeMarco], Date.UTC(2026, 1, 1))).toBeNull();
  });

  it("o fim da vigência é exclusivo: o instante do corte já é da seguinte", () => {
    expect(priceAt([precoDeMarco, precoVigente], ABRIL)?.inputPerMillion).toBe(6);
  });
});

describe("costOfRun", () => {
  const tokens = { input: 1_000_000, output: 100_000, cacheRead: 2_000_000, cacheWrite: 400_000 };

  it("multiplica cada componente pelo preço por milhão", () => {
    // 1·3 + 0,1·15 + 2·0,3 + 0,4·3,75 = 3 + 1,5 + 0,6 + 1,5 = 6,6
    expect(costOfRun({ tokens, price: precoDeMarco })).toEqual({
      status: "PRICED",
      currency: "USD",
      amount: 6.6,
    });
  });

  it("sem tokens reportados é NOT_MEASURED, mesmo havendo preço", () => {
    expect(costOfRun({ tokens: UNKNOWN_TOKENS, price: precoDeMarco })).toEqual(NOT_MEASURED);
  });

  it("sem preço é NOT_MEASURED, e nunca zero", () => {
    const sem = costOfRun({ tokens, price: null });
    expect(sem.status).toBe("NOT_MEASURED");
    expect(sem.amount).toBeNull();
    expect(sem.currency).toBeNull();
  });

  it("um componente ausente conta como zero na conta, sem tornar o conjunto desconhecido", () => {
    const parcial = { input: 1_000_000, output: null, cacheRead: null, cacheWrite: null };
    expect(costOfRun({ tokens: parcial, price: precoDeMarco })).toEqual({
      status: "PRICED",
      currency: "USD",
      amount: 3,
    });
  });
});

describe("prorateSubscription", () => {
  it("rateia a mensalidade pela fatia de tokens do mês", () => {
    expect(prorateSubscription({ monthlyCost: 200, windowTokens: 250, monthTokens: 1_000 })).toBe(
      50,
    );
  });

  it("sem tokens no mês, a fatia é zero — a mensalidade inteira seria pior", () => {
    expect(prorateSubscription({ monthlyCost: 200, windowTokens: 0, monthTokens: 0 })).toBe(0);
  });

  it("a fatia nunca passa de um, mesmo com a janela maior que o mês", () => {
    expect(prorateSubscription({ monthlyCost: 100, windowTokens: 5_000, monthTokens: 1_000 })).toBe(
      100,
    );
  });
});

describe("sumByCurrency", () => {
  it("soma dentro da moeda e nunca entre moedas", () => {
    const total = sumByCurrency([
      { status: "PRICED", currency: "USD", amount: 1.5 },
      { status: "PRICED", currency: "USD", amount: 2.25 },
      { status: "PRICED", currency: "BRL", amount: 10 },
    ]);
    expect(total).toEqual([
      { status: "PRICED", currency: "BRL", amount: 10 },
      { status: "PRICED", currency: "USD", amount: 3.75 },
    ]);
  });

  it("misturar precificado com rateado rebaixa o rótulo para estimativa", () => {
    const total = sumByCurrency([
      { status: "PRICED", currency: "USD", amount: 1 },
      { status: "ESTIMATED_SUBSCRIPTION", currency: "USD", amount: 4 },
    ]);
    expect(total).toEqual([{ status: "ESTIMATED_SUBSCRIPTION", currency: "USD", amount: 5 }]);
  });

  it("os não medidos viram uma entrada própria, nunca um zero somado", () => {
    const total = sumByCurrency([
      { status: "PRICED", currency: "USD", amount: 1 },
      NOT_MEASURED,
      NOT_MEASURED,
    ]);
    expect(total).toEqual([
      { status: "PRICED", currency: "USD", amount: 1 },
      { status: "NOT_MEASURED", currency: null, amount: null },
    ]);
  });
});

describe("a vigência de maio", () => {
  it("continua sendo a de abril quando nada foi cadastrado depois", () => {
    expect(priceAt([precoDeMarco, precoVigente], MAIO)?.inputPerMillion).toBe(6);
  });
});
