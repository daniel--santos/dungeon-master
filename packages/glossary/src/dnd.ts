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

  // -------------------------------------------------------------- knowledge
  "knowledge.scribe": "Escriba do Grimório",
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
};
