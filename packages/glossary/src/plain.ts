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

  // -------------------------------------------------------------- settings
  "settings.theme.toggle": "Tema Dungeon Master",
  "settings.theme.description":
    "Vocabulário de RPG na interface. Ligue para o tema de Dungeon Master.",
};
