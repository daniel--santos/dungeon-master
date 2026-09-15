import { z } from "zod";

/**
 * O vocabulário de dinheiro (planejamento v0.4, Fase 10A).
 *
 * Módulo folha de propósito: não importa nenhum outro contrato. `provider.ts`
 * precisa de `BillingKind` e `metrics.ts` precisa dele também, e o caminho
 * curto — declarar em `metrics.ts` e importar de lá no Provider — fechava um
 * ciclo (`provider` → `metrics` → `run` → … → `capability` → `provider`) que o
 * ESM tolera e o CJS do `drizzle-kit` não: o `generate` morria com
 * `Cannot access 'ProviderKindSchema' before initialization`. Uma folha não
 * fecha ciclo nenhum.
 *
 * ## A regra do custo
 *
 * Um número de custo só aparece acompanhado de `status` e de `currency`, e
 * **nunca** de um zero inventado:
 *
 * - `PRICED` — há preço vigente para o Model na data do Run e o harness
 *   reportou tokens. O valor é a conta.
 * - `ESTIMATED_SUBSCRIPTION` — o Provider é de assinatura e tem `monthlyCost`.
 *   O valor é o rateio da mensalidade pela fatia de tokens do Provider no mês
 *   civil UTC, calculado na leitura (a fatia muda até o mês fechar) e por isso
 *   nunca gravado por Run.
 * - `NOT_MEASURED` — não há preço nem assinatura, **ou** o harness não reportou
 *   tokens. `amount` e `currency` vêm nulos.
 *
 * Somas só acontecem dentro da mesma moeda: toda resposta de custo é uma lista
 * por moeda, nunca um total único. Converter exigiria uma taxa de câmbio, que é
 * um dado externo com data — e um sistema que não a tem não deve inventá-la.
 */

export const COST_STATUS_VALUES = ["PRICED", "ESTIMATED_SUBSCRIPTION", "NOT_MEASURED"] as const;

export const CostStatusSchema = z.enum(COST_STATUS_VALUES).meta({
  id: "CostStatus",
  description:
    "De onde o custo saiu. `PRICED` é preço por token vigente na data do Run; " +
    "`ESTIMATED_SUBSCRIPTION` é o rateio de uma mensalidade pela fatia de tokens " +
    "do mês; `NOT_MEASURED` é ausência de preço ou de tokens reportados, nunca zero.",
});

export type CostStatus = z.infer<typeof CostStatusSchema>;

export const BILLING_KIND_VALUES = ["PER_TOKEN", "SUBSCRIPTION"] as const;

export const BillingKindSchema = z.enum(BILLING_KIND_VALUES).meta({
  id: "BillingKind",
  description:
    "Como o Provider cobra. `PER_TOKEN` usa `model_price`; `SUBSCRIPTION` usa " +
    "`monthlyCost` rateado. Nulo é desconhecido, e desconhecido custa `NOT_MEASURED`.",
});

export type BillingKind = z.infer<typeof BillingKindSchema>;

/** Código ISO 4217, três letras maiúsculas. */
export const CurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "A moeda é um código ISO 4217 de três letras, como USD ou BRL.");

export const MoneySchema = z
  .object({
    currency: z.string().nullable().describe("ISO 4217. Nulo quando o custo não foi medido."),
    amount: z
      .number()
      .nullable()
      .describe("O valor na moeda. Nulo quando o custo não foi medido — nunca zero."),
    status: CostStatusSchema,
  })
  .meta({
    id: "Money",
    description: "Um custo com procedência. Sem `PRICED` ou assinatura, `amount` é nulo.",
  });

export type Money = z.infer<typeof MoneySchema>;
