import type {
  ApprovalGateWriteFailure,
  DependencyWriteFailure,
  ForgedAchievementWriteFailure,
  InboxFailure,
  KnowledgeItemWriteFailure,
  ProposedTaskWriteFailure,
  RegistryWriteFailure,
  RunStepWriteFailure,
  RunWriteFailure,
  TaskWriteFailure,
  WorkflowWriteFailure,
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
    case "WORKFLOW_NOT_FOUND":
      return workflowNotFoundProblem(failure.workflowId);
    case "TRANSITION_REJECTED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Transição não permitida",
        detail: descreverRecusaDeTransicao(failure.rejection),
      });
  }
}

function workflowNotFoundProblem(workflowId: string): HttpProblem {
  return new HttpProblem({
    status: 404,
    type: ProblemType.notFound,
    title: "Workflow não encontrado",
    detail: `Não existe Workflow com o id ${workflowId}.`,
  });
}

/**
 * Traduz as recusas de escrita de dependência.
 *
 * `DEPENDENCY_CYCLE` leva o caminho do impasse também em `path`, um membro de
 * extensão do problem details: a tela do grafo destaca as arestas do ciclo em
 * vez de reler o `detail`. Uma Task de outro Project é `404`, e não `409`: o
 * grafo é do Project, e ela não existe nele.
 */
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
        extensions: { path: [...failure.path] },
      });
    case "DEPENDENCY_NOT_FOUND":
      return dependencyNotInProjectProblem(failure.taskId, "não existe");
    case "DEPENDENCY_IN_OTHER_PROJECT":
      return dependencyNotInProjectProblem(failure.taskId, "pertence a outro Project");
    case "DEPENDENCY_IN_INBOX":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Dependência na Inbox",
        detail:
          `A Task ${failure.taskId} está em INBOX e não participa do grafo de dependências. ` +
          "Promova-a antes.",
      });
  }
}

function dependencyNotInProjectProblem(taskId: string, motivo: string): HttpProblem {
  return new HttpProblem({
    status: 404,
    type: ProblemType.notFound,
    title: "Dependência não encontrada no Project",
    detail:
      `A Task ${taskId} ${motivo}. Uma dependência precisa ser uma Task do mesmo Project: ` +
      "o grafo é do Project.",
  });
}

/**
 * Traduz as recusas de decisão sobre uma proposta.
 *
 * `PROPOSAL_ALREADY_DECIDED` é o CAS perdido: o `409` leva a proposta como
 * ficou em `proposedTask`, para a interface mostrar o que já foi decidido em
 * vez de tentar de novo. As recusas de mãe e de dependência seguem as mesmas
 * regras — e os mesmos textos — de `POST /tasks` e de `PUT /tasks/{id}/dependencies`.
 */
export function proposedTaskFailureProblem(failure: ProposedTaskWriteFailure): HttpProblem {
  switch (failure.code) {
    case "PROPOSAL_ALREADY_DECIDED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Proposta já decidida",
        detail:
          `A proposta já está em ${failure.proposedTask.status}` +
          (failure.proposedTask.decidedAt === null
            ? "."
            : `, decidida em ${failure.proposedTask.decidedAt}.`) +
          " Outra decisão chegou antes; nada foi sobrescrito.",
        extensions: { proposedTask: failure.proposedTask },
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
    case "WORKFLOW_NOT_FOUND":
      return workflowNotFoundProblem(failure.workflowId);
    case "SELF_DEPENDENCY":
    case "DEPENDENCY_CYCLE":
    case "DEPENDENCY_NOT_FOUND":
    case "DEPENDENCY_IN_OTHER_PROJECT":
    case "DEPENDENCY_IN_INBOX":
      return dependencyFailureProblem(failure);
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
    case "WORKFLOW_NOT_FOUND":
      return new HttpProblem({
        status: 404,
        type: ProblemType.notFound,
        title: "Workflow não encontrado",
        detail: `Não existe Workflow com o id ${failure.workflowId}.`,
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
    case "SKILL_NOT_FOUND":
      return new HttpProblem({
        status: 404,
        type: ProblemType.notFound,
        title: "Skill não encontrada",
        detail: `Não existe Skill com o id ${failure.skillId}.`,
      });
    case "SKILL_VERSION_NOT_FOUND":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Versão da Skill não existe",
        detail:
          `A Skill ${failure.skillId} não tem a versão ${String(failure.version)}: a mais ` +
          `recente é a ${String(failure.latestVersion)}. Pine uma versão que exista, ou nenhuma.`,
      });
    case "SKILL_VERSION_CONFLICT":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Outra versão chegou antes",
        detail:
          `Você publicou a partir da versão ${String(failure.expectedLatestVersion)}, mas a ` +
          `mais recente já é a ${String(failure.latestVersion)}. Releia e publique de novo; ` +
          "nada foi sobrescrito.",
        extensions: { latestVersion: failure.latestVersion },
      });
    case "TOOL_NOT_FOUND":
      return new HttpProblem({
        status: 404,
        type: ProblemType.notFound,
        title: "Tool não encontrada",
        detail: `Não existe Tool com o id ${failure.toolId}.`,
      });
    case "TOOL_SHAPE_INVALID":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Campo de outra espécie de Tool",
        detail:
          `O campo \`${failure.field}\` não pertence a uma Tool \`${failure.kind}\`. ` +
          "A espécie não muda: apague e crie de novo para trocá-la.",
      });
    case "MCP_SERVER_NOT_FOUND":
      return new HttpProblem({
        status: 404,
        type: ProblemType.notFound,
        title: "Servidor MCP não encontrado",
        detail: `Não existe servidor MCP com o id ${failure.mcpServerId}.`,
      });
    case "MCP_SERVER_SHAPE_INVALID":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Campo de outro transporte",
        detail:
          `O campo \`${failure.field}\` não pertence a um servidor \`${failure.transport}\`. ` +
          "O transporte não muda: apague e crie de novo para trocá-lo.",
      });
    case "MCP_SERVER_DEFINITION_MISMATCH":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Servidor MCP já existe com outra definição",
        detail:
          `O servidor \`${failure.name}\` já está no registro (${failure.mcpServerId}) com outro ` +
          "comando ou URL. Referencie-o por id em `mcpServerIds`, ou edite-o em " +
          "PATCH /api/v1/mcp-servers/{id}.",
        extensions: { mcpServerId: failure.mcpServerId },
      });
    case "BUILT_IN_PROTECTED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Servidor MCP do sistema",
        detail:
          `O servidor \`${failure.name}\` nasce com o sistema e é o Worker quem sabe subi-lo: ` +
          "não se apaga nem se redefine. Só a descrição é editável.",
      });
    case "PROVIDER_NOT_FOUND":
      return new HttpProblem({
        status: 404,
        type: ProblemType.notFound,
        title: "Provider não encontrado",
        detail: `Não existe Provider com o id ${failure.providerId}.`,
      });
    case "IN_USE_BY_MODEL":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Provider em uso",
        detail: `Estes Models ainda apontam para o Provider: ${listar(failure.modelIds)}.`,
      });
    case "IN_USE_BY_TOOL":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Servidor MCP em uso",
        detail: `Estas Tools ainda apontam para o servidor: ${listar(failure.toolIds)}.`,
      });
    case "REFERENCE_FORMS_MIXED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Duas formas de referência",
        detail:
          `A coleção \`${failure.collection}\` veio na forma por id e na forma curta ao mesmo ` +
          "tempo. Use uma só.",
      });
    case "LOADOUT_VERSION_NOT_FOUND":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Versão do Loadout não existe",
        detail: `O Loadout ${failure.loadoutId} não tem a versão ${String(failure.version)}.`,
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
    case "LOADOUT_REQUIRED":
      return new HttpProblem({
        status: 400,
        type: ProblemType.validation,
        title: "Falta o Loadout",
        detail:
          "Informe `loadoutId`, ou `resumeFromRunId` para herdar o equipamento do Run de origem.",
      });
    case "RESUME_SOURCE_NOT_FOUND":
      return new HttpProblem({
        status: 404,
        type: ProblemType.notFound,
        title: "Run de origem não encontrado",
        detail: `Não existe Run com o id ${failure.runId} para retomar.`,
      });
    case "RESUME_SOURCE_WITHOUT_SESSION":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Run de origem sem sessão",
        detail:
          `O Run ${failure.runId} não capturou um id de sessão do harness, então não há ` +
          "conversa a retomar. Comece um Run novo.",
      });
    case "RESUME_UNSUPPORTED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Harness não retoma sessão",
        detail: `O Harness ${failure.harnessKey} não declara a capability \`resume\`.`,
      });
    case "WORKFLOW_NOT_FOUND":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Workflow da Task não existe",
        detail:
          `A Task aponta para o Workflow ${failure.workflowId}, que não existe mais. ` +
          "Troque ou remova o Workflow em PATCH /api/v1/tasks/{id} antes de executar.",
      });
    case "CAPABILITY_BLOCKED":
      // A lista inteira vai em `blockers`, membro de extensão do problem
      // details: a tela mostra cada um pelo código e pela mensagem canônica do
      // domínio, sem reler o `detail`.
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "O Harness não sustenta o que o Loadout pede",
        detail: failure.blockers.map((issue) => issue.message).join(" "),
        extensions: { blockers: [...failure.blockers] },
      });
  }
}

/** Traduz as recusas de escrita de Workflow. */
export function workflowFailureProblem(failure: WorkflowWriteFailure): HttpProblem {
  switch (failure.code) {
    case "NAME_TAKEN":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Nome já usado",
        detail: `Já existe um Workflow com o nome ${JSON.stringify(failure.name)}. Escolha outro.`,
      });
    case "IN_USE_BY_RUN":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Workflow em uso",
        detail:
          "Estes Runs referenciam uma versão do Workflow e o histórico deles ficaria sem a " +
          `definição que explica os steps: ${listar(failure.runIds)}.`,
      });
  }
}

function descreverRecusaDeRunStep(failure: RunStepWriteFailure): string {
  switch (failure.code) {
    case "RUN_STEP_TRANSITION_REJECTED": {
      const destinos =
        failure.rejection.allowed.length === 0
          ? "nenhum: é um estado terminal"
          : listar(failure.rejection.allowed);
      return (
        `O RunStep está em ${failure.rejection.from} e não pode ir para ${failure.rejection.to}. ` +
        `A partir de ${failure.rejection.from} os estados possíveis são: ${destinos}.`
      );
    }
    case "RUN_STEP_STATUS_CHANGED":
      return (
        `O RunStep "${failure.current.key}" já não está em ${failure.expected}: ` +
        `está em ${failure.current.status}.`
      );
  }
}

/**
 * Traduz as recusas do gate de aprovação.
 *
 * `GATE_ALREADY_RESOLVED` é o CAS perdido (documento técnico, seção 26): o
 * `409` leva o estado atual do gate em `gate`, um membro de extensão do
 * problem details, para a interface mostrar o que já foi decidido em vez de
 * tentar de novo.
 */
export function approvalGateFailureProblem(failure: ApprovalGateWriteFailure): HttpProblem {
  switch (failure.code) {
    case "GATE_ALREADY_RESOLVED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Gate já decidido",
        detail:
          `O gate "${failure.gate.gateKey}" já está em ${failure.gate.status}` +
          (failure.gate.resolvedAt === null ? "." : `, decidido em ${failure.gate.resolvedAt}.`) +
          " Outra decisão chegou antes; nada foi sobrescrito.",
        extensions: { gate: failure.gate },
      });
    case "RUN_NOT_WAITING_APPROVAL":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Run não está esperando aprovação",
        detail:
          `O Run ${failure.runId} está em ${failure.status}, e só um Run em WAITING_APPROVAL ` +
          "aceita a decisão de um gate.",
      });
    case "RUN_STEP_NOT_FOUND":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Step do gate não encontrado",
        detail: `O Run ${failure.runId} não tem um RunStep com a chave "${failure.stepKey}".`,
      });
    case "RUN_STEP_WRITE_REJECTED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "RunStep recusou a decisão",
        detail: descreverRecusaDeRunStep(failure.failure),
      });
    case "RUN_WRITE_REJECTED":
      return runFailureProblem(failure.failure);
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

/**
 * Traduz as recusas da revisão e da edição de um item do Grimório.
 *
 * `KNOWLEDGE_ITEM_ALREADY_REVIEWED` é o CAS perdido: o `409` leva o item como
 * ficou em `item`, para a interface mostrar o que já foi decidido em vez de
 * tentar de novo.
 */
export function knowledgeItemFailureProblem(failure: KnowledgeItemWriteFailure): HttpProblem {
  switch (failure.code) {
    case "KNOWLEDGE_ITEM_ALREADY_REVIEWED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Item já revisado",
        detail:
          `O item já está em ${failure.item.status}` +
          (failure.item.reviewedAt === null ? "." : `, revisado em ${failure.item.reviewedAt}.`) +
          " Outra decisão chegou antes; nada foi sobrescrito.",
        extensions: { item: failure.item },
      });
    case "KNOWLEDGE_ITEM_ARCHIVE_NOT_ALLOWED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Arquivamento não permitido",
        detail:
          `O item está em ${failure.status}. Arquivar exige ACTIVE e desarquivar exige ARCHIVED; ` +
          "um item em revisão é aprovado ou recusado, não arquivado.",
      });
    case "KNOWLEDGE_SUMMARY_TYPE_LOCKED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "O resumo não troca de tipo",
        detail:
          "O SUMMARY é o resumo corrente do Project e é regenerado pelo Distiller; edite o " +
          "texto, mas o tipo fica.",
      });
  }
}

/**
 * Traduz as recusas da revisão de uma Conquista forjada.
 *
 * `FORGED_ALREADY_REVIEWED` é o CAS perdido, com a forjada atual em
 * `achievement`. `NOT_FORGED` é `409`, e não `404`: a definição existe, só não
 * é do tipo que estas rotas revisam.
 */
export function forgedAchievementFailureProblem(
  failure: ForgedAchievementWriteFailure,
): HttpProblem {
  switch (failure.code) {
    case "FORGED_ALREADY_REVIEWED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Conquista forjada já revisada",
        detail:
          `A forjada já está em ${failure.achievement.reviewStatus}` +
          (failure.achievement.reviewedAt === null
            ? "."
            : `, revisada em ${failure.achievement.reviewedAt}.`) +
          " Outra decisão chegou antes; nada foi sobrescrito.",
        extensions: { achievement: failure.achievement },
      });
    case "FORGED_DISCARDED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Conquista forjada descartada",
        detail: "Uma forjada descartada não é renomeada.",
        extensions: { achievement: failure.achievement },
      });
    case "NOT_FORGED":
      return new HttpProblem({
        status: 409,
        type: ProblemType.conflict,
        title: "Conquista não é forjada",
        detail: `A definição tem origem ${failure.origin}; só uma forjada passa por revisão.`,
      });
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
