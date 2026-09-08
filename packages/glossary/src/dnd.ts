import type { GlossaryKey } from "./keys.js";

/**
 * Glossário `dnd` — o tema Dungeon Master ligado (planejamento v0.4, seção 14).
 *
 * Regra de segurança da seção 14: "Campo aberto" nunca aparece sozinho.
 * `env.host.warning` acompanha sempre, e `env.host.canonical` mantém o texto
 * canônico do badge ao lado, idêntico nos dois glossários.
 */
export const dnd: Record<GlossaryKey, string> = {
  // ---------------------------------------------------------------- system
  "system.name": "Dungeon Master",

  // ---------------------------------------------------------------- entity
  "entity.user": "Mestre da Guilda",
  "entity.project": "Campanha",
  "entity.project.plural": "Campanhas",
  "entity.task": "Missão",
  "entity.task.plural": "Missões",
  "entity.task.kind.bug": "Monstro",
  "entity.task.kind.bug.plural": "Monstros",
  "entity.task.kind.feature": "Missão",
  "entity.task.kind.feature.plural": "Missões",
  "entity.task.kind.research": "Exploração",
  "entity.task.kind.research.plural": "Explorações",
  "entity.task.kind.chore": "Manutenção",
  "entity.task.kind.chore.plural": "Manutenções",
  "entity.subtask": "Etapa da missão",
  "entity.subtask.plural": "Etapas da missão",
  "entity.taskGraph": "Mapa da Campanha",
  "entity.inbox": "Quadro de Missões",
  "entity.run": "Expedição",
  "entity.run.plural": "Expedições",
  "entity.agent": "Herói",
  "entity.agent.plural": "Heróis",
  "entity.agentRole": "Classe",
  "entity.agentRole.plural": "Classes",
  "entity.harness": "Guilda",
  "entity.harness.plural": "Guildas",
  "entity.model": "Patrono",
  "entity.model.plural": "Patronos",
  "entity.loadout": "Equipamento",
  "entity.loadout.plural": "Equipamentos",
  "entity.executionProfile": "Perfil de execução",
  "entity.executionProfile.plural": "Perfis de execução",
  "entity.skill": "Habilidade",
  "entity.skill.plural": "Habilidades",
  "entity.tool": "Item",
  "entity.tool.plural": "Itens",
  "entity.mcpServer": "Relíquia",
  "entity.mcpServer.plural": "Relíquias",
  "entity.knowledge": "Grimório da Campanha",
  "entity.knowledgeItem": "Página do Grimório",
  "entity.knowledgeItem.plural": "Páginas do Grimório",
  "entity.decision": "Decreto",
  "entity.decision.plural": "Decretos",
  "entity.workflow": "Ritual",
  "entity.workflow.plural": "Rituais",
  "entity.workflowStep": "Passo do ritual",
  "entity.workflowStep.plural": "Passos do ritual",
  "entity.approvalGate": "Selo da Guilda",
  "entity.approvalGate.plural": "Selos da Guilda",
  "entity.artifact": "Espólio",
  "entity.artifact.plural": "Espólios",
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
  "achievement.origin.catalog": "Do catálogo",
  "achievement.origin.template": "Da sua jornada",
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
  "run.status.waitingApproval": "Aguardando o Selo",
  "run.status.succeeded": "Vitória",
  "run.status.failed": "Derrota",
  "run.status.cancelled": "Retirada",
  "run.status.timedOut": "Exaustão",
  "run.cockpit": "Cristal de Visão",
  "run.timeline": "Diário da Expedição",

  // ---------------------------------------------------------------- workflow
  "workflow.none": "Nenhum · Expedição simples",
  "workflow.captureNote":
    "A definição vigente do Ritual é congelada quando a Expedição parte. Editar o Ritual depois não muda esta Expedição.",
  "workflow.delete.title": "Apagar o Ritual?",
  "workflow.delete.body":
    "O Ritual some da lista, e as Missões que o escolheram voltam à Expedição simples. Se alguma Expedição já partiu com ele, a exclusão é recusada e nada muda.",
  "workflow.delete.inUse":
    "Este Ritual já foi usado por uma Expedição, e o histórico dela precisa da definição. Ele não pode ser apagado.",

  // ------------------------------------------------------ workflowStep.type
  "workflowStep.type.agent": "Herói",
  "workflowStep.type.command": "Comando",
  "workflowStep.type.validation": "Validação",
  "workflowStep.type.approval": "Selo da Guilda",
  "workflowStep.type.knowledge": "Grimório",

  // --------------------------------------------------------- runStep.status
  "runStep.status.pending": "Pendente",
  "runStep.status.running": "Em andamento",
  "runStep.status.waitingApproval": "Aguardando o Selo",
  "runStep.status.succeeded": "Cumprido",
  "runStep.status.failed": "Falhou",
  "runStep.status.skipped": "Pulado",
  "runStep.status.timedOut": "Exausto",
  "runStep.status.cancelled": "Cancelado",

  // ----------------------------------------------------------- runStep.skip
  "runStep.skip.predicateFalse": "Condição não atendida",
  "runStep.skip.dependencyNotSucceeded": "Dependência não concluída",

  // --------------------------------------------------------------- approval
  "approval.card.title": "Carta do Selo",
  "approval.decision.approve": "Conceder o Selo",
  "approval.decision.reject": "Negar o Selo",
  "approval.status.pending": "Pendente",
  "approval.status.granted": "Concedido",
  "approval.status.rejected": "Negado",
  "approval.confirm.approve.title": "Conceder o Selo da Guilda?",
  "approval.confirm.approve.body":
    "A Expedição sai da espera e volta à fila, e o Herói segue para o passo seguinte. A decisão fica gravada no Diário da Expedição e não pode ser desfeita.",
  "approval.confirm.reject.title": "Negar o Selo da Guilda?",
  "approval.confirm.reject.body":
    "O passo de aprovação termina como Falhou e a Expedição volta à fila para o Ritual decidir o que vem depois. A decisão fica gravada no Diário da Expedição e não pode ser desfeita.",
  "approval.conflict": "Outra mão selou antes da sua. Nada foi sobrescrito: o Selo está {status}.",
  "approval.pending.title": "Selos pendentes",
  "approval.pending.empty":
    "Nenhum Selo pendente. Quando um Ritual parar num passo de aprovação, o pedido aparece aqui.",
  "approval.toast.title": "A Guilda pede o Selo",

  // --------------------------------------------------------------- proposal
  "entity.proposedTask": "Pista",
  "entity.proposedTask.plural": "Pistas",
  "proposal.status.proposed": "Em aberto",
  "proposal.status.approved": "Seguida",
  "proposal.status.rejected": "Descartada",
  "proposal.decision.approve": "Seguir a Pista",
  "proposal.decision.reject": "Descartar a Pista",
  "proposal.open.title": "Pistas em aberto",
  "proposal.open.empty":
    "Nenhuma Pista em aberto. Quando uma Expedição encontrar trabalho novo pelo caminho, ele aparece aqui para você decidir.",
  "proposal.origin.run": "Encontrada na Expedição",
  "proposal.rationale": "Por que seguir",
  "proposal.approve.title": "Seguir a Pista?",
  "proposal.approve.body":
    "Uma Missão nova nasce na Campanha, pronta, com a mãe e as dependências que você escolher aqui. Nada é inferido.",
  "proposal.approve.parent": "Missão mãe",
  "proposal.approve.parent.origin": "Filha da Missão de origem",
  "proposal.approve.parent.none": "Sem mãe",
  "proposal.approve.dependsOn": "Precisa terminar antes",
  "proposal.approve.dependsOn.hint":
    "Missões da Campanha que precisam terminar antes desta poder partir. A de origem vem marcada quando não é a mãe: a Pista foi encontrada nela e costuma depender do que ela deixar pronto.",
  "proposal.approve.dependsOn.parent":
    "Uma filha não espera a mãe: a mãe só conclui depois das filhas, e a ligação travaria as duas.",
  "proposal.approve.done": "A Pista virou Missão.",
  "proposal.reject.title": "Descartar a Pista?",
  "proposal.reject.body":
    "A Pista fica registrada como descartada, com a sua nota, e nenhuma Missão é criada. A decisão não pode ser desfeita.",
  "proposal.conflict":
    "Outra mão decidiu antes da sua. Nada foi sobrescrito: a Pista está {status}.",
  "proposal.toast.one": "A Expedição trouxe uma Pista",
  "proposal.toast.many": "A Expedição trouxe {n} Pistas",
  "proposal.toast.body": "Decida na Campanha: cada uma pode virar Missão.",
  "proposal.toast.open": "Abrir a Campanha",
  "proposal.decideIn": "Decidir na Campanha",
  "proposal.knowledge.summary": "Candidatos ao Grimório",
  "proposal.knowledge.one": "{n} candidato ao Grimório",
  "proposal.knowledge.many": "{n} candidatos ao Grimório",

  // ------------------------------------------------------------------ graph
  "graph.legend.dependency": "Dependência: a da esquerda termina antes",
  "graph.legend.parent": "Mãe e filha",
  "graph.empty.title": "O Mapa está em branco",
  "graph.empty.body":
    "Crie a primeira Missão e a Campanha começa a ser desenhada aqui, com as dependências entre elas.",
  "graph.connect.hint":
    "Arraste da borda direita de uma Missão até outra para dizer que a primeira termina antes. Clique numa Missão para abri-la.",
  "graph.removeEdge.title": "Desfazer a ligação?",
  "graph.removeEdge.body":
    "{to} deixa de esperar por {from} e pode partir antes de ela terminar. Refazer a ligação depois é um arrasto.",
  "graph.cycle": "Essa ligação fecharia um ciclo no Mapa: {path}. A aresta foi desfeita.",
  "graph.openProposals": "Tem Pistas em aberto",

  // ------------------------------------------------------------------- env
  "env.host": "Campo aberto",
  "env.host.warning": "sem isolamento",
  "env.host.canonical": "HOST · UNISOLATED",
  "env.docker": "Masmorra selada",
  "env.docker.canonical": "DOCKER · ISOLATED",

  // ----------------------------------------------------------- enforcement
  "enforcement.advisory": "Pedido sem barreira",
  "enforcement.harnessNative": "Permissão nativa da CLI",
  "enforcement.sandboxEnforced": "Imposto pelo sandbox",
  "enforcement.requested": "Permissão pedida",
  "enforcement.applied": "Permissão aplicada",

  // ------------------------------------------------------ workspaceStrategy
  "workspaceStrategy.current": "Diretório do projeto",
  "workspaceStrategy.gitWorktree": "Worktree por Expedição",
  "workspaceStrategy.copy": "Cópia do diretório",

  // ---------------------------------------------------------- workspaceKind
  "workspaceKind.gitRepo": "Repositório git",
  "workspaceKind.folder": "Pasta comum",

  // ----------------------------------------------------- harness.capability
  "harness.capability.streaming": "Saída incremental",
  "harness.capability.structuredOutput": "Saída estruturada",
  "harness.capability.resume": "Retomar",
  "harness.capability.multiTurnProcess": "Processo de vários turnos",
  "harness.capability.toolEvents": "Eventos de Item",
  "harness.capability.tokenUsage": "Uso de tokens",
  "harness.capability.modelSelection": "Escolha de Patrono",
  "harness.capability.agentSelection": "Escolha de sub-Herói",
  "harness.capability.nativePermissions": "Permissões próprias",
  "harness.capability.hostExecution": "Campo aberto",
  "harness.capability.dockerExecution": "Masmorra selada",

  // ------------------------------------------------------------------ hero
  "hero.xp": "Experiência",
  "hero.level": "Nível",
  "hero.toNextLevel": "Para o próximo nível",
  "hero.expeditions": "Expedições",
  "hero.victories": "Vitórias",
  "hero.defeats": "Derrotas",
  "hero.monstersSlain": "Monstros derrotados",
  "hero.tokens": "Tokens",
  "hero.topHarness": "Guilda mais usada",
  "hero.byLoadout": "Por Equipamento",

  // ----------------------------------------------------------------- infra
  "infra.worker": "Worker",
  "infra.queue": "Queue",
  "infra.api": "API",
  "infra.runtime": "Runtime",

  // ------------------------------------------------------------------- nav
  "nav.dashboard": "Mesa do Mestre",
  "nav.inbox": "Quadro de Missões",
  "nav.projects": "Campanhas",
  "nav.tasks": "Missões",
  "nav.runs": "Expedições",
  "nav.knowledge": "Grimório",
  "nav.agents": "Heróis",
  "nav.loadouts": "Equipamentos",
  "nav.workflows": "Rituais",
  "nav.hall": "Hall dos Heróis",
  "nav.settings": "Configurações",

  // ------------------------------------------------------------------ hall
  "hall.tab.achievements": "Conquistas",
  "hall.tab.heroes": "Heróis",
  "hall.tab.bestiary": "Bestiário",
  "hall.tab.chronicle": "Crônica",
  "hall.filter.origin": "Origem",
  "hall.filter.rarity": "Raridade",
  "hall.filter.state": "Estado",
  "hall.counter": "{unlocked} de {total} desbloqueadas",
  "hall.unseen": "Ainda não vista",
  "hall.progressOf": "{current} de {target}",
  "hall.tierOf": "Grau {label}",
  "hall.bestiary.defeatedAt": "Derrotado em",
  "hall.bestiary.slayer": "Quem derrotou",
  "hall.bestiary.nemesis": "Nêmesis",
  "hall.chronicle.loadMore": "Carregar mais",

  // --------------------------------------------------------------- loadout
  "loadout.noNativePermissions.title": "Esta Guilda não impõe permissão por comando",
  "loadout.noNativePermissions.body":
    "A CLI desta {harness} não consulta a lista de comandos do {profile}: a permissão é só pedida, nunca aplicada, e o enforcement da Expedição sai como ADVISORY.",
  "loadout.noNativePermissions.antigravity":
    "No Antigravity é o oposto: sem interface, a CLI não consulta lista nenhuma e nega todo comando. Em {host} ({hostWarning}), uma {run} que precise executar comandos termina em PERMISSION_DENIED; só `allowUnsafeBypass` no {profile} libera — e libera tudo.",

  // -------------------------------------------------------------- settings
  "settings.theme.toggle": "Tema Dungeon Master",
  "settings.theme.description": "Vocabulário de RPG na interface. Desligue para nomes neutros.",
};
