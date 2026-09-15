import type { GlossaryKey } from "./keys.js";

/**
 * O aviso do modo sem isolamento, numa constante: uma frase, um lugar só de
 * onde ela sai. É o valor de `env.host.warning` e o que vai dentro do rótulo
 * onde não existe um lugar ao lado para ele.
 */
const SEM_ISOLAMENTO = "sem isolamento";

/**
 * Glossário `dnd` — o tema Dungeon Master ligado (planejamento v0.4, seção 14).
 *
 * Regra de segurança da seção 14: "Campo aberto" nunca aparece sozinho.
 * `env.host.warning` acompanha sempre, e `env.host.canonical` mantém o texto
 * canônico do badge ao lado, idêntico nos dois glossários. Onde o rótulo
 * aparece fora do badge, o aviso vai **dentro** do próprio valor — é o que
 * torna impossível um ponto de renderização exibir um sem o outro, sem
 * depender de cada tela lembrar da regra. O teste varre os dois glossários
 * atrás de um "Campo aberto" desacompanhado, nas duas formas.
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
  "entity.provider": "Patronato",
  "entity.provider.plural": "Patronatos",
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
  "run.status.waitingChild": "Aguardando o aliado",
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
  "workflowStep.type.delegate": "Aliado",

  // --------------------------------------------------------- runStep.status
  "runStep.status.pending": "Pendente",
  "runStep.status.running": "Em andamento",
  "runStep.status.waitingApproval": "Aguardando o Selo",
  "runStep.status.waitingChild": "Aguardando o aliado",
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

  // -------------------------------------------------------------- knowledge
  "knowledge.distiller": "Escriba do Grimório",
  "knowledge.type.fact": "Fato",
  "knowledge.type.decision": "Decreto",
  "knowledge.type.discovery": "Descoberta",
  "knowledge.type.constraint": "Restrição",
  "knowledge.type.procedure": "Procedimento",
  "knowledge.type.summary": "Resumo da Campanha",
  "knowledge.status.pendingReview": "Aguardando o Selo do Escriba",
  "knowledge.status.active": "No Grimório",
  "knowledge.status.rejected": "Recusada",
  "knowledge.status.archived": "Arquivada",
  "knowledge.review.pending": "Aguardando o Selo",
  "knowledge.review.reviewed": "Já seladas",
  "knowledge.review.title": "Fila do Selo do Escriba",
  "knowledge.review.empty":
    "Nenhuma Página aguarda o Selo. Quando o Escriba promover um candidato, ela aparece aqui para você decidir.",
  "knowledge.review.hint":
    "O Escriba escreveu estas Páginas a partir do que as Expedições aprenderam. Sele o que vale, corrija o que quase vale, recuse o resto.",
  "knowledge.decision.approve": "Selar a Página",
  "knowledge.decision.reject": "Recusar a Página",
  "knowledge.decision.editApprove": "Corrigir antes de selar",
  "knowledge.decision.saveApprove": "Salvar e selar",
  "knowledge.approve.done": "A Página entrou no Grimório.",
  "knowledge.reject.title": "Recusar esta Página do Grimório?",
  "knowledge.reject.body":
    "A Página fica registrada como recusada, com a sua nota, e nunca entra no Grimório. A decisão não pode ser desfeita.",
  "knowledge.reject.done": "Página recusada.",
  "knowledge.conflict":
    "Outra mão selou antes da sua. Nada foi sobrescrito: a Página está {status}.",
  "knowledge.edit.title": "Corrigir a Página",
  "knowledge.edit.body":
    "Título, conteúdo e tipo. Cada correção sobe a versão da Página; o Resumo da Campanha não troca de tipo.",
  "knowledge.edit.done": "Página salva.",
  "knowledge.archive.title": "Arquivar esta Página?",
  "knowledge.archive.body":
    "A Página sai do Grimório e deixa de contar para o Resumo da Campanha. Ela fica guardada e pode voltar depois.",
  "knowledge.archive.action": "Arquivar a Página",
  "knowledge.archive.done": "Página arquivada.",
  "knowledge.unarchive.action": "Devolver ao Grimório",
  "knowledge.unarchive.done": "A Página voltou ao Grimório.",
  "knowledge.detail.open": "Abrir a Página",
  "knowledge.summary.title": "Resumo da Campanha",
  "knowledge.summary.empty":
    "O Escriba ainda não escreveu o Resumo da Campanha. Ele nasce no primeiro lote com Páginas seladas.",
  "knowledge.summary.stale": "{n} Páginas entraram no Grimório depois deste resumo.",
  "knowledge.summary.fresh": "Cobre todas as Páginas do Grimório.",
  "knowledge.distill.now": "Chamar o Escriba",
  "knowledge.distill.requested":
    "O Escriba foi chamado. {n} candidatos esperam o lote, que roda em segundo plano.",
  "knowledge.distill.nothing":
    "O Escriba foi chamado, mas nenhum candidato espera: o lote vai voltar de mãos vazias.",
  "knowledge.distill.done":
    "O Escriba passou pelo Grimório: {promoted} promovidas, {merged} fundidas, {rejected} recusadas.",
  "knowledge.batches.title": "Lotes do Escriba",
  "knowledge.batches.empty":
    "Nenhum lote ainda. O Escriba passa pelo Grimório na cadência configurada, ou quando você o chama.",
  "knowledge.batch.status.running": "Escrevendo",
  "knowledge.batch.status.succeeded": "Encerrado",
  "knowledge.batch.status.failed": "Falhou",
  "knowledge.batch.trigger.timer": "Pela cadência",
  "knowledge.batch.trigger.idle": "Por ociosidade",
  "knowledge.batch.trigger.notify": "A pedido",
  "knowledge.batch.trigger.manual": "Chamado à mão",
  "knowledge.batch.counts":
    "{candidates} candidatos · {promoted} promovidas · {merged} fundidas · {rejected} recusadas",
  "knowledge.batch.summaryRegenerated": "Resumo reescrito",
  "knowledge.batch.forged": "Forjou uma Conquista",
  "knowledge.candidate.status.pending": "Aguardando o Escriba",
  "knowledge.candidate.status.promoted": "Virou Página",
  "knowledge.candidate.status.rejected": "Recusado pelo Escriba",
  "knowledge.candidate.status.merged": "Fundido numa Página",
  "knowledge.candidate.openItem": "Abrir a Página no Grimório",
  "knowledge.provenance.title": "Proveniência",
  "knowledge.provenance.run": "Expedição de origem",
  "knowledge.provenance.task": "Missão de origem",
  "knowledge.provenance.batch": "Lote do Escriba",
  "knowledge.provenance.merged": "Candidatos fundidos nesta Página",
  "knowledge.provenance.covered": "Páginas cobertas por este resumo",
  "knowledge.provenance.none":
    "Sem Expedição de origem: escrita pelo Escriba a partir do Grimório.",
  "knowledge.decisions.empty":
    "Nenhum Decreto ainda. Quando uma Expedição registrar uma decisão e o Escriba a promover, ela entra nesta linha do tempo.",
  "knowledge.decisions.from": "Decretado na Expedição",
  "knowledge.tab.items": "Páginas",
  "knowledge.tab.batches": "Lotes",
  "knowledge.list.empty":
    "O Grimório está em branco. As Expedições trazem candidatos, e o Escriba os transforma em Páginas.",
  "knowledge.list.noMatch": "Nenhuma Página casa com esse filtro.",
  "knowledge.search.placeholder": "Buscar no Grimório…",
  "knowledge.filter.type": "Tipo",
  "knowledge.filter.status": "Estado",
  "knowledge.filter.review": "Selo",
  "knowledge.pending.title": "Páginas aguardando o Selo",
  "knowledge.overview.description":
    "O que cada Campanha já aprendeu. O Escriba escreve as Páginas a partir das Expedições, e você sela o que entra.",
  "knowledge.overview.empty":
    "Nenhuma Campanha ainda. O Grimório nasce com a primeira Expedição que traz um candidato.",
  "knowledge.overview.open": "Abrir o Grimório",
  "knowledge.overview.noSummary": "Sem resumo ainda",
  "knowledge.overview.summaryAt": "Resumo escrito {when}",
  "knowledge.count.active": "{n} no Grimório",
  "knowledge.count.pending": "{n} aguardando o Selo",

  // ---------------------------------------------------------------- forged
  "forged.section.title": "Na forja",
  "forged.section.empty":
    "Nada na forja. Quando o Escriba encontrar um feito notável numa Expedição, a Conquista forjada aparece aqui antes de entrar no Hall.",
  "forged.section.hint":
    "O Escriba escreveu estas cartas. Pendure no Hall as que valem, reescreva as que quase valem, descarte o resto.",
  "forged.decision.approve": "Pendurar no Hall",
  "forged.decision.rename": "Reescrever",
  "forged.decision.discard": "Descartar a forjada",
  "forged.rename.title": "Reescrever a forjada",
  "forged.rename.body":
    "Só o texto do tema muda: nome, descrição e fala. A versão sóbria descreve a condição e é escrita pelo código.",
  "forged.rename.name": "Nome no tema",
  "forged.rename.description": "Descrição no tema",
  "forged.rename.flavor": "Fala do Dungeon Master",
  "forged.rename.plain": "Versão sóbria (não muda)",
  "forged.discard.title": "Descartar esta forjada?",
  "forged.discard.body":
    "Ela nunca entra no Hall. A carta fica guardada só para a forja contar o intervalo entre forjadas. A decisão não pode ser desfeita.",
  "forged.approve.done": "A forjada foi pendurada no Hall.",
  "forged.rename.done": "Forjada reescrita.",
  "forged.discard.done": "Forjada descartada.",
  "forged.conflict":
    "Outra mão decidiu antes da sua. Nada foi sobrescrito: a forjada está {status}.",
  "forged.status.pendingReview": "Na forja",
  "forged.status.approved": "Pendurada no Hall",
  "forged.status.discarded": "Descartada",
  "forged.provenance": "Forjada a partir de",
  "forged.kind.nemesisDefeated": "Monstro reaberto derrotado",
  "forged.kind.victoryStreak": "Sequência de Vitórias",
  "forged.kind.firstHarnessVictory": "Primeira Vitória de uma Guilda",
  "forged.kind.durationRecord": "Recorde de duração",
  "forged.toast.title": "O Escriba forjou uma Conquista",
  "forged.toast.body": "Está na forja, esperando o seu veredito antes de entrar no Hall.",
  "forged.toast.open": "Abrir a forja",

  // ---------------------------------------------------------------- context
  "context.title": "Provisões da Expedição",
  "context.description":
    "Arrumadas uma vez, quando o Worker tira a Expedição da fila, e iguais em todos os passos do ritual. Uma Expedição retomada herda as mesmas provisões, para a conversa continuar com o que já tinha.",
  "context.status.assembled": "Arrumadas",
  "context.status.empty": "Nada a levar",
  "context.status.disabled": "Desligadas",
  "context.status.failed": "Falharam",
  "context.status.pending": "Ainda não arrumadas",
  "context.pending.hint":
    "As provisões são arrumadas quando o Worker tira a Expedição da fila. Esta tela relê sozinha quando isso acontecer.",
  "context.empty.hint":
    "O Grimório desta Campanha ainda não tinha nada relevante para esta Missão, e o Herói partiu só com a Missão.",
  "context.disabled.hint":
    "As provisões estavam desligadas nas Configurações quando a Expedição partiu; o Herói partiu só com a Missão.",
  "context.failed.hint": "A arrumação falhou e a Expedição seguiu sem provisões.",
  "context.inherited": "Herdadas da Expedição que esta retomou",
  "context.inherited.open": "Abrir a Expedição de origem",
  "context.section.summary": "Resumo da Campanha",
  "context.section.decisions": "Decretos",
  "context.section.knowledge": "Páginas do Grimório",
  "context.section.lineage": "Missões relacionadas",
  "context.section.artifacts": "Espólios de Expedições anteriores",
  "context.section.skills": "Habilidades",
  "context.reason.projectSummary": "resumo corrente da Campanha",
  "context.reason.recentDecision": "Decreto recente",
  "context.reason.ftsMatch": "casa com a Missão pela busca textual",
  "context.reason.parentTask": "Missão mãe",
  "context.reason.dependency": "dependência desta Missão",
  "context.reason.priorRunArtifact": "Espólio de Expedição anterior desta Missão",
  "context.reason.parentTaskArtifact": "Espólio de Expedição da Missão mãe",
  "context.reason.loadoutSkill": "Habilidade do Equipamento",
  "context.excluded.title": "Ficou de fora",
  "context.excluded.none": "Nada ficou de fora: tudo o que era relevante coube no orçamento.",
  "context.excluded.sectionBudget": "estourou o teto da seção",
  "context.excluded.totalBudget": "cortado para o total caber",
  "context.budget.title": "Orçamento",
  "context.budget.usage": "{used} de {total} tokens",
  "context.budget.frame": "{n} da moldura",
  "context.items": "{n} itens",
  "context.items.one": "{n} item",
  "context.tokens": "{n} tokens",
  "context.score": "relevância {score}",
  "context.truncated": "cortado",
  "context.query": "Consulta ao Grimório",
  "context.text.title": "O texto que foi ao prompt",
  "context.text.show": "Mostrar o texto",
  "context.text.hide": "Esconder o texto",
  "context.text.copy": "Copiar o texto",
  "context.text.copied": "Copiado",
  "context.open.knowledge": "Abrir a Página",
  "context.open.task": "Abrir a Missão",
  "context.open.run": "Abrir a Expedição",
  "context.policy.title": "Política aplicada",
  "context.policy.source": "Equipamento {version} e Configurações",
  "context.expand": "Mostrar as provisões",
  "context.collapse": "Recolher as provisões",
  "context.toolCalls.one": "{n} consulta ao Grimório",
  "context.toolCalls.many": "{n} consultas ao Grimório",
  "context.toolCall.badge": "Grimório",

  // ------------------------------------------------------------------- env
  "env.host": "Campo aberto",
  "env.host.warning": SEM_ISOLAMENTO,
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
  "harness.capability.forkSession": "Retomar em ramo novo",
  "harness.capability.multiTurnProcess": "Processo de vários turnos",
  "harness.capability.toolEvents": "Eventos de Item",
  "harness.capability.tokenUsage": "Uso de tokens",
  "harness.capability.modelSelection": "Escolha de Patrono",
  "harness.capability.agentSelection": "Escolha de sub-Herói",
  "harness.capability.nativePermissions": "Permissões próprias",
  // O aviso vai dentro do valor: a lista de capabilities é uma linha de
  // rótulos curtos, um `<span>` por capability, sem lugar para um segundo
  // texto ao lado como o badge de ambiente tem. Aqui o rótulo aparecia
  // sozinho, e a regra da seção 2 do CLAUDE.md não abre exceção. Assim o tema
  // fica e nenhuma tela consegue mostrar "Campo aberto" sem o aviso.
  "harness.capability.hostExecution": `Campo aberto (${SEM_ISOLAMENTO})`,
  "harness.capability.dockerExecution": "Masmorra selada",
  "harness.capability.mcpServers": "Relíquias por Expedição",

  // ------------------------------------------------------- executionStats
  "executionStats.xp": "Experiência",
  "executionStats.level": "Nível",
  "executionStats.toNextLevel": "Para o próximo nível",
  "executionStats.runsTotal": "Expedições",
  "executionStats.runsSucceeded": "Vitórias",
  "executionStats.runsFailed": "Derrotas",
  "executionStats.bugTasksCompleted": "Monstros derrotados",
  "executionStats.tokens": "Tokens",
  "executionStats.topHarness": "Guilda mais usada",
  "executionStats.byLoadout": "Por Equipamento",

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
  "nav.registry": "Arsenal",
  "nav.hall": "Hall dos Heróis",
  "nav.observability": "Torre de Vigia",
  "nav.settings": "Configurações",

  // ------------------------------------------------------------------ hall
  "hall.tab.achievements": "Conquistas",
  "hall.tab.agents": "Heróis",
  "hall.tab.bugs": "Bestiário",
  "hall.tab.history": "Crônica",
  "hall.filter.origin": "Origem",
  "hall.filter.rarity": "Raridade",
  "hall.filter.state": "Estado",
  "hall.counter": "{unlocked} de {total} desbloqueadas",
  "hall.unseen": "Ainda não vista",
  "hall.progressOf": "{current} de {target}",
  "hall.tierOf": "Grau {label}",
  "hall.bugs.resolvedAt": "Derrotado em",
  "hall.bugs.resolvedBy": "Quem derrotou",
  "hall.bugs.reopenings": "Nêmesis",
  "hall.history.loadMore": "Carregar mais",

  // --------------------------------------------------------------- loadout
  "loadout.noNativePermissions.title": "Esta Guilda não impõe permissão por comando",
  "loadout.noNativePermissions.body":
    "A CLI desta {harness} não consulta a lista de comandos do {profile}: a permissão é só pedida, nunca aplicada, e o enforcement da Expedição sai como ADVISORY.",
  "loadout.noNativePermissions.antigravity":
    "No Antigravity é o oposto: sem interface, a CLI não consulta lista nenhuma e nega todo comando. Em {host} ({hostWarning}), uma {run} que precise executar comandos termina em PERMISSION_DENIED; só `allowUnsafeBypass` no {profile} libera — e libera tudo.",
  "loadout.policy.title": "O que vai nas provisões",
  "loadout.policy.description":
    "Quanto do Grimório este Equipamento leva para a Expedição. As Configurações põem os tetos gerais; aqui é o que este Equipamento pede, e o menor dos dois vale.",
  "loadout.policy.includeProjectSummary": "Levar o Resumo da Campanha",
  "loadout.policy.includeDecisions": "Levar os Decretos",
  "loadout.policy.maxItems": "Teto de Páginas",
  "loadout.policy.maxItems.description":
    "Quantas Páginas relevantes este Equipamento leva, no máximo. 0 desliga a seção.",
  "loadout.policy.includeParentContext": "Levar a Missão mãe",
  "loadout.policy.includeDependencyContext": "Levar as dependências",
  "loadout.policy.maxTokens": "Orçamento próprio",
  "loadout.policy.maxTokens.description":
    "Teto de tokens das provisões deste Equipamento, quando menor que o das Configurações. 0 usa o das Configurações.",
  "loadout.pin.latest": "Seguir a mais recente",
  "loadout.pin.version": "Fixar na {version}",
  "loadout.pin.pinned": "Fixada na {version}",
  "loadout.pin.hint":
    "Sem fixar, a Expedição parte com a versão mais recente da Habilidade na hora de partir. Fixar congela uma versão até você trocar.",
  "loadout.refs.hint":
    "Habilidades, Itens e Relíquias vêm do Arsenal. O que não existe lá ainda, cadastre primeiro.",
  "loadout.model.anyProvider": "Qualquer Patronato",
  "loadout.compat.title": "Compatibilidade",
  "loadout.compat.description":
    "O que a Guilda declara contra o que este Equipamento pede, a CLI no modo do perfil e a credencial do Patronato. Nenhum Patrono é chamado.",
  "loadout.compat.ready": "Pronto para partir",
  "loadout.compat.blocked": "A Expedição não parte assim",
  "loadout.compat.pending": "Parte, com pendências",
  "loadout.compat.preview":
    "Prévia pela matriz da Guilda escolhida. A CLI e o Patronato só entram na verificação completa, depois de salvar.",
  "loadout.compat.unsaved":
    "Salve o Equipamento para verificar a CLI e o Patronato com a Guilda escolhida.",
  "loadout.compat.check": "Verificar de novo",
  "loadout.compat.checking": "Verificando a Guilda, a CLI e o Patronato…",
  "loadout.compat.checkedAt": "Verificado {when}, em {ms} ms",
  "loadout.compat.blockers": "Bloqueios",
  "loadout.compat.warnings": "Avisos",
  "loadout.compat.none": "Nenhum descompasso entre o Equipamento e a Guilda.",
  "loadout.compat.cli": "CLI da Guilda",
  "loadout.compat.cli.none": "Esta instância não tem adapter da Guilda para este modo.",
  "loadout.compat.cli.installed": "instalada",
  "loadout.compat.cli.notInstalled": "não encontrada",
  "loadout.compat.cli.timedOut": "não respondeu no tempo",
  "loadout.compat.cli.authenticated": "autenticada",
  "loadout.compat.cli.notAuthenticated": "sem credencial",
  "loadout.compat.container": "Dentro da Masmorra selada",
  "loadout.compat.container.daemon": "Daemon",
  "loadout.compat.container.image": "Imagem",
  "loadout.compat.provider.none": "Nenhum Patronato declara esta Guilda.",
  "loadout.compat.provider.keys": "Variáveis que o Patronato declara: {keys}",
  "loadout.compat.harnessDisabled": "A Guilda está desligada.",
  "loadout.compat.profileDisabled": "O perfil de execução está desligado.",
  "loadout.history.title": "Versões do Equipamento",
  "loadout.history.description":
    "Cada edição que muda alguma coisa guarda uma versão. Restaurar cria uma versão nova igual à antiga; nada é reescrito.",
  "loadout.history.empty": "Nenhuma versão guardada ainda.",
  "loadout.history.current": "versão em uso",
  "loadout.history.first": "Nasceu assim",
  "loadout.history.noChanges": "Igual à versão anterior",
  "loadout.history.restore": "Restaurar",
  "loadout.change.added": "Entra {names}",
  "loadout.change.removed": "Sai {names}",
  "loadout.change.pin": "{name}: de {from} para {to}",
  "loadout.change.field": "{field}: de {from} para {to}",
  "loadout.change.policy": "As provisões mudaram",
  "loadout.change.default.on": "Passa a ser o Equipamento padrão",
  "loadout.change.default.off": "Deixa de ser o Equipamento padrão",
  "loadout.restore.title": "Restaurar a {version}?",
  "loadout.restore.body":
    "O Equipamento ganha uma versão nova, igual à {version}; a {current} continua no histórico e as Expedições já feitas não mudam. Uma Habilidade apagada desde então torna a versão irrestaurável, e a API diz qual.",
  "loadout.restore.action": "Restaurar como versão nova",
  "loadout.restore.done": "Restaurada: o Equipamento agora está na {version}.",
  "loadout.restore.same": "Nada a restaurar: a {version} é igual à atual.",

  // ---------------------------------------------------------------- registry
  "registry.description":
    "O que um Herói pode levar numa Expedição: Habilidades versionadas, Itens, Relíquias e os Patronatos que servem os Patronos.",

  // ------------------------------------------------------------------- skill
  "skill.description":
    "Instruções em markdown que o Herói recebe. O texto vive em versões imutáveis: publicar acrescenta, nunca reescreve, e o Equipamento pode fixar uma versão.",
  "skill.list.empty":
    "Nenhuma Habilidade ainda. Escreva a primeira e ela nasce na v1; o Equipamento a leva pela versão mais recente ou por uma fixada.",
  "skill.latestVersion": "Versão mais recente",
  "skill.version.pinned": "fixada no Equipamento",
  "skill.version.latestAtDeparture": "a mais recente na partida",
  "skill.content.title": "Texto da Habilidade",
  "skill.content.empty": "Esta versão está em branco. Publique uma versão nova com o texto.",
  "skill.history.title": "Versões da Habilidade",
  "skill.history.changelog.none": "Sem nota de versão",
  "skill.publish.action": "Publicar versão nova",
  "skill.publish.title": "Publicar a {version} da Habilidade",
  "skill.publish.body":
    "A versão anterior continua existindo, e as Expedições que a levaram não mudam. Os Equipamentos que seguem a mais recente passam a levar esta na próxima partida.",
  "skill.publish.changelog": "O que mudou nesta versão",
  "skill.publish.changelog.hint":
    "Obrigatório: é o que quem fixa uma versão no Equipamento vai ler.",
  "skill.publish.confirm": "Publicar {version}",
  "skill.publish.done": "{version} publicada.",
  "skill.publish.conflict":
    "Outra mão publicou antes da sua: a versão mais recente já é a {version}. Releia o texto antes de publicar de novo.",
  "skill.publish.unchanged": "O texto é igual ao da versão mais recente.",
  "skill.diff.title": "Comparar duas versões",
  "skill.diff.from": "Da versão",
  "skill.diff.to": "Para a versão",
  "skill.diff.summary": "{added} linhas acrescentadas · {removed} removidas",
  "skill.diff.same": "As duas versões têm exatamente o mesmo texto.",
  "skill.create.title": "Nova Habilidade",
  "skill.create.body":
    "Nasce na v1 com o texto abaixo. Depois, cada mudança de texto é uma versão nova.",
  "skill.create.done": "Habilidade criada na v1.",
  "skill.edit.done": "Habilidade salva.",
  "skill.delete.title": "Apagar a Habilidade?",
  "skill.delete.body":
    "Todas as versões somem. Um Equipamento que ainda a leva impede a exclusão, e a API diz qual. As Expedições já feitas guardam o texto que levaram.",
  "skill.delete.done": "Habilidade apagada.",

  // -------------------------------------------------------------------- tool
  "tool.description":
    "O que o Herói pode usar: um prefixo de comando liberado, no mesmo formato da lista do perfil, ou uma ferramenta que uma Relíquia anuncia.",
  "tool.kind.command": "Comando liberado",
  "tool.kind.mcpTool": "Ferramenta de Relíquia",
  "tool.command": "Prefixo de comando",
  "tool.command.hint": "Palavras separadas por espaço, sem shell: `git add`, nunca `git` inteiro.",
  "tool.toolName": "Nome anunciado pela Relíquia",
  "tool.toolName.hint": "Exatamente como a Relíquia o anuncia, por exemplo `search_knowledge`.",
  "tool.kindLocked": "A espécie do Item não muda: para trocar, apague e crie outro.",
  "tool.list.empty": "Nenhum Item ainda. O Arsenal nasce com os cinco comandos de git liberados.",
  "tool.create.title": "Novo Item",
  "tool.edit.title": "Editar o Item",
  "tool.save.done": "Item salvo.",
  "tool.delete.title": "Apagar o Item?",
  "tool.delete.body":
    "Um Equipamento que ainda o leva impede a exclusão, e a API diz qual. As Expedições já feitas guardam a definição que levaram.",
  "tool.delete.done": "Item apagado.",

  // --------------------------------------------------------------- mcpServer
  "mcpServer.description":
    "Como cada Relíquia é erguida: comando e argumentos separados, ou uma URL. Segredos nunca ficam aqui: só os nomes das variáveis de ambiente que ela enxerga.",
  "mcpServer.name.hint":
    "Minúsculas, dígitos, hífen e sublinhado, começando por letra: é a chave que a CLI da Guilda registra.",
  "mcpServer.args": "Argumentos",
  "mcpServer.args.hint": "Um por linha. Nunca um segredo: a linha de comando é pública na máquina.",
  "mcpServer.url.hint":
    "Começa por http:// ou https://, sem usuário e senha: a URL vai inteira à linha de comando.",
  "mcpServer.envKeys": "Variáveis de ambiente que a Relíquia enxerga",
  "mcpServer.envKeys.hint":
    "Só os nomes, em maiúsculas. O valor nunca é gravado nem mostrado: fica no ambiente de quem executa.",
  "mcpServer.readOnly": "Só leitura",
  "mcpServer.builtIn": "Nasce com o sistema",
  "mcpServer.builtIn.hint":
    "O Worker sabe erguer esta Relíquia sozinho. Só a descrição se edita, e ela não se apaga.",
  "mcpServer.transportLocked": "O transporte não muda: para trocar, apague e crie outra.",
  "mcpServer.list.empty": "Nenhuma Relíquia ainda além do Grimório, que nasce com o sistema.",
  "mcpServer.create.title": "Nova Relíquia",
  "mcpServer.edit.title": "Editar a Relíquia",
  "mcpServer.save.done": "Relíquia salva.",
  "mcpServer.delete.title": "Apagar a Relíquia?",
  "mcpServer.delete.body":
    "Um Item ou um Equipamento que ainda a referencia impede a exclusão, e a API diz qual. As Expedições já feitas guardam a definição que levaram.",
  "mcpServer.delete.done": "Relíquia apagada.",

  // ---------------------------------------------------------------- provider
  "provider.description":
    "Quem serve os Patronos e como se autentica: pela assinatura da CLI, por uma chave de API ou localmente. Só os nomes das variáveis ficam aqui; o valor nunca.",
  "provider.kind.subscription": "Assinatura da CLI",
  "provider.kind.apiKey": "Chave de API",
  "provider.kind.local": "Local, sem credencial",
  "provider.auth.envKeyPresent": "Chave presente no ambiente",
  "provider.auth.cliAuthenticated": "CLI autenticada",
  "provider.auth.cliNotAuthenticated": "CLI sem credencial",
  "provider.auth.notRequired": "Não exige credencial",
  "provider.auth.unknown": "Credencial não verificada",
  "provider.auth.checkedAt": "Verificado {when}",
  "provider.auth.hint":
    "O estado vem do preflight de um Equipamento cuja Guilda este Patronato declara; nenhum Patrono é chamado.",
  "provider.auth.check": "Verificar a credencial",
  "provider.auth.checking": "Verificando a credencial…",
  "provider.auth.noLoadout":
    "Nenhum Equipamento usa uma Guilda deste Patronato. Monte um para poder verificar.",
  "provider.authEnvKeys": "Variáveis que carregam a credencial",
  "provider.authEnvKeys.hint":
    "Só os nomes, em maiúsculas. Qualquer uma presente no ambiente basta.",
  "provider.harnesses": "Guildas que este Patronato serve",
  "provider.docsUrl": "Onde está explicado como autenticar",
  "provider.list.empty":
    "Nenhum Patronato ainda. O Arsenal nasce com Anthropic, OpenAI, Google e Local.",
  "provider.create.title": "Novo Patronato",
  "provider.edit.title": "Editar o Patronato",
  "provider.save.done": "Patronato salvo.",
  "provider.delete.title": "Apagar o Patronato?",
  "provider.delete.body":
    "Um Patrono que ainda aponta para ele impede a exclusão, e a API diz qual. Nenhuma credencial é apagada: ela nunca esteve aqui.",
  "provider.delete.done": "Patronato apagado.",
  "provider.toast.lost": "{name} ficou sem autenticação",
  "provider.toast.lost.body":
    "O preflight encontrou a CLI da Guilda sem credencial. Entre de novo na CLI ou defina uma das variáveis do Patronato.",

  // -------------------------------------------------------------- capability
  "capability.severity.blocker": "Bloqueio",
  "capability.severity.warning": "Aviso",
  "capability.causedBy": "Causado por",
  "capability.code.dockerUnsupported": "A Guilda não roda na Masmorra selada",
  "capability.code.hostUnsupported": `A Guilda não roda em Campo aberto (${SEM_ISOLAMENTO})`,
  "capability.code.structuredOutputRequired":
    "O Equipamento exige saída estruturada e a Guilda não a declara",
  "capability.code.mcpUnsupported": "A Guilda não ergue Relíquias por Expedição",
  "capability.code.modelSelectionUnsupported": "A Guilda não aceita escolher o Patrono",
  "capability.code.commandToolsAdvisory": "Os Itens de comando são só recomendação nesta Guilda",
  "capability.code.resumeUnsupported": "A Guilda não retoma sessão",

  // ------------------------------------------------------------ run.preflight
  "run.preflight.title": "Compatibilidade da Expedição",
  "run.preflight.checking": "Verificando o Equipamento com a Guilda, a CLI e o Patronato…",
  "run.preflight.blocked": "A Expedição não pode partir com este Equipamento neste ambiente.",
  "run.preflight.warnings":
    "A Expedição parte; os avisos ficam registrados no Diário da Expedição.",
  "run.preflight.ready": "Nada impede a partida.",
  "run.preflight.failed":
    "Não foi possível verificar antes de partir. A API confere de novo na partida e recusa se houver bloqueio.",
  "run.preflight.rejected": "A partida foi recusada pela API:",
  "run.departed.warnings": "A Expedição partiu com {n} avisos, registrados no Diário da Expedição.",

  // --------------------------------------------------------------- run.frozen
  "run.frozen.title": "Equipamento congelado",
  "run.frozen.description":
    "O que a Expedição levou, exatamente como estava na partida. Editar o Equipamento, a Habilidade ou a Relíquia depois não muda nada aqui.",
  "run.frozen.legacy":
    "Expedição anterior à Fase 8: o snapshot guarda só os nomes, sem o texto das Habilidades nem a definição dos Itens.",
  "run.frozen.show": "Mostrar o texto",
  "run.frozen.hide": "Esconder o texto",
  "run.frozen.none": "Nenhuma",

  // ---------------------------------------------------------------- autonomy
  "autonomy.title": "Rédea",
  "autonomy.description":
    "Quanto a Campanha anda sozinha: o que as Expedições podem decidir sem o Mestre da Guilda.",
  "autonomy.level.manual": "Rédea curta",
  "autonomy.level.suggest": "Rédea guiada",
  "autonomy.level.propose": "Rédea firme",
  "autonomy.level.policies": "Rédea longa",
  "autonomy.level.delegate": "Rédea solta",
  "autonomy.level.manual.description":
    "O Mestre da Guilda cria cada Missão e manda cada Expedição partir. Nada é sugerido.",
  "autonomy.level.suggest.description":
    "O sistema sugere Equipamento, Ritual e Patrono ao partir; a decisão continua sua.",
  "autonomy.level.propose.description":
    "O Herói traz Pistas; cada uma espera o seu Selo antes de virar Missão.",
  "autonomy.level.policies.description":
    "Os Éditos podem aprovar Pistas, conceder Selos e mandar Expedições partir sem você.",
  "autonomy.level.delegate.description":
    "Um Herói pode delegar a outro: Expedições filhas abrem sozinhas.",
  "autonomy.current": "Nível atual",
  "autonomy.change.title": "Soltar a rédea até {level}?",
  "autonomy.change.body": "A partir daí a Campanha decide isto sem o seu Selo:",
  "autonomy.change.action": "Soltar a rédea",
  "autonomy.change.done": "A rédea agora é {level}.",
  "autonomy.allows.title": "O que este nível libera",
  "autonomy.allowed": "Liberado",
  "autonomy.blocked": "Não liberado",
  "autonomy.automation.suggest": "Sugerir Equipamento, Ritual e Patrono",
  "autonomy.automation.autoApproveProposal": "Éditos aprovam Pistas e criam Missões",
  "autonomy.automation.autoApproveGate": "Éditos concedem o Selo da Guilda",
  "autonomy.automation.autoDispatch": "Expedições partem sozinhas",
  "autonomy.automation.delegate": "Heróis delegam a outros Heróis",
  "autonomy.scope.project": "Desta Campanha",
  "autonomy.scope.global": "Global",
  "autonomy.scope.all": "Desta Campanha e globais",
  "autonomy.scope.everything": "Todas, de qualquer Campanha",
  "autonomy.failClosed": "Sem Édito que case, a decisão volta ao Mestre da Guilda: revisão humana.",
  "autonomy.decidedBy.default": "Nenhuma regra casou; vale o padrão",
  "autonomy.decidedBy.tie": "Éditos empatados: {names}",
  "autonomy.decidedBy.autonomy": "A rédea (nível {level}) segurou o Édito",
  "autonomy.decidedBy.policy": "Édito {name}",
  "autonomy.decidedBy.routing": "Encaminhamento {name}",
  "autonomy.decidedBy.budget": "Tesouro {name}",
  "autonomy.decidedBy.breaker": "Sentinela {name}",
  "autonomy.decidedBy.reset": "Reset manual",
  "autonomy.decidedBy.unknown": "Padrão do sistema",
  "autonomy.toast.budgetExceeded": "O Tesouro {name} barrou uma Expedição",
  "autonomy.toast.breakerOpened": "A Sentinela {name} fechou o portão",
  "autonomy.toast.breakerHalfOpen": "A Sentinela {name} deixou passar uma sondagem",
  "autonomy.toast.breakerClosed": "A Sentinela {name} reabriu o portão",
  "autonomy.toast.taskAutoCreated": "Um Édito criou a Missão {title}",
  "autonomy.toast.levelChanged": "A rédea da Campanha mudou para {level}",
  "autonomy.toast.open": "Abrir a Rédea",

  // ------------------------------------------------------------------ policy
  "entity.policy": "Édito",
  "entity.policy.plural": "Éditos",
  "policy.description":
    "Cada Édito decide, sem o Mestre, o que fazer com um pedido: aprovar, exigir o Selo ou recusar.",
  "policy.subject": "Assunto",
  "policy.subject.proposal": "Pistas trazidas",
  "policy.subject.runStart": "Partida da Expedição",
  "policy.subject.gate": "Selo da Guilda",
  "policy.action": "Decisão do Édito",
  "policy.action.requireApproval": "Exige o Selo",
  "policy.action.autoApprove": "Aprova sozinho",
  "policy.action.deny": "Recusa",
  "policy.inert": "Inerte neste nível",
  "policy.inert.hint":
    "Um Édito que aprova sozinho só vale com a rédea no nível 3 ou acima. Neste nível ele exige o Selo.",
  "policy.priority.hint": "Maior vence. Empate entre os que casam é revisão humana.",
  "policy.conditions": "Condições",
  "policy.conditions.hint":
    "Todas as condições marcadas precisam valer. Sem nenhuma, o Édito casa com tudo.",
  "policy.list.empty": "Nenhum Édito ainda. Sem Édito, toda decisão é do Mestre da Guilda.",
  "policy.create.title": "Novo Édito",
  "policy.edit.title": "Editar o Édito",
  "policy.save.done": "O Édito foi gravado.",
  "policy.delete.title": "Rasgar este Édito?",
  "policy.delete.body":
    "As decisões já tomadas por ele ficam registradas; as próximas voltam ao Mestre da Guilda.",
  "policy.delete.done": "O Édito foi rasgado.",

  // --------------------------------------------------------------- condition
  "condition.executionMode": "Modo de execução",
  "condition.harnessKey": "Guilda",
  "condition.taskKind": "Tipo da Missão",
  "condition.taskPriority": "Prioridade da Missão",
  "condition.hasCommandTools": "Leva Itens de comando",
  "condition.enforcement": "Nível de enforcement",
  "condition.stepType": "Tipo do passo do Ritual",
  "condition.maxEstimatedTokens": "Estimativa de tokens até",
  "condition.loadoutId": "Equipamento",
  "condition.projectId": "Campanha",
  "condition.minBudgetPressure": "Pressão do Tesouro a partir de",
  "condition.any": "qualquer um destes",

  // ------------------------------------------------------------------ budget
  "entity.budget": "Tesouro",
  "entity.budget.plural": "Tesouros",
  "budget.description":
    "Um teto de gasto por janela: tokens, Expedições, tempo e Expedições ao mesmo tempo. No teto, o Tesouro barra ou avisa.",
  "budget.scope.global": "Global",
  "budget.scope.project": "Campanha",
  "budget.scope.loadout": "Equipamento",
  "budget.window.day": "Por dia",
  "budget.window.week": "Por semana",
  "budget.window.month": "Por mês",
  "budget.window.perRun": "Por Expedição",
  "budget.action.block": "Barra",
  "budget.action.warn": "Avisa",
  "budget.limit.maxTokens": "Teto de tokens",
  "budget.limit.maxRuns": "Expedições",
  "budget.limit.maxWallClockMs": "Tempo de execução",
  "budget.limit.maxConcurrentRuns": "Expedições ao mesmo tempo",
  "budget.usage.unknown": "Consumo incerto",
  "budget.usage.unknown.hint":
    "{n} Expedições terminaram sem reportar tokens; o Tesouro não libera sobre uma soma que não conhece.",
  "budget.usage.pressure": "Pressão",
  "budget.usage.exceeded": "No teto",
  "budget.usage.window": "Janela",
  "budget.usage.perRun": "Medido na última Expedição encerrada",
  "budget.limits.hint": "Pelo menos um teto. Por Expedição só aceita tokens e tempo.",
  "budget.locked": "Escopo e janela não mudam: feche este e crie outro.",
  "budget.list.empty": "Nenhum Tesouro ainda. Sem teto, toda Expedição parte.",
  "budget.create.title": "Novo Tesouro",
  "budget.edit.title": "Editar o Tesouro",
  "budget.save.done": "O Tesouro foi gravado.",
  "budget.delete.title": "Fechar este Tesouro?",
  "budget.delete.body":
    "As Expedições que ele barrou ficam registradas; as próximas partem sem este teto.",
  "budget.delete.done": "O Tesouro foi fechado.",
  "budget.exceeded.title": "Tesouro no teto",
  "budget.run.title": "Tesouro desta Expedição",
  "budget.run.hint":
    "O teto por Expedição é conferido pelo Worker durante a Expedição (Fase 9B); aqui, o consumo medido contra ele.",

  // ----------------------------------------------------------------- breaker
  "entity.breaker": "Sentinela",
  "entity.breaker.plural": "Sentinelas",
  "breaker.description":
    "Depois de falhas seguidas, a Sentinela fecha o portão: nenhuma Expedição parte até o tempo de espera passar e uma sondagem voltar bem.",
  "breaker.scope.project": "Campanha",
  "breaker.scope.loadout": "Equipamento",
  "breaker.scope.harness": "Guilda",
  "breaker.state.closed": "Vigiando · deixa passar",
  "breaker.state.open": "Portão fechado · recusa",
  "breaker.state.halfOpen": "Sondando · uma por vez",
  "breaker.openedAt": "Fechou o portão {when}",
  "breaker.reopensAt": "Sonda de novo {when}",
  "breaker.probe": "Sondagem em curso",
  "breaker.probe.run": "Expedição de sondagem",
  "breaker.consecutiveFailures": "Falhas seguidas",
  "breaker.trigger.consecutiveFailures": "Fecha com {n} falhas seguidas",
  "breaker.trigger.failuresInWindow": "Fecha com {n} falhas em {window}",
  "breaker.trigger.permissionDeniedInWindow": "Fecha com {n} permissões negadas em {window}",
  "breaker.trigger.authNotAuthenticated": "Fecha quando a Guilda perde a credencial",
  "breaker.cooldown": "Tempo de espera",
  "breaker.triggers.hint": "Pelo menos um gatilho. Qualquer um que dispare fecha o portão.",
  "breaker.locked":
    "Escopo e estado não mudam por aqui: o estado só muda pelos desfechos e pelo reset.",
  "breaker.reset": "Reabrir o portão",
  "breaker.reset.title": "Reabrir o portão de {name}?",
  "breaker.reset.body":
    "A Sentinela volta a vigiar do zero e as Expedições partem de novo, mesmo que a causa das falhas não tenha sido resolvida.",
  "breaker.reset.done": "O portão está aberto de novo.",
  "breaker.list.empty": "Nenhuma Sentinela ainda. Falhas seguidas não param nada.",
  "breaker.create.title": "Nova Sentinela",
  "breaker.edit.title": "Editar a Sentinela",
  "breaker.save.done": "A Sentinela foi gravada.",
  "breaker.delete.title": "Dispensar esta Sentinela?",
  "breaker.delete.body":
    "As Expedições que ela barrou ficam registradas; as próximas partem sem esta guarda.",
  "breaker.delete.done": "A Sentinela foi dispensada.",
  "breaker.open.title": "Sentinela de portão fechado",
  "breaker.probe.title": "Esta Expedição é a sondagem de {name}",
  "breaker.probe.body":
    "Se ela terminar bem, o portão reabre; se falhar, a Sentinela o fecha de novo.",

  // ----------------------------------------------------------------- routing
  "entity.routingRule": "Encaminhamento",
  "entity.routingRule.plural": "Encaminhamentos",
  "routing.description":
    "Por condições, escolhe o Patrono, o Equipamento ou o Ritual: o alvo preferido, e os reservas em ordem. Sem regra que case, vale o padrão.",
  "routing.kind.model": "Patrono",
  "routing.kind.loadout": "Equipamento",
  "routing.kind.workflow": "Ritual",
  "routing.target": "Alvo preferido",
  "routing.target.missing": "Alvo apagado",
  "routing.fallbacks": "Reservas, em ordem",
  "routing.fallbacks.hint":
    "Tentados quando o preferido não serve: um Patrono de outra Guilda, um alvo apagado.",
  "routing.model.note":
    "Um Encaminhamento de Patrono só vale quando o Equipamento deixa o Patrono em branco: um Patrono escolhido no Equipamento é decisão sua.",
  "routing.kindLocked": "A espécie não muda: apague e crie de novo.",
  "routing.list.empty":
    "Nenhum Encaminhamento ainda. Vale o padrão: o Equipamento marcado, o Ritual da Missão, o Patrono da Guilda.",
  "routing.create.title": "Novo Encaminhamento",
  "routing.edit.title": "Editar o Encaminhamento",
  "routing.save.done": "O Encaminhamento foi gravado.",
  "routing.delete.title": "Apagar este Encaminhamento?",
  "routing.delete.body":
    "As escolhas já feitas ficam registradas nas Expedições; as próximas voltam ao padrão.",
  "routing.delete.done": "O Encaminhamento foi apagado.",

  // -------------------------------------------------------------- suggestion
  "suggestion.title": "Sugestões da rédea",
  "suggestion.description":
    "Os Encaminhamentos da Campanha, avaliados com os fatos da Missão. Troque o que quiser antes de partir.",
  "suggestion.loading": "Consultando as sugestões…",
  "suggestion.disabled": "A rédea desta Campanha não sugere nada (nível 0).",
  "suggestion.none": "Sem sugestão: vale o padrão.",
  "suggestion.applied": "Pré-selecionado",
  "suggestion.model.note": "Aplicado na partida quando o Equipamento deixa o Patrono em branco.",
  "suggestion.workflow.apply": "Usar este Ritual na Missão",
  "suggestion.workflow.applied": "A Missão passou a usar o Ritual sugerido.",
  "suggestion.pressure": "Pressão do Tesouro",

  // ------------------------------------------------------------ run.decision
  "run.departed.policy": "Édito na partida: {reason}",
  "run.departed.routing": "Patrono encaminhado: {name}",
  "run.departed.budgetWarning": "Tesouro {name} perto do teto: {current} de {limit}",
  "run.departed.probe": "A Expedição partiu como sondagem da Sentinela {name}.",
  "run.refused.policy": "Partida recusada por Édito",
  "run.refused.hint": "Ajuste na Rédea da Campanha e tente de novo.",
  "run.refused.open": "Abrir a Rédea",

  // -------------------------------------------------------------- run.origin
  "run.origin": "Origem",
  "run.origin.user": "Mestre da Guilda",
  "run.origin.policy": "Édito",
  "run.origin.delegation": "Delegação",
  "run.parent": "Expedição mãe",
  "run.parentStep": "Passo que delegou",
  "run.children.title": "Expedições filhas",
  "run.children.empty": "Nenhuma Expedição filha.",
  "run.model.selectedBy": "Patrono escolhido por",
  "run.model.loadout": "pelo Equipamento",
  "run.model.harnessDefault": "padrão da Guilda",

  // ------------------------------------------------------------- task.origin
  "task.origin.user": "Criada pelo Mestre da Guilda",
  "task.origin.proposal": "Nascida de uma Pista aprovada",
  "task.origin.policy": "Criada por Édito",
  "task.origin.policy.short": "por Édito",
  "task.origin.delegation": "Aberta por delegação de um Herói",
  "proposal.autoApproved": "Aprovada por Édito",

  // -------------------------------------------------------------- diagnostic
  "diagnostic.policyDecided": "Édito",
  "diagnostic.budgetWarned": "Tesouro",
  "diagnostic.budgetExceeded": "Tesouro no teto",
  "diagnostic.modelRouted": "Encaminhamento",
  "diagnostic.breakerProbe": "Sondagem",
  "diagnostic.breakerOpen": "Sentinela",

  // ------------------------------------------------------ approval.decidedBy
  "approval.decidedBy.user": "pelo Mestre da Guilda",
  "approval.decidedBy.policy": "pelo Édito {name}",

  // -------------------------------------------------------------- settings
  "settings.theme.toggle": "Tema Dungeon Master",
  "settings.theme.description": "Vocabulário de RPG na interface. Desligue para nomes neutros.",
  "settings.knowledge.title": "Grimório",
  "settings.knowledge.description":
    "Como o Escriba do Grimório escreve as Páginas de cada Campanha, e quando.",
  "settings.knowledge.humanReview": "Selo do Escriba",
  "settings.knowledge.humanReview.description":
    "Ligado, toda Página que o Escriba promover espera o seu Selo antes de entrar no Grimório. Desligado, ela entra direto.",
  "settings.knowledge.loadout": "Equipamento do Escriba",
  "settings.knowledge.loadout.description":
    "O Escriba não executa nada: lê o prompt e responde JSON. Por isso o Equipamento precisa de uma Guilda com saída estruturada.",
  "settings.knowledge.loadout.default": "O semeado: {name}",
  "settings.knowledge.loadout.noStructuredOutput": "sem saída estruturada",
  "settings.knowledge.every": "Cadência do Escriba",
  "settings.knowledge.every.description":
    "A cada quantos minutos o Escriba varre os candidatos pendentes de todas as Campanhas. Entre 1 e 1440.",
  "settings.knowledge.forgeEvery": "Intervalo entre forjadas",
  "settings.knowledge.forgeEvery.description":
    "Quantas Expedições precisam terminar entre duas Conquistas forjadas, para a forja continuar rara. Entre 1 e 10000.",
  "settings.knowledge.saved": "O Grimório foi configurado.",
  "settings.context.title": "Provisões",
  "settings.context.description":
    "O que o Herói leva do Grimório para cada Expedição, e quanto. Montado uma vez por Expedição, na partida.",
  "settings.context.enabled": "Arrumar as provisões",
  "settings.context.enabled.description":
    "Ligado, toda Expedição parte com o Resumo da Campanha, os Decretos, as Páginas relevantes, as Missões relacionadas e os Espólios anteriores no prompt. Desligado, o Herói parte só com a Missão.",
  "settings.context.budgetTokens": "Orçamento de tokens",
  "settings.context.budgetTokens.description":
    "Teto estimado do bloco inteiro, moldura incluída. O que não cabe fica de fora, e o cockpit mostra o quê. Entre 1000 e 200000.",
  "settings.context.maxKnowledgeItems": "Teto de Páginas",
  "settings.context.maxKnowledgeItems.description":
    "Quantas Páginas relevantes do Grimório entram, no máximo. Entre 0 e 50; 0 desliga a seção.",
  "settings.context.maxDecisions": "Teto de Decretos",
  "settings.context.maxDecisions.description":
    "Quantos Decretos recentes entram, no máximo. Entre 0 e 50; 0 desliga a seção.",
  "settings.context.maxArtifacts": "Teto de Espólios",
  "settings.context.maxArtifacts.description":
    "Quantos Espólios de Expedições anteriores entram, no máximo. Entre 0 e 100; 0 desliga a seção.",
  "settings.context.saved": "As provisões foram configuradas.",
  "settings.prices.title": "Preços",
  "settings.prices.description":
    "Quanto cobra cada Patrono, por milhão de tokens, e como cada Patronato fatura. Sem preço cadastrado, a Torre de Vigia diz que não mediu — nunca que custou zero.",
  "settings.prices.model": "Patrono",
  "settings.prices.currency": "Moeda",
  "settings.prices.input": "Entrada",
  "settings.prices.output": "Saída",
  "settings.prices.cacheRead": "Leitura de cache",
  "settings.prices.cacheWrite": "Escrita de cache",
  "settings.prices.effectiveFrom": "Vigente desde",
  "settings.prices.perMillion": "por 1 milhão de tokens",
  "settings.prices.none": "sem preço",
  "settings.prices.empty": "Nenhum Patrono cadastrado ainda.",
  "settings.prices.open": "Abrir vigência",
  "settings.prices.openTitle": "Nova vigência de {model}",
  "settings.prices.note": "Anotação",
  "settings.prices.save": "Abrir a vigência",
  "settings.prices.saved": "A vigência de {model} foi aberta.",
  "settings.prices.history": "Histórico de {model}",
  "settings.prices.history.current": "vigência corrente",
  "settings.prices.history.empty": "Este Patrono nunca teve preço cadastrado.",
  "settings.prices.providers": "Como cada Patronato fatura",
  "settings.prices.providers.description":
    "Por token, a conta sai do preço do Patrono. Por assinatura, a mensalidade é rateada pela fatia de tokens do mês.",
  "settings.prices.providers.empty": "Nenhum Patronato cadastrado ainda.",
  "settings.prices.savedProvider": "O faturamento de {provider} foi salvo.",

  // --------------------------------------------------------- provider.billing
  "provider.billing.kind": "Faturamento",
  "provider.billing.perToken": "Por token",
  "provider.billing.subscription": "Assinatura",
  "provider.billing.unknown": "Desconhecido",
  "provider.billing.monthlyCost": "Mensalidade",
  "provider.billing.currency": "Moeda",
  "provider.billing.estimateNote":
    "O custo de uma assinatura é estimativa: a mensalidade é rateada pela fatia de tokens deste Patronato no mês civil, e muda até o mês fechar.",

  // -------------------------------------------------------------- metrics
  "metrics.description":
    "O que as Expedições consumiram na janela, e de onde cada número saiu. Um valor que não foi medido aparece como não medido, nunca como zero.",
  "metrics.window": "Janela",
  "metrics.window.d7": "7 dias",
  "metrics.window.d30": "30 dias",
  "metrics.window.d90": "90 dias",
  "metrics.range": "de {from} a {to}, em UTC",
  "metrics.empty.title": "Nenhuma Expedição terminou ainda",
  "metrics.empty.description":
    "A Torre de Vigia só enxerga Expedição acabada e já projetada. Mande uma partir e volte aqui quando ela terminar.",
  "metrics.tile.runs": "Expedições",
  "metrics.tile.successRate": "Taxa de vitória",
  "metrics.tile.tokens": "Tokens",
  "metrics.tile.cost": "Custo",
  "metrics.tile.duration": "Duração",
  "metrics.tile.breakers": "Sentinelas abertas",
  "metrics.tile.workers": "Workers",
  "metrics.runs.succeeded": "Vitórias",
  "metrics.runs.failed": "Derrotas",
  "metrics.runs.timedOut": "Exaustões",
  "metrics.runs.cancelled": "Retiradas",
  "metrics.runs.none": "nenhuma Expedição na janela",
  "metrics.tokens.measured": "{known} de {total} Expedições com tokens medidos",
  "metrics.tokens.input": "Entrada",
  "metrics.tokens.output": "Saída",
  "metrics.tokens.cacheRead": "Leitura de cache",
  "metrics.tokens.cacheWrite": "Escrita de cache",
  "metrics.tokens.unknown": "a Guilda não reportou tokens",
  "metrics.cost.status.priced": "preço vigente",
  "metrics.cost.status.estimated": "rateio de assinatura",
  "metrics.cost.status.notMeasured": "não medido",
  "metrics.cost.nothingPriced": "nada precificado na janela",
  "metrics.cost.notMeasuredRuns": "{n} sem custo medido",
  "metrics.cost.subscriptionNote":
    "Assinatura é estimativa rateada pelos tokens do mês, e nunca é somada ao preço por token.",
  "metrics.duration.average": "Média",
  "metrics.duration.p95": "p95",
  "metrics.duration.max": "Máxima",
  "metrics.duration.measured": "{n} Expedições medidas",
  "metrics.breakers.open": "de {total} ligadas",
  "metrics.workers.online": "ativos",
  "metrics.workers.stale": "silenciosos",
  "metrics.workers.offline": "desligados",
  "metrics.series.title": "Por dia",
  "metrics.series.metric": "Medida",
  "metrics.series.dimension": "Quebra por",
  "metrics.series.empty": "Nada para desenhar nesta janela.",
  "metrics.series.chartLabel": "{metric} por dia, quebrada por {dimension}",
  "metrics.series.day": "Dia",
  "metrics.series.total": "Total",
  "metrics.series.table": "A mesma série em tabela",
  "metrics.metric.runs": "Expedições",
  "metrics.metric.tokens": "Tokens",
  "metrics.metric.duration": "Duração",
  "metrics.metric.cost": "Custo",
  "metrics.dimension.all": "Tudo somado",
  "metrics.dimension.project": "Campanha",
  "metrics.dimension.harness": "Guilda",
  "metrics.dimension.model": "Patrono",
  "metrics.dimension.provider": "Patronato",
  "metrics.dimension.loadout": "Equipamento",
  "metrics.dimension.createdBy": "Quem mandou partir",
  "metrics.dimension.taskKind": "Tipo de Missão",
  "metrics.dimension.executionMode": "Modo de execução",
  "metrics.breakdown.title": "Quebra por {dimension}",
  "metrics.breakdown.empty": "Nenhuma linha nesta dimensão.",
  "metrics.worker.title": "Workers",
  "metrics.worker.description":
    "Cada processo que bate o coração no banco, o que ele ainda segura e as Guildas que ele autenticou no boot.",
  "metrics.worker.empty": "Nenhum Worker se apresentou ainda.",
  "metrics.worker.status.online": "Ativo",
  "metrics.worker.status.stale": "Silencioso",
  "metrics.worker.status.offline": "Desligado",
  "metrics.worker.host": "Máquina",
  "metrics.worker.pid": "PID",
  "metrics.worker.version": "Versão",
  "metrics.worker.lastHeartbeat": "Último batimento",
  "metrics.worker.runningRuns": "Expedições em curso",
  "metrics.worker.capacity": "Teto",
  "metrics.worker.harnesses": "Guildas",
  "metrics.project.title": "Medidas da Campanha",
  "metrics.project.open": "Abrir a Torre de Vigia",
  "metrics.project.subscriptionNote":
    "O rateio de assinatura não desce ao nível de Campanha: aqui as Expedições de Patronato por assinatura entram como não medidas.",

  // ------------------------------------------------------------ run.metrics
  "run.tab.overview": "A Expedição",
  "run.tab.metrics": "Medidas",
  "run.metrics.empty":
    "Esta Expedição ainda não foi medida. A quebra aparece quando ela termina e o projetor passa.",
  "run.metrics.tokens": "Tokens",
  "run.metrics.context": "Provisões contra prompt",
  "run.metrics.context.estimated": "Tokens estimados do bloco",
  "run.metrics.context.items": "Itens",
  "run.metrics.context.sections": "Seções",
  "run.metrics.context.truncations": "Cortes por orçamento",
  "run.metrics.context.none": "Esta Expedição partiu sem provisões.",
  "run.metrics.tools": "Itens por Relíquia",
  "run.metrics.tools.native": "da própria Guilda",
  "run.metrics.tools.empty": "Nenhum Item foi usado.",
  "run.metrics.steps": "Passos do Ritual",
  "run.metrics.steps.empty": "Esta Expedição não seguiu Ritual.",
  "run.metrics.gates": "Selos concedidos",
  "run.metrics.gates.user": "pelo Mestre da Guilda",
  "run.metrics.gates.policy": "por Édito",
  "run.metrics.children": "Expedições filhas",
  "run.metrics.timing": "Tempo",
  "run.metrics.timing.duration": "Em execução",
  "run.metrics.timing.queue": "Na fila",
  "run.metrics.cost": "Custo",
};
