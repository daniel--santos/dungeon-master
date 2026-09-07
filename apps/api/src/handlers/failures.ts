import type {
  DependencyWriteFailure,
  InboxFailure,
  RegistryWriteFailure,
  RunWriteFailure,
  TaskWriteFailure,
} from "@dungeon-master/database";

import { HttpProblem, ProblemType } from "../problem.js";

/**
 * Traduz as recusas do domínio em problem details, em português.
 *
 * O domínio devolve código e dados; o texto nasce aqui. É o que permite ao
 * `packages/domain` não escrever frase de interface nenhuma e ainda assim
 * produzir um `detail` que diz exatamente o que impediu a operação — o `409`
 * genérico "conflito" obrigaria o usuário a adivinhar.
 */

type TransitionRejected = Extract<TaskWriteFailure, { code: "TRANSITION_REJECTED" }>;

function listar(ids: readonly string[]): string {
  return ids.join(", ");
}

function descreverRecusaDeTransicao(rejection: TransitionRejected["rejection"]): string {
  switch (rejection.code) {
    case "INVALID_TRANSITION": {
      const destinos =
        rejection.allowed.length === 0 ? "nenhum: é um estado terminal" : listar(rejection.allowed);
      return (
        `Uma Task em ${rejection.from} não pode ir para ${rejection.to}. ` +
        `A partir de ${rejection.from} os estados possíveis são: ${destinos}.`
      );
    }
    case "CHILDREN_NOT_SETTLED":
      return (
        "A Task só pode ser concluída depois que todas as subtarefas estiverem " +
        `COMPLETED ou CANCELLED. Ainda pendentes: ${listar(rejection.blocking)}.`
      );
    case "DEPENDENCIES_NOT_COMPLETED":
      return (
        "A Task depende de outras que ainda não estão COMPLETED: " +
        `${listar(rejection.blocking)}. Conclua-as ou remova a dependência.`
      );
  }
}

export function taskFailureProblem(failure: TaskWriteFailure): HttpProblem {
  switch (failure.code) {
    case "PROJECT_NOT_FOUND":
      return new HttpProblem({
        status: 404,
        type: ProblemType.notFound,
        title: "Project não encontrado",
        detail: `Não existe Project com o id ${failure.projectId}.`,
      });
    case "PROJECT_ARCHIVED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Project arquivado",
        detail: `O Project ${failure.projectId} está arquivado e não aceita Tasks novas. Desarquive-o antes.`,
      });
    case "PARENT_NOT_FOUND":
      return new HttpProblem({
        status: 404,
        type: ProblemType.notFound,
        title: "Task mãe não encontrada",
        detail: `Não existe Task com o id ${failure.parentTaskId} para ser a mãe desta.`,
      });
    case "PARENT_IN_OTHER_PROJECT":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Task mãe em outro Project",
        detail: `A Task ${failure.parentTaskId} pertence a outro Project. Mãe e subtarefa vivem no mesmo Project.`,
      });
    case "PARENT_IN_INBOX":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Task mãe na Inbox",
        detail: `A Task ${failure.parentTaskId} está em INBOX, e uma captura não tem subtarefas. Promova-a antes.`,
      });
    case "PARENT_CYCLE":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Hierarquia em ciclo",
        detail: `A Task mãe escolhida é descendente desta, e a hierarquia ficaria em ciclo: ${listar(failure.path)}.`,
      });
    case "TASK_IN_INBOX":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Task na Inbox",
        detail:
          "Uma Task em INBOX não tem Project, mãe nem dependências. " +
          "Use POST /api/v1/inbox/{id}/promote para dar um Project a ela.",
      });
    case "TASK_HAS_SUBTREE":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Task com hierarquia",
        detail:
          "Só uma Task sem mãe e sem subtarefas pode trocar de Project. " +
          "Mover uma árvore inteira ainda não é suportado.",
      });
    case "PROJECT_REQUIRED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Project obrigatório",
        detail:
          `Sair de INBOX para ${failure.to} exige um Project. ` +
          "Use POST /api/v1/inbox/{id}/promote, que escolhe o Project e faz a transição.",
      });
    case "TRANSITION_REJECTED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Transição não permitida",
        detail: descreverRecusaDeTransicao(failure.rejection),
      });
  }
}

export function dependencyFailureProblem(failure: DependencyWriteFailure): HttpProblem {
  switch (failure.code) {
    case "SELF_DEPENDENCY":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Auto-dependência",
        detail: "Uma Task não pode depender de si mesma.",
      });
    case "TASK_IN_INBOX":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Task na Inbox",
        detail:
          "Uma Task em INBOX não participa do grafo de dependências. Promova-a antes de ligá-la a outra.",
      });
    case "DEPENDENCY_CYCLE":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Ciclo de dependências",
        detail:
          "A dependência criaria um impasse em que nenhuma das Tasks poderia ser " +
          `enfileirada: ${listar(failure.path)}.`,
      });
  }
}

export function inboxFailureProblem(failure: InboxFailure): HttpProblem {
  switch (failure.code) {
    case "NOT_IN_INBOX":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Task fora da Inbox",
        detail: `A Task está em ${failure.status}, e as rotas da Inbox só valem para Tasks em INBOX.`,
      });
    case "PROJECT_NOT_FOUND":
      return new HttpProblem({
        status: 404,
        type: ProblemType.notFound,
        title: "Project não encontrado",
        detail: `Não existe Project com o id ${failure.projectId}.`,
      });
    case "PROJECT_ARCHIVED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Project arquivado",
        detail: `O Project ${failure.projectId} está arquivado e não aceita Tasks novas.`,
      });
  }
}

/**
 * Traduz as recusas dos cadastros de execução.
 *
 * Uma união só para as cinco entidades, então um tradutor só: os motivos se
 * repetem, e cinco funções quase iguais divergiriam na primeira adição.
 */
export function registryFailureProblem(failure: RegistryWriteFailure): HttpProblem {
  switch (failure.code) {
    case "NAME_TAKEN":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Nome já usado",
        detail: `Já existe um registro com o nome ${JSON.stringify(failure.name)}. Escolha outro.`,
      });
    case "MODEL_KEY_TAKEN":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Chave de Model já usada",
        detail: `O Harness já tem um Model com a chave ${JSON.stringify(failure.key)}.`,
      });
    case "HARNESS_NOT_FOUND":
      return new HttpProblem({
        status: 404,
        type: ProblemType.notFound,
        title: "Harness não encontrado",
        detail: `Não existe Harness com o id ${failure.harnessId}.`,
      });
    case "HARNESS_DISABLED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Harness desligado",
        detail:
          `O Harness ${failure.harnessId} está desligado e não aceita execuções novas. ` +
          "Ligue-o em PATCH /api/v1/harnesses/{id}.",
      });
    case "MODEL_NOT_FOUND":
      return new HttpProblem({
        status: 404,
        type: ProblemType.notFound,
        title: "Model não encontrado",
        detail: `Não existe Model com o id ${failure.modelId}.`,
      });
    case "MODEL_IN_OTHER_HARNESS":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Model de outro Harness",
        detail:
          `O Model ${failure.modelId} não pertence ao Harness ${failure.harnessId}. ` +
          "A chave de um modelo é do vocabulário do harness que a aceita.",
      });
    case "AGENT_NOT_FOUND":
      return new HttpProblem({
        status: 404,
        type: ProblemType.notFound,
        title: "Agent não encontrado",
        detail: `Não existe Agent com o id ${failure.agentId}.`,
      });
    case "EXECUTION_PROFILE_NOT_FOUND":
      return new HttpProblem({
        status: 404,
        type: ProblemType.notFound,
        title: "ExecutionProfile não encontrado",
        detail: `Não existe ExecutionProfile com o id ${failure.executionProfileId}.`,
      });
    case "EXECUTION_PROFILE_DISABLED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "ExecutionProfile desligado",
        detail:
          `O perfil ${failure.executionProfileId} está desligado e não pode ser escolhido. ` +
          "O perfil Docker só é ligado quando a execução isolada existir.",
      });
    case "IN_USE_BY_LOADOUT":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Registro em uso",
        detail:
          "Estes Loadouts ainda apontam para o registro e precisam ser ajustados antes: " +
          `${listar(failure.loadoutIds)}.`,
      });
    case "IN_USE_BY_RUN":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Loadout em uso",
        detail:
          "Estes Runs referenciam o Loadout e o histórico deles ficaria sem o fio que " +
          `liga a execução ao equipamento: ${listar(failure.runIds)}.`,
      });
  }
}

/** Traduz as recusas de escrita de Run. */
export function runFailureProblem(failure: RunWriteFailure): HttpProblem {
  switch (failure.code) {
    case "LOADOUT_NOT_FOUND":
      return new HttpProblem({
        status: 404,
        type: ProblemType.notFound,
        title: "Loadout não encontrado",
        detail: `Não existe Loadout com o id ${failure.loadoutId}.`,
      });
    case "EXECUTION_PROFILE_NOT_FOUND":
      return new HttpProblem({
        status: 404,
        type: ProblemType.notFound,
        title: "ExecutionProfile não encontrado",
        detail: `Não existe ExecutionProfile com o id ${failure.executionProfileId}.`,
      });
    case "EXECUTION_PROFILE_DISABLED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "ExecutionProfile desligado",
        detail: `O perfil ${failure.executionProfileId} está desligado e não pode ser escolhido.`,
      });
    case "HARNESS_DISABLED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Harness desligado",
        detail: `O Harness ${failure.harnessId} do Loadout está desligado.`,
      });
    case "LOADOUT_BROKEN":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Loadout incompleto",
        detail:
          `O Loadout ${failure.loadoutId} aponta para um ${failure.missing} que não existe mais. ` +
          "Edite o Loadout antes de executar.",
      });
    case "RUN_NOT_ALLOWED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Execução não permitida",
        detail: descreverRecusaDeExecucao(failure.rejection),
      });
    case "TASK_TRANSITION_REJECTED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Transição da Task não permitida",
        detail: descreverRecusaDeTransicao(failure.rejection),
      });
    case "RUN_TRANSITION_REJECTED": {
      const destinos =
        failure.rejection.allowed.length === 0
          ? "nenhum: é um estado terminal"
          : listar(failure.rejection.allowed);
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Transição do Run não permitida",
        detail:
          `Um Run em ${failure.rejection.from} não pode ir para ${failure.rejection.to}. ` +
          `A partir de ${failure.rejection.from} os estados possíveis são: ${destinos}.`,
      });
    }
    case "RUN_ALREADY_FINISHED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Run já terminou",
        detail: `O Run está em ${failure.status}, que é um estado terminal, e não há o que cancelar.`,
      });
  }
}

function descreverRecusaDeExecucao(
  rejection: Extract<RunWriteFailure, { code: "RUN_NOT_ALLOWED" }>["rejection"],
): string {
  switch (rejection.code) {
    case "TASK_NOT_RUNNABLE":
      return (
        `A Task está em ${rejection.status}. Só uma Task em ${listar(rejection.allowed)} ` +
        "aceita um Run novo: os demais estados ou já têm um Run em voo, ou são trabalho " +
        "que ninguém pediu para executar, ou já estão resolvidos."
      );
    case "TASK_WITHOUT_PROJECT":
      return (
        "A Task não pertence a nenhum Project, então não há workspace onde executar. " +
        "Promova a captura antes."
      );
    case "PROJECT_ARCHIVED":
      return `O Project ${rejection.projectId} está arquivado e não aceita execuções.`;
    case "PROJECT_WITHOUT_WORKSPACE":
      return (
        `O Project ${rejection.projectId} não tem workspace configurado, e um agente sem ` +
        "diretório de trabalho não pode nem começar. Defina `workspacePath` em " +
        "PATCH /api/v1/projects/{id}."
      );
    case "DEPENDENCIES_NOT_COMPLETED":
      return (
        "A Task depende de outras que ainda não estão COMPLETED: " +
        `${listar(rejection.blocking)}. Conclua-as ou remova a dependência.`
      );
  }
}

/** O 404 padrão de um recurso endereçado pelo caminho. */
export function notFoundProblem(recurso: string, id: string): HttpProblem {
  return new HttpProblem({
    status: 404,
    type: ProblemType.notFound,
    title: `${recurso} não encontrado`,
    detail: `Não existe ${recurso} com o id ${id}.`,
  });
}

/**
 * As rotas de dependência endereçam duas Tasks, e o repositório recusa sem
 * dizer qual das duas faltou — descobrir custaria uma consulta a mais para
 * mudar só o texto. O `detail` nomeia as duas.
 */
export function dependencyNotFoundProblem(taskId: string, dependsOnTaskId: string): HttpProblem {
  return new HttpProblem({
    status: 404,
    type: ProblemType.notFound,
    title: "Task não encontrada",
    detail: `Alguma das Tasks ${taskId} ou ${dependsOnTaskId} não existe.`,
  });
}
