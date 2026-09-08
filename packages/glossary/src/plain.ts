import type { GlossaryKey } from "./keys.js";

/**
 * Glossário `plain` — o tema Dungeon Master desligado (planejamento v0.4, seção 14).
 *
 * Mesmo conjunto de chaves de `dnd`, sem vocabulário narrativo. Rotas, URLs,
 * ícones, layout e dados são idênticos nos dois modos: o interruptor troca só
 * texto. Infraestrutura (Worker, Queue, API, Runtime) não é tematizada e por
 * isso repete o texto do outro glossário.
 */
export const plain: Record<GlossaryKey, string> = {
  // ---------------------------------------------------------------- system
  "system.name": "Dungeon Master",

  // ---------------------------------------------------------------- entity
  "entity.user": "Você",
  "entity.project": "Projeto",
  "entity.project.plural": "Projetos",
  "entity.task": "Tarefa",
  "entity.task.plural": "Tarefas",
  "entity.task.kind.bug": "Bug",
  "entity.task.kind.bug.plural": "Bugs",
  "entity.task.kind.feature": "Funcionalidade",
  "entity.task.kind.feature.plural": "Funcionalidades",
  "entity.task.kind.research": "Pesquisa",
  "entity.task.kind.research.plural": "Pesquisas",
  "entity.task.kind.chore": "Manutenção",
  "entity.task.kind.chore.plural": "Manutenções",
  "entity.subtask": "Subtarefa",
  "entity.subtask.plural": "Subtarefas",
  "entity.taskGraph": "Grafo de tarefas",
  "entity.inbox": "Caixa de entrada",
  "entity.run": "Execução",
  "entity.run.plural": "Execuções",
  "entity.agent": "Agente",
  "entity.agent.plural": "Agentes",
  "entity.agentRole": "Papel",
  "entity.agentRole.plural": "Papéis",
  "entity.harness": "Harness",
  "entity.harness.plural": "Harnesses",
  "entity.model": "Modelo",
  "entity.model.plural": "Modelos",
  "entity.loadout": "Loadout",
  "entity.loadout.plural": "Loadouts",
  "entity.executionProfile": "Perfil de execução",
  "entity.executionProfile.plural": "Perfis de execução",
  "entity.skill": "Skill",
  "entity.skill.plural": "Skills",
  "entity.tool": "Ferramenta",
  "entity.tool.plural": "Ferramentas",
  "entity.mcpServer": "Servidor MCP",
  "entity.mcpServer.plural": "Servidores MCP",
  "entity.knowledge": "Conhecimento do projeto",
  "entity.knowledgeItem": "Item de conhecimento",
  "entity.knowledgeItem.plural": "Itens de conhecimento",
  "entity.decision": "Decisão",
  "entity.decision.plural": "Decisões",
  "entity.workflow": "Workflow",
  "entity.workflow.plural": "Workflows",
  "entity.workflowStep": "Etapa do workflow",
  "entity.workflowStep.plural": "Etapas do workflow",
  "entity.approvalGate": "Aprovação",
  "entity.approvalGate.plural": "Aprovações",
  "entity.artifact": "Artefato",
  "entity.artifact.plural": "Artefatos",
  "entity.achievement": "Conquista",
  "entity.achievement.plural": "Conquistas",

  // ----------------------------------------------------------- task.status
  "task.status.inbox": "Capturada",
  "task.status.ready": "Pronta",
  "task.status.queued": "Na fila",
  "task.status.running": "Em execução",
  "task.status.waiting": "Aguardando",
  "task.status.blocked": "Bloqueada",
  "task.status.completed": "Concluída",
  "task.status.failed": "Falhou",
  "task.status.cancelled": "Cancelada",

  // ------------------------------------------------------------ task.field
  "task.field.createdAt": "Criada",

  // --------------------------------------------------------- task.priority
  "task.priority.low": "Baixa",
  "task.priority.medium": "Média",
  "task.priority.high": "Alta",
  "task.priority.urgent": "Urgente",

  // ------------------------------------------------------------ agent.role
  "agent.role.architect": "Arquiteto",
  "agent.role.engineer": "Engenheiro",
  "agent.role.reviewer": "Revisor",
  "agent.role.explorer": "Explorador",

  // ----------------------------------------------------------- achievement
  "achievement.origin.catalog": "Catálogo",
  "achievement.origin.template": "Gerada",
  "achievement.origin.forged": "Forjada",
  "achievement.rarity.common": "Comum",
  "achievement.rarity.rare": "Rara",
  "achievement.rarity.epic": "Épica",
  "achievement.rarity.legendary": "Lendária",
  "achievement.state.locked": "Bloqueada",
  "achievement.state.hidden": "Oculta",
  "achievement.state.inProgress": "Em progresso",
  "achievement.state.unlocked": "Desbloqueada",

  // ------------------------------------------------------------------- run
  "run.status.created": "Criada",
  "run.status.queued": "Na fila",
  "run.status.preparing": "Preparando",
  "run.status.running": "Em andamento",
  "run.status.waitingApproval": "Aguardando aprovação",
  "run.status.succeeded": "Concluída",
  "run.status.failed": "Falhou",
  "run.status.cancelled": "Cancelada",
  "run.status.timedOut": "Tempo esgotado",
  "run.cockpit": "Painel da execução",
  "run.timeline": "Linha do tempo",

  // ---------------------------------------------------------------- workflow
  "workflow.none": "Nenhum · execução simples",
  "workflow.captureNote":
    "A definição vigente do workflow é congelada quando a execução é criada. Editar o workflow depois não afeta esta execução.",
  "workflow.delete.title": "Apagar o workflow?",
  "workflow.delete.body":
    "O workflow some da lista, e as tarefas que o escolheram voltam à execução simples. Se alguma execução já o usou, a exclusão é recusada e nada muda.",
  "workflow.delete.inUse":
    "Este workflow já foi usado por uma execução, e o histórico dela precisa da definição. Ele não pode ser apagado.",

  // ------------------------------------------------------ workflowStep.type
  "workflowStep.type.agent": "Agente",
  "workflowStep.type.command": "Comando",
  "workflowStep.type.validation": "Validação",
  "workflowStep.type.approval": "Aprovação",
  "workflowStep.type.knowledge": "Conhecimento",

  // --------------------------------------------------------- runStep.status
  "runStep.status.pending": "Pendente",
  "runStep.status.running": "Em andamento",
  "runStep.status.waitingApproval": "Aguardando aprovação",
  "runStep.status.succeeded": "Concluída",
  "runStep.status.failed": "Falhou",
  "runStep.status.skipped": "Pulada",
  "runStep.status.timedOut": "Tempo esgotado",
  "runStep.status.cancelled": "Cancelada",

  // ----------------------------------------------------------- runStep.skip
  "runStep.skip.predicateFalse": "Condição não atendida",
  "runStep.skip.dependencyNotSucceeded": "Dependência não concluída",

  // --------------------------------------------------------------- approval
  "approval.card.title": "Pedido de aprovação",
  "approval.decision.approve": "Aprovar",
  "approval.decision.reject": "Recusar",
  "approval.status.pending": "Pendente",
  "approval.status.granted": "Concedida",
  "approval.status.rejected": "Recusada",
  "approval.confirm.approve.title": "Aprovar este pedido?",
  "approval.confirm.approve.body":
    "A execução volta à fila e o agente segue para a próxima etapa. A decisão fica registrada na linha do tempo e não pode ser desfeita.",
  "approval.confirm.reject.title": "Recusar este pedido?",
  "approval.confirm.reject.body":
    "A etapa de aprovação termina como Falhou e a execução volta à fila para o workflow decidir o que vem depois. A decisão fica registrada na linha do tempo e não pode ser desfeita.",
  "approval.conflict":
    "Outra decisão chegou antes. Nada foi sobrescrito: a aprovação está {status}.",
  "approval.pending.title": "Aprovações pendentes",
  "approval.pending.empty":
    "Nenhuma aprovação pendente. Quando um workflow parar numa etapa de aprovação, o pedido aparece aqui.",
  "approval.toast.title": "Aprovação pedida",

  // --------------------------------------------------------------- proposal
  "entity.proposedTask": "Tarefa proposta",
  "entity.proposedTask.plural": "Tarefas propostas",
  "proposal.status.proposed": "Em aberto",
  "proposal.status.approved": "Aprovada",
  "proposal.status.rejected": "Recusada",
  "proposal.decision.approve": "Aprovar",
  "proposal.decision.reject": "Recusar",
  "proposal.open.title": "Propostas em aberto",
  "proposal.open.empty":
    "Nenhuma proposta em aberto. Quando uma execução encontrar trabalho novo pelo caminho, ele aparece aqui para você decidir.",
  "proposal.origin.run": "Proposta pela execução",
  "proposal.rationale": "Motivo da proposta",
  "proposal.approve.title": "Aprovar a proposta?",
  "proposal.approve.body":
    "Uma tarefa nova nasce no projeto, pronta, com a tarefa mãe e as dependências que você escolher aqui. Nada é inferido.",
  "proposal.approve.parent": "Tarefa mãe",
  "proposal.approve.parent.origin": "Subtarefa da tarefa de origem",
  "proposal.approve.parent.none": "Sem tarefa mãe",
  "proposal.approve.dependsOn": "Precisa terminar antes",
  "proposal.approve.dependsOn.hint":
    "Tarefas do projeto que precisam terminar antes desta poder ser executada. A de origem vem marcada quando não é a mãe: a proposta nasceu nela e costuma depender do que ela deixar pronto.",
  "proposal.approve.dependsOn.parent":
    "Uma subtarefa não espera a tarefa mãe: a mãe só conclui depois das subtarefas, e a ligação travaria as duas.",
  "proposal.approve.done": "A proposta virou tarefa.",
  "proposal.reject.title": "Recusar a proposta?",
  "proposal.reject.body":
    "A proposta fica registrada como recusada, com a sua nota, e nenhuma tarefa é criada. A decisão não pode ser desfeita.",
  "proposal.conflict":
    "Outra decisão chegou antes. Nada foi sobrescrito: a proposta está {status}.",
  "proposal.toast.one": "A execução propôs uma tarefa",
  "proposal.toast.many": "A execução propôs {n} tarefas",
  "proposal.toast.body": "Decida no projeto: cada uma pode virar tarefa.",
  "proposal.toast.open": "Abrir o projeto",
  "proposal.decideIn": "Decidir no projeto",
  "proposal.knowledge.summary": "Candidatos a conhecimento",
  "proposal.knowledge.one": "{n} candidato a conhecimento",
  "proposal.knowledge.many": "{n} candidatos a conhecimento",

  // ------------------------------------------------------------------ graph
  "graph.legend.dependency": "Dependência: a da esquerda termina antes",
  "graph.legend.parent": "Tarefa mãe e subtarefa",
  "graph.empty.title": "O grafo está vazio",
  "graph.empty.body":
    "Crie a primeira tarefa e o grafo do projeto começa a ser desenhado aqui, com as dependências entre elas.",
  "graph.connect.hint":
    "Arraste da borda direita de uma tarefa até outra para dizer que a primeira termina antes. Clique numa tarefa para abri-la.",
  "graph.removeEdge.title": "Remover a dependência?",
  "graph.removeEdge.body":
    "{to} deixa de esperar por {from} e pode ser executada antes de ela terminar. Refazer a ligação depois é um arrasto.",
  "graph.cycle": "Essa dependência fecharia um ciclo no grafo: {path}. A aresta foi desfeita.",
  "graph.openProposals": "Tem propostas em aberto",

  // -------------------------------------------------------------- knowledge
  "knowledge.scribe": "Distiller",
  "knowledge.type.fact": "Fato",
  "knowledge.type.decision": "Decisão",
  "knowledge.type.discovery": "Descoberta",
  "knowledge.type.constraint": "Restrição",
  "knowledge.type.procedure": "Procedimento",
  "knowledge.type.summary": "Resumo do projeto",
  "knowledge.status.pendingReview": "Aguardando revisão",
  "knowledge.status.active": "Ativo",
  "knowledge.status.rejected": "Recusado",
  "knowledge.status.archived": "Arquivado",
  "knowledge.review.pending": "Aguardando revisão",
  "knowledge.review.reviewed": "Já revisados",
  "knowledge.review.title": "Fila de revisão",
  "knowledge.review.empty":
    "Nenhum item aguarda revisão. Quando o Distiller promover um candidato, ele aparece aqui para você decidir.",
  "knowledge.review.hint":
    "O Distiller escreveu estes itens a partir do que as execuções aprenderam. Aprove o que vale, corrija o que quase vale, recuse o resto.",
  "knowledge.decision.approve": "Aprovar o item",
  "knowledge.decision.reject": "Recusar o item",
  "knowledge.decision.editApprove": "Corrigir antes de aprovar",
  "knowledge.decision.saveApprove": "Salvar e aprovar",
  "knowledge.approve.done": "O item está ativo.",
  "knowledge.reject.title": "Recusar este item de conhecimento?",
  "knowledge.reject.body":
    "O item fica registrado como recusado, com a sua nota, e nunca fica ativo. A decisão não pode ser desfeita.",
  "knowledge.reject.done": "Item recusado.",
  "knowledge.conflict": "Outra decisão chegou antes. Nada foi sobrescrito: o item está {status}.",
  "knowledge.edit.title": "Corrigir o item",
  "knowledge.edit.body":
    "Título, conteúdo e tipo. Cada correção sobe a versão do item; o resumo do projeto não troca de tipo.",
  "knowledge.edit.done": "Item salvo.",
  "knowledge.archive.title": "Arquivar este item?",
  "knowledge.archive.body":
    "O item deixa de estar ativo e de contar para o resumo do projeto. Ele fica guardado e pode voltar depois.",
  "knowledge.archive.action": "Arquivar o item",
  "knowledge.archive.done": "Item arquivado.",
  "knowledge.unarchive.action": "Reativar o item",
  "knowledge.unarchive.done": "O item voltou a ficar ativo.",
  "knowledge.detail.open": "Abrir o item",
  "knowledge.summary.title": "Resumo do projeto",
  "knowledge.summary.empty":
    "O Distiller ainda não consolidou um resumo. Ele nasce no primeiro lote com itens ativos.",
  "knowledge.summary.stale": "{n} itens ficaram ativos depois deste resumo.",
  "knowledge.summary.fresh": "Cobre todos os itens ativos.",
  "knowledge.distill.now": "Destilar agora",
  "knowledge.distill.requested":
    "Lote pedido. {n} candidatos esperam o Distiller, que roda em segundo plano.",
  "knowledge.distill.nothing":
    "Lote pedido, mas nenhum candidato está pendente: o lote vai terminar vazio.",
  "knowledge.distill.done":
    "Lote concluído: {promoted} promovidos, {merged} fundidos, {rejected} recusados.",
  "knowledge.batches.title": "Lotes de destilação",
  "knowledge.batches.empty":
    "Nenhum lote ainda. O Distiller roda na cadência configurada, ou quando você pede.",
  "knowledge.batch.status.running": "Em execução",
  "knowledge.batch.status.succeeded": "Concluído",
  "knowledge.batch.status.failed": "Falhou",
  "knowledge.batch.trigger.timer": "Pela cadência",
  "knowledge.batch.trigger.idle": "Por ociosidade",
  "knowledge.batch.trigger.notify": "A pedido",
  "knowledge.batch.trigger.manual": "Manual",
  "knowledge.batch.counts":
    "{candidates} candidatos · {promoted} promovidos · {merged} fundidos · {rejected} recusados",
  "knowledge.batch.summaryRegenerated": "Resumo regenerado",
  "knowledge.batch.forged": "Forjou uma Conquista",
  "knowledge.candidate.status.pending": "Aguardando o Distiller",
  "knowledge.candidate.status.promoted": "Promovido",
  "knowledge.candidate.status.rejected": "Rejeitado pelo Distiller",
  "knowledge.candidate.status.merged": "Fundido num item",
  "knowledge.candidate.openItem": "Abrir o item",
  "knowledge.provenance.title": "Proveniência",
  "knowledge.provenance.run": "Execução de origem",
  "knowledge.provenance.task": "Tarefa de origem",
  "knowledge.provenance.batch": "Lote de destilação",
  "knowledge.provenance.merged": "Candidatos fundidos neste item",
  "knowledge.provenance.covered": "Itens cobertos por este resumo",
  "knowledge.provenance.none":
    "Sem execução de origem: escrito pelo Distiller a partir dos itens ativos.",
  "knowledge.decisions.empty":
    "Nenhuma decisão ainda. Quando uma execução registrar uma decisão e o Distiller a promover, ela entra nesta linha do tempo.",
  "knowledge.decisions.from": "Decidida na execução",
  "knowledge.tab.items": "Itens",
  "knowledge.tab.batches": "Lotes",
  "knowledge.list.empty":
    "Nada aqui ainda. As execuções trazem candidatos, e o Distiller os transforma em itens.",
  "knowledge.list.noMatch": "Nenhum item casa com esse filtro.",
  "knowledge.search.placeholder": "Buscar no conhecimento…",
  "knowledge.filter.type": "Tipo",
  "knowledge.filter.status": "Estado",
  "knowledge.filter.review": "Revisão",
  "knowledge.pending.title": "Itens aguardando revisão",
  "knowledge.overview.description":
    "O que cada projeto já aprendeu. O Distiller escreve os itens a partir das execuções, e você aprova o que entra.",
  "knowledge.overview.empty":
    "Nenhum projeto ainda. O conhecimento nasce com a primeira execução que traz um candidato.",
  "knowledge.overview.open": "Abrir o conhecimento",
  "knowledge.overview.noSummary": "Sem resumo ainda",
  "knowledge.overview.summaryAt": "Resumo escrito {when}",
  "knowledge.count.active": "{n} ativos",
  "knowledge.count.pending": "{n} aguardando revisão",

  // ---------------------------------------------------------------- forged
  "forged.section.title": "Conquistas forjadas em revisão",
  "forged.section.empty":
    "Nenhuma forjada em revisão. Quando o Distiller encontrar um resultado notável numa execução, a Conquista proposta aparece aqui antes de entrar na lista.",
  "forged.section.hint":
    "O Distiller escreveu estas Conquistas. Aprove as que valem, reescreva as que quase valem, descarte o resto.",
  "forged.decision.approve": "Aprovar a forjada",
  "forged.decision.rename": "Reescrever",
  "forged.decision.discard": "Descartar a forjada",
  "forged.rename.title": "Reescrever a Conquista forjada",
  "forged.rename.body":
    "Só o texto do tema muda: nome, descrição e fala. A versão sóbria descreve a condição e é escrita pelo código.",
  "forged.rename.name": "Nome no tema",
  "forged.rename.description": "Descrição no tema",
  "forged.rename.flavor": "Fala do tema",
  "forged.rename.plain": "Versão sóbria (não muda)",
  "forged.discard.title": "Descartar esta Conquista forjada?",
  "forged.discard.body":
    "Ela nunca entra na lista de Conquistas. A definição fica guardada só para contar o intervalo entre forjadas. A decisão não pode ser desfeita.",
  "forged.approve.done": "A Conquista forjada foi aprovada.",
  "forged.rename.done": "Conquista reescrita.",
  "forged.discard.done": "Conquista descartada.",
  "forged.conflict": "Outra decisão chegou antes. Nada foi sobrescrito: a Conquista está {status}.",
  "forged.status.pendingReview": "Em revisão",
  "forged.status.approved": "Aprovada",
  "forged.status.discarded": "Descartada",
  "forged.provenance": "Proposta a partir de",
  "forged.kind.nemesisDefeated": "Bug reaberto resolvido",
  "forged.kind.victoryStreak": "Sequência de execuções bem-sucedidas",
  "forged.kind.firstHarnessVictory": "Primeiro sucesso de um harness",
  "forged.kind.durationRecord": "Recorde de duração",
  "forged.toast.title": "Uma Conquista forjada espera revisão",
  "forged.toast.body": "Aprove, reescreva ou descarte antes de ela entrar na lista.",
  "forged.toast.open": "Abrir a revisão",

  // ------------------------------------------------------------------- env
  "env.host": "Host",
  "env.host.warning": "sem isolamento",
  "env.host.canonical": "HOST · UNISOLATED",
  "env.docker": "Docker",
  "env.docker.canonical": "DOCKER · ISOLATED",

  // ----------------------------------------------------------- enforcement
  "enforcement.advisory": "Pedido sem barreira",
  "enforcement.harnessNative": "Permissão nativa da CLI",
  "enforcement.sandboxEnforced": "Imposto pelo sandbox",
  "enforcement.requested": "Permissão pedida",
  "enforcement.applied": "Permissão aplicada",

  // ------------------------------------------------------ workspaceStrategy
  "workspaceStrategy.current": "Diretório do projeto",
  "workspaceStrategy.gitWorktree": "Worktree por execução",
  "workspaceStrategy.copy": "Cópia do diretório",

  // ---------------------------------------------------------- workspaceKind
  "workspaceKind.gitRepo": "Repositório git",
  "workspaceKind.folder": "Pasta comum",

  // ----------------------------------------------------- harness.capability
  "harness.capability.streaming": "Saída incremental",
  "harness.capability.structuredOutput": "Saída estruturada",
  "harness.capability.resume": "Retomar",
  "harness.capability.multiTurnProcess": "Processo de vários turnos",
  "harness.capability.toolEvents": "Eventos de ferramenta",
  "harness.capability.tokenUsage": "Uso de tokens",
  "harness.capability.modelSelection": "Escolha de modelo",
  "harness.capability.agentSelection": "Escolha de sub-agente",
  "harness.capability.nativePermissions": "Permissões próprias",
  "harness.capability.hostExecution": "Host",
  "harness.capability.dockerExecution": "Docker",

  // ------------------------------------------------------------------ hero
  "hero.xp": "Pontos",
  "hero.level": "Nível",
  "hero.toNextLevel": "Para o próximo nível",
  "hero.expeditions": "Execuções",
  "hero.victories": "Sucessos",
  "hero.defeats": "Falhas",
  "hero.monstersSlain": "Bugs resolvidos",
  "hero.tokens": "Tokens",
  "hero.topHarness": "Harness mais usado",
  "hero.byLoadout": "Por Loadout",

  // ----------------------------------------------------------------- infra
  "infra.worker": "Worker",
  "infra.queue": "Queue",
  "infra.api": "API",
  "infra.runtime": "Runtime",

  // ------------------------------------------------------------------- nav
  "nav.dashboard": "Painel",
  "nav.inbox": "Caixa de entrada",
  "nav.projects": "Projetos",
  "nav.tasks": "Tarefas",
  "nav.runs": "Execuções",
  "nav.knowledge": "Conhecimento",
  "nav.agents": "Agentes",
  "nav.loadouts": "Loadouts",
  "nav.workflows": "Workflows",
  "nav.hall": "Conquistas",
  "nav.settings": "Configurações",

  // ------------------------------------------------------------------ hall
  "hall.tab.achievements": "Conquistas",
  "hall.tab.heroes": "Agentes",
  "hall.tab.bestiary": "Bugs resolvidos",
  "hall.tab.chronicle": "Histórico",
  "hall.filter.origin": "Origem",
  "hall.filter.rarity": "Raridade",
  "hall.filter.state": "Estado",
  "hall.counter": "{unlocked} de {total} desbloqueadas",
  "hall.unseen": "Ainda não visto",
  "hall.progressOf": "{current} de {target}",
  "hall.tierOf": "Tier {label}",
  "hall.bestiary.defeatedAt": "Concluído em",
  "hall.bestiary.slayer": "Execução que resolveu",
  "hall.bestiary.nemesis": "Reincidente",
  "hall.chronicle.loadMore": "Carregar mais",

  // --------------------------------------------------------------- loadout
  "loadout.noNativePermissions.title": "Este harness não impõe permissão por comando",
  "loadout.noNativePermissions.body":
    "A CLI deste {harness} não consulta a lista de comandos do {profile}: a permissão é só pedida, nunca aplicada, e o enforcement da execução sai como ADVISORY.",
  "loadout.noNativePermissions.antigravity":
    "No Antigravity é o oposto: sem interface, a CLI não consulta lista nenhuma e nega todo comando. Em {host} ({hostWarning}), uma {run} que precise executar comandos termina em PERMISSION_DENIED; só `allowUnsafeBypass` no {profile} libera — e libera tudo.",

  // -------------------------------------------------------------- settings
  "settings.theme.toggle": "Tema Dungeon Master",
  "settings.theme.description":
    "Vocabulário de RPG na interface. Ligue para o tema de Dungeon Master.",
  "settings.knowledge.title": "Conhecimento",
  "settings.knowledge.description":
    "Como o Distiller consolida o conhecimento de cada projeto, e quando.",
  "settings.knowledge.humanReview": "Revisão humana",
  "settings.knowledge.humanReview.description":
    "Ligado, todo item que o Distiller promover espera a sua aprovação antes de ficar ativo. Desligado, ele fica ativo direto.",
  "settings.knowledge.loadout": "Loadout do Distiller",
  "settings.knowledge.loadout.description":
    "O Distiller não executa nada: lê o prompt e responde JSON. Por isso o Loadout precisa de um harness com saída estruturada.",
  "settings.knowledge.loadout.default": "O padrão: {name}",
  "settings.knowledge.loadout.noStructuredOutput": "sem saída estruturada",
  "settings.knowledge.every": "Cadência do Distiller",
  "settings.knowledge.every.description":
    "A cada quantos minutos o Distiller varre os candidatos pendentes de todos os projetos. Entre 1 e 1440.",
  "settings.knowledge.forgeEvery": "Intervalo entre forjadas",
  "settings.knowledge.forgeEvery.description":
    "Quantas execuções precisam terminar entre duas Conquistas forjadas, para elas continuarem raras. Entre 1 e 10000.",
  "settings.knowledge.saved": "Configuração de conhecimento salva.",
};
