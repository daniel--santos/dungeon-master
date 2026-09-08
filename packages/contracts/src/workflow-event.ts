import { z } from "zod";

import {
  EXECUTION_EVENT_TYPE_VALUES,
  ExecutionEventSchema,
  type ExecutionEventType,
} from "./execution-event.js";
import {
  RunStepStatusSchema,
  StepSkipReasonSchema,
  WorkflowKeySchema,
  WorkflowStepTypeSchema,
} from "./workflow.js";

/**
 * `WorkflowEvent` — o que o motor de Workflow grava em `run_event`.
 *
 * É uma união **separada** de `ExecutionEvent`, e não cinco tipos a mais nela,
 * por duas razões:
 *
 * 1. `ExecutionEvent` é a linguagem de um **adapter de harness**: todo evento
 *    carrega `harness`, e o conjunto é o que a interface renderiza por tipo com
 *    um mapa exaustivo. Um `StepSkipped` não vem de harness nenhum — um step
 *    `command` nem tem um — e pôr `harness` nele seria mentir num campo que a
 *    auditoria lê.
 * 2. O log de um Run é **um só** (`run_event`), e o leitor já tolera tipo
 *    desconhecido: `RunEvent.type` é `string` de propósito. As duas uniões
 *    dividem a tabela sem dividir o cursor, e `RunEventPayload` é a união das
 *    duas para quem precisa fechar o conjunto na escrita.
 *
 * O `ApprovalRequested` continua sendo o do `ExecutionEvent`: o motor o emite
 * com o `harness` do Run e os campos `gateId`/`stepKey` opcionais, e a timeline
 * que já sabe desenhá-lo continua funcionando sem mudança.
 */

export const WORKFLOW_EVENT_TYPE_VALUES = [
  "StepStarted",
  "StepFinished",
  "StepSkipped",
  "ApprovalGranted",
  "ApprovalRejected",
] as const;

export const WorkflowEventTypeSchema = z
  .enum(WORKFLOW_EVENT_TYPE_VALUES)
  .meta({ id: "WorkflowEventType", description: "Tipos de evento do motor de Workflow." });

export type WorkflowEventType = z.infer<typeof WorkflowEventTypeSchema>;

const stepEventBase = {
  timestamp: z.iso.datetime().describe("Instante em que o fato aconteceu, em UTC (ISO 8601)."),
  runStepId: z.uuid(),
  stepKey: WorkflowKeySchema,
};

/** Uma tentativa do step começou. */
export const StepStartedEventSchema = z
  .object({
    type: z.literal("StepStarted"),
    ...stepEventBase,
    stepType: WorkflowStepTypeSchema,
    attempt: z.number().int().positive().describe("N-ésima tentativa, começando em 1."),
  })
  .meta({ id: "StepStartedEvent" });

/**
 * O step chegou a um estado terminal por ter rodado.
 *
 * `SKIPPED` tem evento próprio: um step pulado não rodou, e o motivo dele é um
 * predicado, não um resultado.
 */
export const StepFinishedEventSchema = z
  .object({
    type: z.literal("StepFinished"),
    ...stepEventBase,
    status: RunStepStatusSchema.describe("`SUCCEEDED`, `FAILED`, `TIMED_OUT` ou `CANCELLED`."),
    attempt: z.number().int().positive(),
    summary: z.string().describe("Resumo do resultado, para leitura humana. Sanitizado."),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .meta({ id: "StepFinishedEvent" });

/** O step não rodou. O motivo diz qual predicado falhou ou qual dependência não assentou. */
export const StepSkippedEventSchema = z
  .object({
    type: z.literal("StepSkipped"),
    ...stepEventBase,
    reason: StepSkipReasonSchema,
  })
  .meta({ id: "StepSkippedEvent" });

const approvalDecisionBase = {
  timestamp: z.iso.datetime().describe("Instante da decisão, em UTC (ISO 8601)."),
  gateId: z.uuid(),
  gateKey: WorkflowKeySchema,
  runStepId: z.uuid(),
  stepKey: WorkflowKeySchema,
  decidedBy: z.uuid().describe("Usuário que decidiu."),
  note: z.string().nullable().describe("Justificativa, sanitizada."),
};

/** Um humano aprovou o gate. Auditoria: gravado na mesma transação do CAS. */
export const ApprovalGrantedEventSchema = z
  .object({
    type: z.literal("ApprovalGranted"),
    ...approvalDecisionBase,
  })
  .meta({ id: "ApprovalGrantedEvent" });

/** Um humano recusou o gate. Auditoria: gravado na mesma transação do CAS. */
export const ApprovalRejectedEventSchema = z
  .object({
    type: z.literal("ApprovalRejected"),
    ...approvalDecisionBase,
  })
  .meta({ id: "ApprovalRejectedEvent" });

export const WorkflowEventSchema = z
  .discriminatedUnion("type", [
    StepStartedEventSchema,
    StepFinishedEventSchema,
    StepSkippedEventSchema,
    ApprovalGrantedEventSchema,
    ApprovalRejectedEventSchema,
  ])
  .meta({
    id: "WorkflowEvent",
    description: "Evento do motor de Workflow, gravado em `run_event`.",
  });

export type WorkflowEvent = z.infer<typeof WorkflowEventSchema>;
export type StepStartedEvent = z.infer<typeof StepStartedEventSchema>;
export type StepFinishedEvent = z.infer<typeof StepFinishedEventSchema>;
export type StepSkippedEvent = z.infer<typeof StepSkippedEventSchema>;
export type ApprovalGrantedEvent = z.infer<typeof ApprovalGrantedEventSchema>;
export type ApprovalRejectedEvent = z.infer<typeof ApprovalRejectedEventSchema>;

export function isWorkflowEventType(type: string): type is WorkflowEventType {
  return (WORKFLOW_EVENT_TYPE_VALUES as readonly string[]).includes(type);
}

// --------------------------------------------------------------------------
// O vocabulário completo de `run_event`
// --------------------------------------------------------------------------

/**
 * Tudo o que pode ser gravado em `run_event`: os eventos do harness e os do
 * motor. Os dois conjuntos são disjuntos por construção, e o teste do contrato
 * garante isso — um nome repetido tornaria `RunEventPayload` ambíguo.
 */
export const RUN_EVENT_TYPE_VALUES = [
  ...EXECUTION_EVENT_TYPE_VALUES,
  ...WORKFLOW_EVENT_TYPE_VALUES,
] as const;

export type RunEventType = ExecutionEventType | WorkflowEventType;

export const RunEventPayloadSchema = z
  .union([ExecutionEventSchema, WorkflowEventSchema])
  .meta({ id: "RunEventPayload", description: "Um evento de execução ou do motor de Workflow." });

export type RunEventPayload = z.infer<typeof RunEventPayloadSchema>;
