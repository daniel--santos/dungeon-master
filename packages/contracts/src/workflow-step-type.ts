import { z } from "zod";

/**
 * Tipos de step de Workflow. Cada um tem executor próprio no motor (Fase 4B).
 *
 * Minúsculo de propósito, como `RunResultStatus`: é vocabulário de um documento
 * escrito pelo usuário, e não um enum interno da máquina de estados.
 *
 * Mora em arquivo próprio, e não em `workflow.ts`, porque as condições das
 * políticas (`rule-condition.ts`, Fase 9A) falam de `stepType` e `run.ts`
 * carrega essas decisões: importar `workflow.ts` dali fecharia um ciclo com
 * `run.ts`, de onde o Workflow lê o teto do prompt. Acrescentar um tipo —
 * `delegate`, na 9B — é uma linha aqui e um executor no motor.
 */
export const WORKFLOW_STEP_TYPE_VALUES = [
  "agent",
  "command",
  "validation",
  "approval",
  "knowledge",
] as const;

export const WorkflowStepTypeSchema = z
  .enum(WORKFLOW_STEP_TYPE_VALUES)
  .meta({ id: "WorkflowStepType", description: "Tipo de um step de Workflow." });

export type WorkflowStepType = z.infer<typeof WorkflowStepTypeSchema>;
