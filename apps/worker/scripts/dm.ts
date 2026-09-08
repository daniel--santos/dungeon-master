import "dotenv/config";

import {
  countAchievementDefinitions,
  createDatabase,
  type Database,
  listDistillationRuns,
  listForgedAchievements,
  listKnowledgeItems,
  listProjectsWithPendingCandidates,
  LOCAL_USER_ID,
  rebuildAchievements,
  resolveDatabaseUrl,
} from "@dungeon-master/database";
import {
  createAgentRuntime,
  createHarnessRegistry,
  createWorkspaceManager,
  createWorkspaceResolver,
} from "@dungeon-master/runtime";
import { antigravityHostAdapters } from "@dungeon-master/runtime-antigravity";
import { hostAdapters } from "@dungeon-master/runtime-sandcastle";

import { loadAchievementCatalog } from "../src/achievements.js";
import { createKnowledgeDistiller, createScribeRuntime } from "../src/distiller.js";

/**
 * `pnpm dm <assunto> <comando>` — a linha de comando do operador.
 *
 * - `pnpm dm achievements rebuild` zera progresso, desbloqueios, estatísticas
 *   e cursores, e reprojeta tudo do início (planejamento v0.4, Fase 2.5B).
 * - `pnpm dm knowledge distill [--project <id>] [--summary]` roda um lote do
 *   Distiller agora, para o Project dado ou para todos os que têm candidato
 *   `PENDING`, com o mesmo Escriba que o Worker usa (Fase 6). `--summary`
 *   força a regeneração do resumo. O advisory lock vale: se o Worker estiver
 *   no meio de um lote do mesmo Project, este é pulado.
 * - `pnpm dm knowledge status` mostra os pendentes por Project, os itens por
 *   estado, os últimos lotes e as forjadas em revisão.
 *
 * Mora no Worker, e não no pacote de banco, porque quem projeta e quem
 * destila é o Worker: os comandos leem o mesmo catálogo e montam o mesmo
 * runtime. Duas composições seriam duas verdades.
 */

const USO = [
  "uso:",
  "  pnpm dm achievements rebuild",
  "  pnpm dm knowledge distill [--project <id>] [--summary]",
  "  pnpm dm knowledge status",
].join("\n");

function fail(message: string): never {
  console.error(`[dm] ${message}`);
  console.error(USO);
  process.exit(1);
}

const [assunto, comando, ...resto] = process.argv.slice(2);

if (assunto === undefined) fail("faltou o assunto.");

const handle = createDatabase({
  url: resolveDatabaseUrl(),
  max: 2,
  applicationName: "dungeon-master-dm",
});

try {
  if (assunto === "achievements") {
    if (comando !== "rebuild")
      fail(`comando desconhecido para achievements: ${comando ?? "(nenhum)"}.`);
    if (resto.length > 0) fail(`argumento a mais: ${resto.join(" ")}.`);
    await rebuildConquistas(handle.db);
  } else if (assunto === "knowledge") {
    if (comando === "distill") await destilar(handle.db, resto);
    else if (comando === "status") await status(handle.db);
    else fail(`comando desconhecido para knowledge: ${comando ?? "(nenhum)"}.`);
  } else {
    fail(`assunto desconhecido: ${assunto}.`);
  }
} finally {
  await handle.close();
}

// --------------------------------------------------------------------------

async function rebuildConquistas(db: Database): Promise<void> {
  const { definitions, templates } = loadAchievementCatalog({
    warn: (fields, message) => {
      console.error(`[dm] ${message}`, JSON.stringify(fields));
    },
  });

  const antes = await countAchievementDefinitions(db, { userId: LOCAL_USER_ID });
  console.log(
    `[dm] reconstruindo Conquistas: ${String(antes)} definição(ões) no banco, ` +
      `${String(definitions.length)} do catálogo e ${String(templates.length)} template(s)`,
  );

  const relatorio = await rebuildAchievements(db, {
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
}

function lerOpcoes(args: readonly string[]): { projectId: string | null; summary: boolean } {
  let projectId: string | null = null;
  let summary = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--project") {
      const valor = args[i + 1];
      if (valor === undefined) fail("--project precisa de um id.");
      projectId = valor;
      i += 1;
    } else if (arg === "--summary") {
      summary = true;
    } else {
      fail(`argumento desconhecido: ${arg ?? ""}.`);
    }
  }
  return { projectId, summary };
}

async function destilar(db: Database, args: readonly string[]): Promise<void> {
  const opcoes = lerOpcoes(args);

  const runtime = createAgentRuntime({
    registry: createHarnessRegistry([...hostAdapters(), ...antigravityHostAdapters()]),
    workspace: createWorkspaceResolver({ manager: createWorkspaceManager() }),
  });
  const distiller = createKnowledgeDistiller({
    db,
    userId: LOCAL_USER_ID,
    runtime: createScribeRuntime({ db, userId: LOCAL_USER_ID, runtime }),
  });

  const pendentes = await listProjectsWithPendingCandidates(db, { userId: LOCAL_USER_ID });
  const alvos = opcoes.projectId === null ? pendentes.map((p) => p.projectId) : [opcoes.projectId];

  if (alvos.length === 0) {
    console.log("[dm] nenhum Project com candidatos PENDING; nada a destilar.");
    return;
  }

  for (const projectId of alvos) {
    const pendente = pendentes.find((p) => p.projectId === projectId)?.pending ?? 0;
    console.log(
      `[dm] destilando o Project ${projectId} (${String(pendente)} candidato(s) PENDING)...`,
    );
    // Um lote por chamada; o resto fica para o próximo lote ou para o Worker.
    const outcome = await distiller.distillOnce({
      projectId,
      trigger: "MANUAL",
      regenerateSummary: opcoes.summary,
    });

    if (outcome.kind === "empty") {
      console.log(`[dm] ${projectId}: nenhum candidato PENDING.`);
    } else if (outcome.kind === "locked") {
      console.log(`[dm] ${projectId}: outro lote está com o Project; pulado.`);
    } else {
      const linha =
        `[dm] ${projectId}: lote ${outcome.distillationRunId} ${outcome.status} — ` +
        `${String(outcome.candidateCount)} candidato(s): ${String(outcome.promoted)} promovido(s), ` +
        `${String(outcome.rejected)} rejeitado(s), ${String(outcome.merged)} mesclado(s)` +
        (outcome.summaryRegenerated ? "; resumo regenerado" : "") +
        (outcome.forgedAchievementId === null
          ? ""
          : `; forjada ${outcome.forgedAchievementId} em revisão`) +
        (outcome.pendingLeft ? "; ainda há candidatos PENDING" : "");
      console.log(linha);
      if (outcome.error !== null) {
        console.error(`[dm] erro: ${outcome.error}`);
        process.exitCode = 1;
      }
    }
  }
}

async function status(db: Database): Promise<void> {
  const pendentes = await listProjectsWithPendingCandidates(db, { userId: LOCAL_USER_ID });
  console.log(`[dm] candidatos PENDING por Project: ${pendentes.length === 0 ? "nenhum" : ""}`);
  for (const p of pendentes) {
    console.log(`  ${p.projectId}: ${String(p.pending)} (o mais antigo em ${p.oldestAt})`);
  }

  const porEstado: Record<string, number> = {};
  for (const estado of ["PENDING_REVIEW", "ACTIVE", "REJECTED", "ARCHIVED"] as const) {
    const pagina = await listKnowledgeItems(db, {
      userId: LOCAL_USER_ID,
      page: 1,
      pageSize: 1,
      filters: { status: estado },
    });
    porEstado[estado] = pagina.total;
  }
  console.log(
    `[dm] itens do Grimório: ${Object.entries(porEstado)
      .map(([estado, total]) => `${estado}=${String(total)}`)
      .join(", ")}`,
  );

  const lotes = await listDistillationRuns(db, { userId: LOCAL_USER_ID, page: 1, pageSize: 5 });
  console.log(`[dm] últimos lotes (${String(lotes.total)} no total):`);
  for (const lote of lotes.items) {
    console.log(
      `  ${lote.id} ${lote.status} ${lote.trigger} project=${lote.projectId} ` +
        `candidatos=${String(lote.candidateCount)} +${String(lote.promoted)} -${String(lote.rejected)} ` +
        `~${String(lote.merged)}${lote.summaryRegenerated ? " resumo" : ""}` +
        `${lote.forgedAchievementId === null ? "" : " forjada"}` +
        `${lote.error === null ? "" : ` erro: ${lote.error}`}`,
    );
  }

  const forjadas = await listForgedAchievements(db, { userId: LOCAL_USER_ID });
  console.log(`[dm] forjadas em revisão: ${String(forjadas.length)}`);
  for (const forjada of forjadas) {
    console.log(`  ${forjada.id} «${forjada.name}» (${forjada.provenance.kind})`);
    console.log(`    ${forjada.description}`);
    console.log(`    ${forjada.flavor}`);
  }
}
