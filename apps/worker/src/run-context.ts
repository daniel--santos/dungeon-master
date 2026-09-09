import { assembleRunContext } from "@dungeon-master/context";
import type { RunContext } from "@dungeon-master/contracts";
import {
  type ClaimedRun,
  createDatabaseContextStore,
  type Database,
  findTaskRow,
  getRunContext,
  readUserSettings,
  saveRunContext,
} from "@dungeon-master/database";

import type { Logger } from "./logger.js";
import type { RunOutcomeWriter } from "./run-writers.js";

/**
 * O Context Engine dentro do Worker (planejamento v0.4, Fase 7).
 *
 * O que decide o que entra no bloco mora em `@dungeon-master/context`; o que
 * lê as tabelas mora em `@dungeon-master/database`. O que mora aqui é a
 * fiação e o **quando**: uma vez por Run, quando o Worker o reclama, antes
 * da primeira chamada ao agente — e nunca de novo.
 *
 * Três caminhos, nesta ordem:
 *
 * 1. **Já existe `run_context` para o Run.** É a retomada — o Run voltou da
 *    fila depois de um gate, ou de um restart — e o texto gravado vale. Montar
 *    de novo poderia produzir outro texto (o Grimório mudou), e o cache de
 *    prompt do provedor só sobrevive ao texto idêntico (documento técnico,
 *    seção 20.1).
 * 2. **O Run retoma a sessão de outro.** A conversa continua, e recebe o
 *    contexto que já tinha: o registro do Run de origem é copiado, com o
 *    vínculo em `inheritedFromRunId`. Só quando aquele contexto foi montado de
 *    verdade; um `FAILED` ou `DISABLED` na origem não é o que a conversa
 *    "já tinha", e o Run monta o seu.
 * 3. **Primeira vez.** Configurações e Loadout viram política, o montador
 *    roda sobre o store do banco, e o resultado é gravado com
 *    `ON CONFLICT DO NOTHING` — o primeiro texto gravado vence.
 *
 * Observabilidade nunca derruba execução: cada caminho termina num
 * `Diagnostic` no diário do Run, e qualquer falha daqui — banco, montador,
 * gravação — vira um `Diagnostic` de aviso e um prompt **sem** contexto.
 * Nunca um contexto parcial em silêncio.
 */

export interface ResolveRunContextInput {
  readonly db: Database;
  readonly userId: string;
  readonly claimed: ClaimedRun;
  readonly writer: RunOutcomeWriter;
  readonly logger?: Logger | undefined;
}

/** O bloco a inserir no prompt. Vazio quando o Run segue sem contexto. */
export async function resolveRunContext(input: ResolveRunContextInput): Promise<string> {
  const { db, userId, claimed, writer, logger } = input;
  const { run } = claimed;

  try {
    // 1. Retomada: o registro vale, e é o mesmo texto para todos os passos.
    const existente = await getRunContext(db, { userId, runId: run.id });
    if (existente !== null) {
      await writer.diagnostic(
        "INFO",
        `Contexto relido do registro do Run (${describeStatus(existente)}): o mesmo texto ` +
          "para todos os passos.",
      );
      return existente.text;
    }

    // 2. Retomada de sessão: a conversa continua com o contexto que já tinha.
    //
    // post-mortem #24 (08/09/2026): a herança exigia `ASSEMBLED`, e os outros
    // três status caíam na montagem do caminho 3. Mas em `EMPTY`, `DISABLED` e
    // `FAILED` o Run de origem rodou **sem bloco de contexto**: montar agora
    // insere no meio de uma conversa em curso um texto que o agente não viu
    // nascer, e que muda conforme o Grimório mudou desde então. O que herda não
    // é o texto montado, é o que a conversa já tinha — inclusive quando era nada.
    if (run.resumedFromRunId !== null) {
      const origem = await getRunContext(db, { userId, runId: run.resumedFromRunId });
      if (origem !== null) {
        const herdado: RunContext = {
          ...origem,
          runId: run.id,
          taskId: run.taskId,
          inheritedFromRunId: origem.runId,
        };
        const salvo = await saveRunContext(db, { userId, context: herdado });
        await writer.diagnostic(
          "INFO",
          `Contexto herdado do Run ${origem.runId}, cuja sessão este retoma: a conversa ` +
            `continua com o mesmo texto (${describeStatus(salvo.context)}).`,
        );
        return salvo.context.text;
      }
    }

    // 3. Primeira vez: monta, grava, registra.
    const task = await findTaskRow(db, { userId, taskId: run.taskId });
    if (task === null || task.projectId === null) {
      throw new Error(`A Task ${run.taskId} do Run não existe ou não tem Project.`);
    }
    const settings = await readUserSettings(db, { userId });
    const snapshot = run.loadoutSnapshot;

    const montado = await assembleRunContext(
      {
        run: { id: run.id },
        task: {
          id: task.id,
          projectId: task.projectId,
          title: task.title,
          description: task.description,
          parentTaskId: task.parentTaskId,
        },
        loadout: {
          id: snapshot.loadoutId,
          version: snapshot.version,
          skills: snapshot.skills,
          knowledgePolicy: snapshot.knowledgePolicy,
          contextPolicy: snapshot.contextPolicy,
        },
        settings: {
          enabled: settings["context.enabled"],
          budgetTokens: settings["context.budgetTokens"],
          maxKnowledgeItems: settings["context.maxKnowledgeItems"],
          maxDecisions: settings["context.maxDecisions"],
          maxArtifacts: settings["context.maxArtifacts"],
        },
        now: new Date(),
      },
      createDatabaseContextStore(db, { userId }),
    );

    const { context, created } = await saveRunContext(db, { userId, context: montado });
    if (!created) {
      // Alguém gravou entre a leitura e a escrita: o registro vence, sempre.
      await writer.diagnostic(
        "INFO",
        `Contexto relido do registro do Run (${describeStatus(context)}): outra montagem ` +
          "chegou antes e é a que vale.",
      );
      return context.text;
    }

    switch (context.status) {
      case "ASSEMBLED":
        await writer.diagnostic("INFO", `Contexto montado: ${describeStatus(context)}.`);
        break;
      case "EMPTY":
        await writer.diagnostic(
          "INFO",
          "Contexto vazio: nada no Grimório, na linhagem nem nos Runs anteriores diz respeito " +
            `a esta Task (${describeStatus(context)}). O Run segue sem contexto.`,
        );
        break;
      case "DISABLED":
        await writer.diagnostic(
          "INFO",
          "Context Engine desligado (`context.enabled` = false). O Run segue sem contexto.",
        );
        break;
      case "FAILED":
        await writer.diagnostic(
          "WARN",
          "A montagem do contexto falhou; o Run segue sem contexto, e não com contexto parcial.",
          context.error ?? undefined,
        );
        break;
    }
    return context.text;
  } catch (error) {
    logger?.error(
      { err: error, runId: run.id },
      "o Context Engine falhou; o Run segue sem contexto",
    );
    await writer.diagnostic(
      "WARN",
      "O Context Engine falhou antes de gravar o registro; o Run segue sem contexto.",
      error instanceof Error ? error.message : String(error),
    );
    return "";
  }
}

function describeStatus(context: RunContext): string {
  const secoes = context.sections.filter((section) => section.items.length > 0).length;
  const origem =
    `Loadout ${context.policy.source.loadout.id} v${String(context.policy.source.loadout.version)} ` +
    "+ configurações";
  return (
    `${context.status}, ${String(context.usage.itemCount)} item(ns) em ${String(secoes)} seção(ões), ` +
    `~${String(context.usage.estimatedTokens)} de ${String(context.budget.totalTokens)} tokens, ` +
    `${String(context.usage.excludedCount)} excluído(s) por orçamento; ${origem}`
  );
}
