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
  "entity.taskGraph": "Mapa da masmorra",
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
  "achievement.state.in_progress": "Em progresso",
  "achievement.state.unlocked": "Desbloqueada",

  // ------------------------------------------------------------------- run
  "run.status.succeeded": "Vitória",
  "run.status.failed": "Derrota",
  "run.status.cancelled": "Retirada",
  "run.status.timedOut": "Exaustão",
  "run.cockpit": "Cristal de Visão",
  "run.timeline": "Diário da Expedição",

  // ------------------------------------------------------------------- env
  "env.host": "Campo aberto",
  "env.host.warning": "sem isolamento",
  "env.host.canonical": "HOST · UNISOLATED",
  "env.docker": "Masmorra selada",
  "env.docker.canonical": "DOCKER · ISOLATED",

  // ------------------------------------------------------------------ hero
  "hero.xp": "Experiência",
  "hero.level": "Nível",

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

  // -------------------------------------------------------------- settings
  "settings.theme.toggle": "Tema Dungeon Master",
  "settings.theme.description": "Vocabulário de RPG na interface. Desligue para nomes neutros.",
};
