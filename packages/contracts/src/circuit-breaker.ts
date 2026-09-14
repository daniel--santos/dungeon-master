import { z } from "zod";

import { HarnessKeySchema } from "./harness.js";
import { PageQuerySchema, paginatedSchema } from "./pagination.js";

/**
 * CircuitBreaker: um disjuntor que para de enfileirar Runs num escopo depois
 * de falhas repetidas (planejamento v0.4, Fase 9).
 *
 * ```text
 * CLOSED    → OPEN       (um gatilho disparou)
 * OPEN      → HALF_OPEN  (o cooldown passou)
 * HALF_OPEN → CLOSED     (o Run de sondagem terminou bem)
 * HALF_OPEN → OPEN       (o Run de sondagem falhou)
 * qualquer  → CLOSED     (reset manual)
 * ```
 *
 * A máquina de estados é pura, em `@dungeon-master/domain`. O estado é
 * consultado já em `POST /runs`: `OPEN` recusa com `409 BREAKER_OPEN`;
 * `HALF_OPEN` deixa passar **um** Run de sondagem por vez, marcado em
 * `probeRunId`. Quem alimenta os gatilhos com os desfechos é o Worker (9B).
 * Estado que a API não reconhece não libera.
 */

export const BREAKER_SCOPE_VALUES = ["PROJECT", "LOADOUT", "HARNESS"] as const;

export const BreakerScopeSchema = z.enum(BREAKER_SCOPE_VALUES).meta({
  id: "BreakerScope",
  description: "`PROJECT` os Runs do Project; `LOADOUT` os do Loadout; `HARNESS` os do Harness.",
});

export type BreakerScope = z.infer<typeof BreakerScopeSchema>;

export const BREAKER_STATE_VALUES = ["CLOSED", "OPEN", "HALF_OPEN"] as const;

export const BreakerStateSchema = z.enum(BREAKER_STATE_VALUES).meta({
  id: "BreakerState",
  description: "`CLOSED` deixa passar; `OPEN` recusa; `HALF_OPEN` deixa passar uma sondagem.",
});

export type BreakerState = z.infer<typeof BreakerStateSchema>;

export const BREAKER_NAME_MAX_LENGTH = 200;
export const BREAKER_COOLDOWN_MIN_MS = 1_000;
export const BREAKER_COOLDOWN_MAX_MS = 7 * 24 * 60 * 60 * 1_000;
export const DEFAULT_BREAKER_COOLDOWN_MS = 15 * 60 * 1_000;

const NameSchema = z.string().trim().min(1).max(BREAKER_NAME_MAX_LENGTH);
const CountSchema = z.number().int().positive();
const WindowMsSchema = z.number().int().min(1_000);

const InWindowSchema = z.object({
  count: CountSchema,
  windowMs: WindowMsSchema,
});

/**
 * Os gatilhos, todos opcionais: qualquer um que dispare abre o disjuntor.
 *
 * `consecutiveFailures` conta desfechos `FAILED`/`TIMED_OUT` seguidos no
 * escopo; `failuresInWindow` conta falhas numa janela deslizante;
 * `permissionDeniedInWindow` conta `Diagnostic` com código `PERMISSION_DENIED`
 * na janela; `authNotAuthenticated` abre quando o Harness reporta credencial
 * ausente no preflight.
 */
export const BreakerTriggersSchema = z
  .object({
    consecutiveFailures: CountSchema.nullable(),
    failuresInWindow: InWindowSchema.nullable(),
    permissionDeniedInWindow: InWindowSchema.nullable(),
    authNotAuthenticated: z.boolean(),
  })
  .meta({ id: "BreakerTriggers", description: "O que abre o disjuntor." });

export type BreakerTriggers = z.infer<typeof BreakerTriggersSchema>;

export const CircuitBreakerSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do disjuntor."),
    name: z.string(),
    scope: BreakerScopeSchema,
    projectId: z.uuid().nullable().describe("Só em `PROJECT`."),
    loadoutId: z.uuid().nullable().describe("Só em `LOADOUT`."),
    harnessKey: HarnessKeySchema.nullable().describe("Só em `HARNESS`."),
    triggers: BreakerTriggersSchema,
    cooldownMs: z.number().int().positive().describe("Quanto tempo `OPEN` dura até `HALF_OPEN`."),
    state: BreakerStateSchema,
    openedAt: z.iso.datetime().nullable().describe("Quando abriu. Nulo em `CLOSED`."),
    reason: z.string().nullable().describe("Por que abriu, na frase canônica do domínio."),
    probeRunId: z
      .uuid()
      .nullable()
      .describe("Em `HALF_OPEN`, o Run de sondagem em voo. Só um por vez."),
    consecutiveFailures: z
      .number()
      .int()
      .nonnegative()
      .describe("O contador que o Worker (9B) alimenta. Zera no reset."),
    stateChangedAt: z.iso.datetime(),
    enabled: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "CircuitBreaker", description: "Um disjuntor de execução por escopo." });

export type CircuitBreaker = z.infer<typeof CircuitBreakerSchema>;

const TriggersInputShape = {
  consecutiveFailures: CountSchema.nullish(),
  failuresInWindow: InWindowSchema.nullish(),
  permissionDeniedInWindow: InWindowSchema.nullish(),
  authNotAuthenticated: z.boolean().optional(),
};

export const CreateCircuitBreakerSchema = z
  .object({
    name: NameSchema,
    scope: BreakerScopeSchema,
    projectId: z.uuid().nullish().describe("Obrigatório em `PROJECT`; recusado nos outros."),
    loadoutId: z.uuid().nullish().describe("Obrigatório em `LOADOUT`; recusado nos outros."),
    harnessKey: HarnessKeySchema.nullish().describe("Obrigatório em `HARNESS`; recusado nos outros."),
    ...TriggersInputShape,
    cooldownMs: z
      .number()
      .int()
      .min(BREAKER_COOLDOWN_MIN_MS)
      .max(BREAKER_COOLDOWN_MAX_MS)
      .optional()
      .describe(`Padrão: ${String(DEFAULT_BREAKER_COOLDOWN_MS)} ms (15 minutos).`),
    enabled: z.boolean().optional().describe("Padrão: ligado."),
  })
  .meta({
    id: "CreateCircuitBreaker",
    description: "Corpo de `POST /api/v1/circuit-breakers`. Pelo menos um gatilho. Nasce `CLOSED`.",
  });

export type CreateCircuitBreaker = z.infer<typeof CreateCircuitBreakerSchema>;

export const UpdateCircuitBreakerSchema = z
  .object({
    name: NameSchema.optional(),
    ...TriggersInputShape,
    cooldownMs: z
      .number()
      .int()
      .min(BREAKER_COOLDOWN_MIN_MS)
      .max(BREAKER_COOLDOWN_MAX_MS)
      .optional(),
    enabled: z.boolean().optional(),
  })
  .meta({
    id: "UpdateCircuitBreaker",
    description:
      "Corpo de `PATCH /api/v1/circuit-breakers/{id}`. Escopo e estado não mudam por aqui: " +
      "o estado só muda pelos desfechos e pelo reset.",
  });

export type UpdateCircuitBreaker = z.infer<typeof UpdateCircuitBreakerSchema>;

export const CircuitBreakerListQuerySchema = PageQuerySchema.extend({
  scope: BreakerScopeSchema.optional(),
  state: BreakerStateSchema.optional(),
  projectId: z.uuid().optional(),
}).meta({ id: "CircuitBreakerListQuery" });

export type CircuitBreakerListQuery = z.infer<typeof CircuitBreakerListQuerySchema>;

export const CircuitBreakerPageSchema = paginatedSchema(
  CircuitBreakerSchema,
  "CircuitBreakerPage",
  "Uma página de disjuntores, em ordem alfabética.",
);

export type CircuitBreakerPage = z.infer<typeof CircuitBreakerPageSchema>;

/**
 * O que `POST /runs` diz sobre o disjuntor que deixou o Run passar em
 * `HALF_OPEN`, e o que vai em `breaker` no `409 BREAKER_OPEN`.
 */
export const BreakerAdmissionSchema = z
  .object({
    breakerId: z.uuid(),
    name: z.string(),
    state: BreakerStateSchema.describe("O estado depois da decisão."),
    probe: z.boolean().describe("Verdadeiro quando este Run é a sondagem do `HALF_OPEN`."),
    decidedBy: z.string().describe("`BREAKER:<id>`."),
    reason: z.string(),
  })
  .meta({ id: "BreakerAdmission", description: "A decisão de um disjuntor sobre um pedido de Run." });

export type BreakerAdmission = z.infer<typeof BreakerAdmissionSchema>;
