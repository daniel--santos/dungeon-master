import { type WorkflowDefinition, WorkflowDefinitionSchema } from "@dungeon-master/contracts";
import { and, eq } from "drizzle-orm";

import type { Database } from "./client.js";
import { newId } from "./ids.js";
import { workflows } from "./schema/workflow.js";

/**
 * O primeiro Workflow do planejamento (v0.4, Fase 4):
 *
 * ```text
 * Analyze → Plan → [Approval] → Execute → Validate
 * ```
 *
 * Semeado como dado, e não como constante do código: o usuário pode editá-lo,
 * renomeá-lo ou apagá-lo, e a semente respeita o que já existe — idempotente
 * pelo nome, como os cadastros de execução. O nome vem do glossário `dnd`
 * pelo mesmo motivo dos perfis "Campo aberto" e "Masmorra selada": é a coluna
 * `name` de um registro do usuário, não um label de interface.
 *
 * A definição passa pelo schema aqui mesmo, ao carregar o módulo: um erro de
 * digitação no step derruba o `db:seed` na hora, em vez de gravar uma
 * definição que o motor recusaria no primeiro Run.
 */
export const GUIDED_EXPEDITION_WORKFLOW: WorkflowDefinition = WorkflowDefinitionSchema.parse({
  name: "Expedição guiada",
  description:
    "Analisa, planeja, espera a aprovação do plano, executa e valida. O passo de " +
    "execução só roda se o plano for aprovado.",
  steps: [
    {
      type: "agent",
      key: "analyze",
      name: "Analisar",
      dependsOn: [],
      prompt:
        "Analise a tarefa descrita e o código envolvido. Liste o que precisa mudar, " +
        "os riscos e as dúvidas. Não altere arquivos nesta etapa.",
    },
    {
      type: "agent",
      key: "plan",
      name: "Planejar",
      dependsOn: ["analyze"],
      includeOutputsOf: ["analyze"],
      prompt:
        "Com base na análise, escreva um plano de implementação em passos curtos e " +
        "verificáveis. Diga quais arquivos serão tocados e como validar o resultado. " +
        "Não altere arquivos nesta etapa.",
    },
    {
      type: "approval",
      key: "approve-plan",
      name: "Aprovar o plano",
      dependsOn: ["plan"],
      gateKey: "plan",
      title: "Aprovar o plano de implementação",
      description: "O plano proposto pelo agente precisa de aprovação antes da execução.",
    },
    {
      type: "agent",
      key: "execute",
      name: "Executar",
      dependsOn: ["approve-plan"],
      includeOutputsOf: ["plan"],
      when: [{ kind: "stepSucceeded", step: "approve-plan" }],
      prompt:
        "Implemente o plano aprovado, passo a passo. Rode os testes existentes ao " +
        "terminar e relate o que mudou.",
    },
    {
      type: "validation",
      key: "validate",
      name: "Validar",
      dependsOn: ["execute"],
      argv: ["git", "status", "--porcelain"],
    },
  ],
});

export interface WorkflowSeedResult {
  readonly workflowsCreated: number;
  readonly workflowsTotal: number;
}

const WORKFLOW_SEEDS: readonly WorkflowDefinition[] = [GUIDED_EXPEDITION_WORKFLOW];

/** Garante os Workflows de partida. Idempotente pelo nome; não reescreve o que existe. */
export async function seedWorkflows(
  db: Database,
  input: { userId: string },
): Promise<WorkflowSeedResult> {
  let workflowsCreated = 0;

  for (const definition of WORKFLOW_SEEDS) {
    const [existing] = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(and(eq(workflows.userId, input.userId), eq(workflows.name, definition.name)));

    if (existing !== undefined) continue;

    await db.insert(workflows).values({
      id: newId(),
      userId: input.userId,
      name: definition.name,
      description: definition.description ?? null,
      definition,
    });
    workflowsCreated += 1;
  }

  return { workflowsCreated, workflowsTotal: WORKFLOW_SEEDS.length };
}
