/**
 * Chaves canônicas do glossário.
 *
 * Uma chave por linha da tabela do planejamento v0.4, seção 14, mais os labels
 * de navegação da seção 8 e as abas do Hall (Fase 2.5D). As chaves são sempre
 * em inglês e estáveis: o texto muda, a chave não.
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

  // ------------------------------------------------------------ agent.role
  "agent.role.architect",
  "agent.role.engineer",
  "agent.role.reviewer",
  "agent.role.explorer",

  // ------------------------------------------------------------------- run
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
