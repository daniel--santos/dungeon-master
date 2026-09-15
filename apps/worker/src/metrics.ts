import { METRICS_UPDATED_THROTTLE_MS } from "@dungeon-master/contracts";
import {
  emitMetricsUpdated,
  projectMetrics,
  type Database,
  type MetricProjectionReport,
} from "@dungeon-master/database";

import type { Logger } from "./logger.js";

/**
 * O projetor de métricas dentro do Worker (planejamento v0.4, Fase 10A).
 *
 * Este arquivo é só a ligação, como `achievements.ts`: quem lê `run`,
 * `run_event` e `run_context` e grava `run_metric` e `metric_daily` está em
 * `@dungeon-master/database`. O que mora aqui é **quando** projetar, e a
 * garantia de que projetar nunca alcança a execução de um Run.
 *
 * As três regras são as mesmas do projetor de Conquistas, e pelos mesmos
 * motivos: nunca lança, nunca dois passes ao mesmo tempo, nunca segura o tique.
 *
 * ## O anúncio é por lote, com garganta
 *
 * `metrics.updated` sai no máximo uma vez a cada
 * {@link METRICS_UPDATED_THROTTLE_MS} por usuário, e **não** um por Run. A tela
 * de métricas é um agregado: dez Expedições terminando juntas mudam os mesmos
 * tiles uma vez só, e dez eventos custariam dez invalidações de consulta para
 * mostrar exatamente o mesmo número.
 *
 * A garganta mora aqui, e não no pacote de banco, porque quem sabe quanto tempo
 * passou desde o anúncio anterior é o processo que anunciou; guardar isso no
 * repositório obrigaria o pacote de banco a ter estado de processo.
 */

export interface MetricProjectorOptions {
  readonly db: Database;
  readonly userId: string;
  readonly logger?: Logger;
  /** Intervalo mínimo entre dois `metrics.updated`. Zero desliga a garganta. */
  readonly throttleMs?: number;
  readonly now?: () => number;
}

export interface MetricProjector {
  /** Dispara um passe. Não espera, não lança e não empilha. */
  trigger(): void;
  /** Um passe agora, com o relatório. Para o boot e para teste. */
  run(): Promise<MetricProjectionReport>;
  /** Espera o passe em andamento, se houver. Chamado no desligamento. */
  drain(): Promise<void>;
}

export function createMetricProjector(options: MetricProjectorOptions): MetricProjector {
  const { db, userId, logger } = options;
  const throttleMs = options.throttleMs ?? METRICS_UPDATED_THROTTLE_MS;
  const agora = options.now ?? (() => Date.now());

  let emAndamento: Promise<void> | undefined;
  let pendente = false;
  /** Quando o último `metrics.updated` saiu. `-Infinity` faz o primeiro sair na hora. */
  let ultimoAnuncio = Number.NEGATIVE_INFINITY;

  const run = async (): Promise<MetricProjectionReport> =>
    await projectMetrics(db, { userId, ...(logger === undefined ? {} : { logger }) });

  /**
   * Anuncia, se a garganta deixar.
   *
   * Um lote que não anuncia não perde nada: o passe seguinte que couber na
   * janela anuncia por ele, e o que a tela lê é sempre o estado atual, não um
   * delta. Falhar aqui também não é fatal — a projeção já está gravada.
   */
  const anunciar = async (relatorio: MetricProjectionReport): Promise<void> => {
    if (relatorio.runs === 0) return;
    const instante = agora();
    if (instante - ultimoAnuncio < throttleMs) return;
    ultimoAnuncio = instante;

    try {
      await emitMetricsUpdated(db, {
        userId,
        runs: relatorio.runs,
        buckets: relatorio.buckets,
      });
    } catch (error) {
      logger?.warn(
        { err: error },
        "não consegui anunciar metrics.updated; a projeção está gravada",
      );
    }
  };

  const laco = async (): Promise<void> => {
    do {
      pendente = false;

      const relatorio = await run();
      if (!relatorio.ok) {
        logger?.warn(
          { error: relatorio.error },
          "passe do projetor de métricas falhou; o cursor não avançou",
        );
        return;
      }

      await anunciar(relatorio);

      if (relatorio.runs > 0) {
        logger?.info({ runs: relatorio.runs, buckets: relatorio.buckets }, "métricas projetadas");
      }
    } while (pendente);
  };

  return {
    trigger: () => {
      if (emAndamento !== undefined) {
        pendente = true;
        return;
      }

      emAndamento = (async () => {
        try {
          await laco();
        } catch (error) {
          logger?.error({ err: error }, "projetor de métricas lançou; nenhum Run foi afetado");
        } finally {
          emAndamento = undefined;
        }
      })();
    },

    run,

    drain: async () => {
      await emAndamento;
    },
  };
}
