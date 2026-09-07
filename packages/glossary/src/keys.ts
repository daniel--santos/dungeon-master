/**
 * Chaves canônicas do glossário.
 *
 * Uma chave por linha da tabela do planejamento v0.4, seção 14, mais os labels
 * de navegação da seção 8, os estados e as prioridades de Task da Fase 1 e as
 * abas do Hall (Fase 2.5D). As chaves são sempre em inglês e estáveis: o texto
 * muda, a chave não.
 *
 * A união `GlossaryKey` nasce desta lista, então acrescentar uma chave aqui
 * quebra a compilação dos dois glossários até que ambos a preencham. É essa a
 * paridade em tempo de tipo exigida pela seção 14.
 */

export const GLOSSARY_KEYS = [
  // ---------------------------------------------------------------- system
  "system.name",

  // ---------------------------------------------------------------- entity
  "entity.user",
  "entity.project",
  "entity.project.plural",
  "entity.task",
  "entity.task.plural",
  "entity.task.kind.bug",
  "entity.task.kind.bug.plural",
  "entity.task.kind.feature",
  "entity.task.kind.feature.plural",
  "entity.task.kind.research",
  "entity.task.kind.research.plural",
  "entity.task.kind.chore",
  "entity.task.kind.chore.plural",
  "entity.subtask",
  "entity.subtask.plural",
  "entity.taskGraph",
  "entity.inbox",
  "entity.run",
  "entity.run.plural",
  "entity.agent",
  "entity.agent.plural",
  "entity.agentRole",
  "entity.agentRole.plural",
  "entity.harness",
  "entity.harness.plural",
  "entity.model",
  "entity.model.plural",
  "entity.loadout",
  "entity.loadout.plural",
  "entity.executionProfile",
  "entity.executionProfile.plural",
  "entity.skill",
  "entity.skill.plural",
  "entity.tool",
  "entity.tool.plural",
  "entity.mcpServer",
  "entity.mcpServer.plural",
  "entity.knowledge",
  "entity.knowledgeItem",
  "entity.knowledgeItem.plural",
  "entity.decision",
  "entity.decision.plural",
  "entity.workflow",
  "entity.workflow.plural",
  "entity.workflowStep",
  "entity.workflowStep.plural",
  "entity.approvalGate",
  "entity.approvalGate.plural",
  "entity.artifact",
  "entity.artifact.plural",
  "entity.achievement",
  "entity.achievement.plural",

  // ----------------------------------------------------------- task.status
  // Os nove estados de Task da Fase 1. Não são tematizados: o texto é o mesmo
  // nos dois glossários, e existe como chave para que nenhuma tela escreva o
  // label direto no JSX (planejamento v0.4, Fase 1).
  "task.status.inbox",
  "task.status.ready",
  "task.status.queued",
  "task.status.running",
  "task.status.waiting",
  "task.status.blocked",
  "task.status.completed",
  "task.status.failed",
  "task.status.cancelled",

  // ------------------------------------------------------------ task.field
  // Rótulos de campo do detalhe de Task. Existem como chave porque "Criada" é
  // também o label de `run.status.created`, e a regra da seção 2 do CLAUDE.md
  // proíbe que o mesmo texto apareça escrito à mão em qualquer tela.
  "task.field.createdAt",

  // --------------------------------------------------------- task.priority
  "task.priority.low",
  "task.priority.medium",
  "task.priority.high",
  "task.priority.urgent",

  // ------------------------------------------------------------ agent.role
  "agent.role.architect",
  "agent.role.engineer",
  "agent.role.reviewer",
  "agent.role.explorer",

  // ----------------------------------------------------------- achievement
  "achievement.origin.catalog",
  "achievement.origin.template",
  "achievement.origin.forged",
  "achievement.rarity.common",
  "achievement.rarity.rare",
  "achievement.rarity.epic",
  "achievement.rarity.legendary",
  "achievement.state.locked",
  "achievement.state.hidden",
  "achievement.state.inProgress",
  "achievement.state.unlocked",

  // ------------------------------------------------------------------- run
  // Os nove estados de Run. Os cinco não terminais são iguais nos dois temas,
  // menos `waitingApproval`, que é o Selo da Guilda do glossário (decisões de
  // UX da Fase 2). Os quatro terminais vêm da tabela da seção 14.
  "run.status.created",
  "run.status.queued",
  "run.status.preparing",
  "run.status.running",
  "run.status.waitingApproval",
  "run.status.succeeded",
  "run.status.failed",
  "run.status.cancelled",
  "run.status.timedOut",
  "run.cockpit",
  "run.timeline",

  // ------------------------------------------------------------------- env
  "env.host",
  "env.host.warning",
  "env.host.canonical",
  "env.docker",
  "env.docker.canonical",

  // ----------------------------------------------------------- enforcement
  // Quão forte é a barreira (documento técnico, seção 15). Não é tematizado:
  // a diferença entre política pedida e política imposta é informação de
  // segurança, e o tema nunca a suaviza.
  "enforcement.advisory",
  "enforcement.harnessNative",
  "enforcement.sandboxEnforced",
  "enforcement.requested",
  "enforcement.applied",

  // ------------------------------------------------------ workspaceStrategy
  "workspaceStrategy.current",
  "workspaceStrategy.gitWorktree",
  "workspaceStrategy.copy",

  // ----------------------------------------------------- harness.capability
  // Os onze campos de `HarnessCapabilities`, na ordem do contrato.
  "harness.capability.streaming",
  "harness.capability.structuredOutput",
  "harness.capability.resume",
  "harness.capability.multiTurnProcess",
  "harness.capability.toolEvents",
  "harness.capability.tokenUsage",
  "harness.capability.modelSelection",
  "harness.capability.agentSelection",
  "harness.capability.nativePermissions",
  "harness.capability.hostExecution",
  "harness.capability.dockerExecution",

  // ------------------------------------------------------------------ hero
  "hero.xp",
  "hero.level",

  // ----------------------------------------------------------------- infra
  "infra.worker",
  "infra.queue",
  "infra.api",
  "infra.runtime",

  // ------------------------------------------------------------------- nav
  "nav.dashboard",
  "nav.inbox",
  "nav.projects",
  "nav.tasks",
  "nav.runs",
  "nav.knowledge",
  "nav.agents",
  "nav.loadouts",
  "nav.workflows",
  "nav.hall",
  "nav.settings",

  // ------------------------------------------------------------------ hall
  "hall.tab.achievements",
  "hall.tab.heroes",
  "hall.tab.bestiary",
  "hall.tab.chronicle",
  "hall.filter.origin",
  "hall.filter.rarity",
  "hall.filter.state",

  // -------------------------------------------------------------- settings
  "settings.theme.toggle",
  "settings.theme.description",
] as const;

/**
 * Toda chave que a interface pode pedir ao glossário ativo.
 *
 * União de literais de string: pedir uma chave fora dela é erro de compilação,
 * e faltar uma chave em `dnd` ou em `plain` também.
 */
export type GlossaryKey = (typeof GLOSSARY_KEYS)[number];

/** Um glossário completo: exatamente as chaves de `GlossaryKey`, todas preenchidas. */
export type Glossary = Readonly<Record<GlossaryKey, string>>;
