import { getGlossary } from "@dungeon-master/glossary";

import type { WorkflowDefinitionBody, WorkflowRecord } from "@/lib/api-types";

/**
 * O exemplo que o editor preenche: a "Expedição guiada" do planejamento
 * (v0.4, Fase 4), `Analyze → Plan → [Approval] → Execute → Validate`.
 *
 * A fonte preferida é o próprio Workflow semeado pelo `db:seed`, lido da
 * lista: se o usuário o editou, o exemplo acompanha. A cópia abaixo existe
 * para o botão continuar funcionando num banco sem a semente (o e2e é um), e
 * é a mesma forma com os nomes do glossário no lugar dos literais do tema.
 *
 * O nome da semente é o label de `entity.run` no tema, mais "guiada" — é a
 * coluna `name` de um registro do usuário, não um label de interface, e por
 * isso a comparação lê o glossário em vez de escrever a palavra aqui.
 */

/** O nome com que a semente registra o Workflow de partida. */
export function seededExampleName(): string {
  return `${getGlossary("dnd")["entity.run"]} guiada`;
}

/** Sufixo do exemplo preenchido, para o nome não colidir com a semente. */
const COPY_SUFFIX = " (cópia)";

function builtInExample(name: string): WorkflowDefinitionBody {
  return {
    name,
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
        name: "Revisar o plano",
        dependsOn: ["plan"],
        gateKey: "plan",
        title: "Confirmar o plano de implementação",
        description: "O plano proposto pelo agente precisa de confirmação antes da execução.",
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
  };
}

/**
 * A definição de exemplo, com o nome já sufixado para poder ser salva ao
 * lado da semente.
 */
export function exampleDefinition(
  workflows: readonly WorkflowRecord[],
  fallbackName: string,
): WorkflowDefinitionBody {
  const seeded = workflows.find((workflow) => workflow.name === seededExampleName());
  if (seeded !== undefined) {
    return { ...seeded.definition, name: `${seeded.definition.name}${COPY_SUFFIX}` };
  }
  return builtInExample(`${fallbackName}${COPY_SUFFIX}`);
}
