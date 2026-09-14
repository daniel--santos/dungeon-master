import { z } from "zod";

import { AutonomyLevelSchema } from "./autonomy.js";
import { RoutingDecisionSchema } from "./routing-rule.js";

/**
 * TaskSuggestions: o que `POST /tasks/{id}/suggestions` responde (documento
 * técnico, seção 40, nível 1: "o sistema sugere Loadout e Workflow").
 *
 * Uma sugestão é uma `RoutingDecision` por espécie: a regra que escolheu, ou
 * o padrão do sistema, com o motivo. Nada aqui grava: a Task continua como
 * está até alguém aplicar a sugestão. Exige nível de autonomia ≥ 1.
 */
export const TaskSuggestionsSchema = z
  .object({
    taskId: z.uuid(),
    projectId: z.uuid(),
    autonomyLevel: AutonomyLevelSchema,
    loadout: RoutingDecisionSchema.describe("O Loadout sugerido, ou o padrão."),
    workflow: RoutingDecisionSchema.describe("O Workflow sugerido, o da Task, ou nenhum."),
    model: RoutingDecisionSchema.describe(
      "O Model sugerido, compatível com o Harness do Loadout sugerido.",
    ),
    budgetPressure: z
      .number()
      .min(0)
      .describe("A pressão de orçamento usada como fato: a maior razão consumo/teto."),
    computedAt: z.iso.datetime(),
  })
  .meta({ id: "TaskSuggestions", description: "Loadout, Workflow e Model sugeridos para a Task." });

export type TaskSuggestions = z.infer<typeof TaskSuggestionsSchema>;
