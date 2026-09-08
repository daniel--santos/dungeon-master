import {
  loadCatalog,
  loadTemplates,
  type AchievementDefinition,
  type AchievementTemplate,
} from "@dungeon-master/achievements";
import {
  projectAchievements,
  type AchievementProjectionReport,
  type Database,
} from "@dungeon-master/database";
import type { EventsLogger } from "@dungeon-master/events";

import type { Logger } from "./logger.js";

/**
 * O projetor de Conquistas dentro do Worker (planejamento v0.4, Fase 2.5B).
 *
 * Este arquivo é só a ligação: quem lê as fontes, avalia as condições e grava
 * está em `@dungeon-master/database`. O que mora aqui é a decisão de **quando**
 * projetar e a garantia de que projetar nunca alcança a execução de um Run.
 *
 * ## Três regras
 *
 * 1. **Nunca lança.** `projectAchievements` já devolve o erro em vez de
 *    propagá-lo; o `try` daqui é a segunda rede, para o caso de a própria
 *    chamada falhar antes de entrar no contrato dela. Uma Conquista é
 *    cosmética, e um Run não pode cair por causa de um texto numa carta.
 * 2. **Nunca dois ao mesmo tempo.** Dois passes concorrentes disputariam o
 *    mesmo cursor e o mesmo `INSERT` de desbloqueio. Um disparo durante um
 *    passe não empilha um segundo: marca que há trabalho novo, e o passe atual
 *    dá mais uma volta quando terminar.
 * 3. **Nunca segura o tique.** `trigger` volta na hora; quem espera o passe é
 *    o desligamento, por `drain`.
 *
 * O catálogo é lido uma vez, na construção. Ler o arquivo por passe custaria
 * I/O de disco a cada segundo, e o carregador é fail-closed: uma entrada torta
 * fica de fora com log e não derruba o Worker.
 */

export interface AchievementProjectorOptions {
  readonly db: Database;
  readonly userId: string;
  readonly logger?: Logger;
}

export interface AchievementProjector {
  /** Dispara um passe. Não espera, não lança e não empilha. */
  trigger(): void;
  /** Um passe agora, com o relatório. Para o boot e para teste. */
  run(sync?: "always" | "lazy"): Promise<AchievementProjectionReport>;
  /** Espera o passe em andamento, se houver. Chamado no desligamento. */
  drain(): Promise<void>;
}

export interface LoadedCatalog {
  readonly definitions: readonly AchievementDefinition[];
  readonly templates: readonly AchievementTemplate[];
}

/**
 * Lê o catálogo versionado e os templates, e loga o que foi recusado.
 *
 * O carregador nunca lança: uma definição que não passa no schema fica de fora
 * e aparece em `invalid`. Não pode passar em silêncio, e é por isso que o que
 * foi recusado sai no log de boot.
 */
export function loadAchievementCatalog(logger?: EventsLogger): LoadedCatalog {
  const catalog = loadCatalog();
  const templates = loadTemplates();

  const invalid = [
    ...catalog.invalid.map((entry) => ({ source: "catalog", key: entry.key, error: entry.error })),
    ...templates.invalid.map((entry) => ({
      source: "templates",
      key: entry.key,
      error: entry.error,
    })),
  ];

  if (invalid.length > 0) {
    logger?.warn?.({ invalid }, "catálogo de Conquistas com entradas recusadas");
  }

  return { definitions: catalog.valid, templates: templates.valid };
}

export function createAchievementProjector(
  options: AchievementProjectorOptions,
): AchievementProjector {
  const { db, userId, logger } = options;
  const { definitions, templates } = loadAchievementCatalog(logger);

  let emAndamento: Promise<void> | undefined;
  let pendente = false;

  const run = async (sync: "always" | "lazy" = "lazy"): Promise<AchievementProjectionReport> =>
    await projectAchievements(db, {
      userId,
      definitions,
      templates,
      sync,
      ...(logger === undefined ? {} : { logger }),
    });

  /**
   * Um passe, e mais uma volta se algo disparou enquanto ele rodava.
   *
   * Uma falha encerra o laço em vez de tentar de novo na hora: o cursor não
   * avançou, então nada foi perdido, e insistir num banco indisponível só
   * trocaria uma consulta por segundo por um laço apertado.
   */
  const laco = async (): Promise<void> => {
    do {
      pendente = false;

      const relatorio = await run();
      if (!relatorio.ok) {
        logger?.warn(
          { error: relatorio.error },
          "passe do projetor de Conquistas falhou; o cursor não avançou",
        );
        return;
      }

      if (relatorio.unlocked > 0) {
        logger?.info(
          { processed: relatorio.processed, unlocked: relatorio.unlocked },
          "Conquistas desbloqueadas",
        );
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
          logger?.error({ err: error }, "projetor de Conquistas lançou; nenhum Run foi afetado");
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
