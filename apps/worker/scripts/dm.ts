import "dotenv/config";

import {
  countAchievementDefinitions,
  createDatabase,
  LOCAL_USER_ID,
  rebuildAchievements,
  resolveDatabaseUrl,
} from "@dungeon-master/database";

import { loadAchievementCatalog } from "../src/achievements.js";

/**
 * `pnpm dm <assunto> <comando>` — a linha de comando do operador.
 *
 * Hoje um comando só: `pnpm dm achievements rebuild` zera progresso,
 * desbloqueios, estatísticas e cursores, e reprojeta tudo do início
 * (planejamento v0.4, Fase 2.5B).
 *
 * A reconstrução existe porque **toda entrada é durável**: `activity`,
 * `run_event` e `dashboard_event` continuam lá, e o instante gravado em cada
 * desbloqueio é o do fato, não o da gravação. Reconstruir reproduz a mesma
 * crônica, com as mesmas datas — e é isso que o teste do pacote de banco
 * verifica.
 *
 * Mora no Worker, e não no pacote de banco, porque quem projeta é o Worker: o
 * comando lê o mesmo catálogo do disco, com o mesmo carregador fail-closed, e
 * chama a mesma função. Duas cargas de catálogo seriam duas verdades.
 *
 * Rode com o Worker parado. Nada quebra se ele estiver no ar — a unicidade de
 * `(definition_id, user_id, tier)` continua valendo —, mas os dois disputariam
 * o cursor e o relatório sairia sem sentido.
 */

const USO = "uso: pnpm dm achievements rebuild";

function fail(message: string): never {
  console.error(`[dm] ${message}`);
  console.error(USO);
  process.exit(1);
}

const [assunto, comando, ...resto] = process.argv.slice(2);

if (assunto === undefined) fail("faltou o assunto.");
if (assunto !== "achievements") fail(`assunto desconhecido: ${assunto}.`);
if (comando !== "rebuild")
  fail(`comando desconhecido para achievements: ${comando ?? "(nenhum)"}.`);
if (resto.length > 0) fail(`argumento a mais: ${resto.join(" ")}.`);

const { definitions, templates } = loadAchievementCatalog({
  warn: (fields, message) => {
    console.error(`[dm] ${message}`, JSON.stringify(fields));
  },
});

const handle = createDatabase({
  url: resolveDatabaseUrl(),
  max: 1,
  applicationName: "dungeon-master-dm",
});

try {
  const antes = await countAchievementDefinitions(handle.db, { userId: LOCAL_USER_ID });
  console.log(
    `[dm] reconstruindo Conquistas: ${String(antes)} definição(ões) no banco, ` +
      `${String(definitions.length)} do catálogo e ${String(templates.length)} template(s)`,
  );

  const relatorio = await rebuildAchievements(handle.db, {
    userId: LOCAL_USER_ID,
    definitions,
    templates,
  });

  if (!relatorio.ok) {
    // O contrato do projetor é não lançar, então a falha chega como relatório e
    // não como exceção. Sair com 1 é o que faz um script de operação notar.
    console.error(`[dm] a reconstrução falhou: ${relatorio.error ?? "erro desconhecido"}`);
    console.error("[dm] o cursor não avançou; nada foi perdido.");
    process.exitCode = 1;
  } else {
    console.log(
      `[dm] reconstrução concluída: ${String(relatorio.processed)} linha(s) reprocessada(s), ` +
        `${String(relatorio.unlocked)} desbloqueio(s) gravado(s)`,
    );
  }
} finally {
  await handle.close();
}
