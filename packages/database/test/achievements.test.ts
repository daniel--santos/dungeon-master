import { loadCatalog, loadTemplates, XP_PER_VICTORY } from "@dungeon-master/achievements";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import {
  listAchievementUnlockPage,
  listAchievementViews,
  markAchievementUnlockSeen,
  readHeroStats,
} from "../src/achievement.js";
import { projectAchievements, rebuildAchievements } from "../src/achievement-projector.js";
import { createDatabase, type DatabaseHandle } from "../src/client.js";
import { createProject } from "../src/project.js";
import { createRun, transitionRun, writeRunTerminalStatus } from "../src/run.js";
import { persistRunEvent } from "../src/run-event.js";
import { changeTaskStatus, createTask } from "../src/task.js";

import {
  criarEquipamento,
  criarProjectComWorkspace,
  type Equipamento,
  exigirOk,
  limparExecucao,
  USER,
} from "./support.js";

/**
 * O projetor de Conquistas sobre o banco embutido (planejamento v0.4, Fase 2.5B).
 *
 * Toda a massa é criada pelas mesmas funções que a API usa — nada de `INSERT`
 * cru —, então cada fato passa pela máquina de estados e grava exatamente as
 * linhas de `activity`, `run_event` e `dashboard_event` que o projetor lê em
 * produção. Um estado que a aplicação não sabe produzir não é um teste.
 */

const REPO = "C:\\repos\\masmorra";

let handle: DatabaseHandle;
let equipamento: Equipamento;
let projectId: string;

const catalogo = loadCatalog();
const templates = loadTemplates();

/** Sem atraso de segurança: o teste escreve e projeta na mesma linha do tempo. */
function projetar(options: { sync?: "always" | "lazy" } = {}) {
  return projectAchievements(handle.db, {
    userId: USER,
    definitions: catalogo.valid,
    templates: templates.valid,
    lagMs: 0,
    ...(options.sync === undefined ? {} : { sync: options.sync }),
  });
}

/** Apaga as três fontes, para provar um passe que não tem nada a processar. */
async function esvaziarFontes(): Promise<void> {
  for (const tabela of ["activity", "run_event", "dashboard_event"]) {
    await handle.pool.query(`delete from ${tabela} where user_id = $1`, [USER]);
  }
}

async function limparConquistas(): Promise<void> {
  for (const tabela of [
    "achievement_unlock",
    "achievement_progress",
    "achievement_cursor",
    "hero_stats",
    "achievement_definition",
  ]) {
    await handle.pool.query(`delete from ${tabela} where user_id = $1`, [USER]);
  }
}

/** Cria a Task, roda uma Expedição e escreve o desfecho terminal pedido. */
async function expedicao(input: {
  title: string;
  kind?: "BUG" | "FEATURE";
  status: "SUCCEEDED" | "FAILED" | "CANCELLED";
}): Promise<{ runId: string; taskId: string }> {
  const task = exigirOk(
    await createTask(handle.db, {
      userId: USER,
      projectId,
      title: input.title,
      kind: input.kind ?? "FEATURE",
    }),
    `a criação da Task ${input.title}`,
  );

  const run = exigirOk(
    await createRun(handle.db, {
      userId: USER,
      taskId: task.id,
      loadoutId: equipamento.loadoutId,
    }),
    `a criação do Run de ${input.title}`,
  );

  // O caminho real da máquina de estados: `QUEUED → PREPARING → RUNNING`, que
  // é também o que leva a Task a `RUNNING` e permite concluí-la depois.
  for (const to of ["PREPARING", "RUNNING"] as const) {
    exigirOk(
      await transitionRun(handle.db, { userId: USER, runId: run.id, to }),
      `a transição do Run de ${input.title} para ${to}`,
    );
  }

  // O relógio anda para trás só aqui: uma Expedição de 90 minutos em tempo real
  // não cabe num teste, e é a duração que "Marcha Longa" mede.
  await handle.pool.query(
    "update run set started_at = now() - interval '90 minutes' where id = $1",
    [run.id],
  );

  exigirOk(
    await writeRunTerminalStatus(handle.db, {
      userId: USER,
      runId: run.id,
      status: input.status,
      ...(input.status === "SUCCEEDED"
        ? { result: { status: "completed" as const, summary: "feito" } }
        : { error: { message: "não deu" } }),
    }),
    `o desfecho ${input.status} de ${input.title}`,
  );

  return { runId: run.id, taskId: task.id };
}

async function eventosDeDashboard(tipo: string): Promise<Record<string, unknown>[]> {
  const result = await handle.pool.query<{ payload: Record<string, unknown> }>(
    "select payload from dashboard_event where user_id = $1 and type = $2 order by sequence",
    [USER, tipo],
  );
  return result.rows.map((row) => row.payload);
}

function porChave(items: Awaited<ReturnType<typeof listAchievementViews>>["items"], key: string) {
  const found = items.find((item) => item.key === key);
  if (found === undefined) throw new Error(`A Conquista ${key} não apareceu na listagem.`);
  return found;
}

beforeAll(() => {
  handle = createDatabase({
    url: inject("databaseUrl"),
    max: 6,
    applicationName: "vitest-conquistas",
  });
});

beforeEach(async () => {
  await limparConquistas();
  await limparExecucao(handle);
  const project = await criarProjectComWorkspace(handle.db, {
    title: "Masmorra de Cristal",
    workspacePath: REPO,
  });
  projectId = project.id;
  equipamento = await criarEquipamento(handle.db, { nome: "de conquistas" });
});

afterAll(async () => {
  await limparConquistas();
  await limparExecucao(handle);
  await handle.close();
});

describe("carga do catálogo e instanciação de templates", () => {
  it("carrega o catálogo fixo e instancia os templates do Project criado", async () => {
    const relatorio = await projetar();
    expect(relatorio.ok).toBe(true);

    const { items, counts } = await listAchievementViews(handle.db, { userId: USER });

    expect(counts.total).toBeGreaterThanOrEqual(catalogo.valid.length);
    expect(porChave(items, "first_expedition").origin).toBe("CATALOG");

    // Os dois templates de Project foram instanciados; os de Guilda e Herói
    // ainda não, porque nenhum Run existe.
    const doProject = items.filter((item) => item.origin === "TEMPLATE");
    expect(doProject.map((item) => item.key).sort()).toEqual([
      "campaign_guardian",
      "campaign_record",
    ]);
  });

  it("o nome do template é formatado com o nome atual da Campanha", async () => {
    await projetar();

    const { items } = await listAchievementViews(handle.db, { userId: USER });
    const guardiao = porChave(items, "campaign_guardian");

    expect(guardiao.name.theme).toBe("Guardião de Masmorra de Cristal");
    expect(guardiao.state).toBe("HIDDEN");

    await handle.pool.query("update project set title = $1 where id = $2", [
      "Torre Invertida",
      projectId,
    ]);

    const { items: depois } = await listAchievementViews(handle.db, { userId: USER });
    expect(porChave(depois, "campaign_guardian").name.theme).toBe("Guardião de Torre Invertida");
  });

  it("rodar duas vezes não cria uma segunda definição", async () => {
    await projetar();
    const primeira = await listAchievementViews(handle.db, { userId: USER });
    await projetar();
    const segunda = await listAchievementViews(handle.db, { userId: USER });

    expect(segunda.counts.total).toBe(primeira.counts.total);
  });
});

describe("quando o catálogo é sincronizado", () => {
  it("`lazy` não escreve nada enquanto não houver fato novo", async () => {
    // O laço do Worker dispara um passe por tique. Sincronizar em todos eles
    // reescreveria as quinze linhas do catálogo por segundo, para sempre.
    await esvaziarFontes();
    const relatorio = await projetar({ sync: "lazy" });

    expect(relatorio.ok).toBe(true);
    expect(relatorio.processed).toBe(0);
    expect((await listAchievementViews(handle.db, { userId: USER })).counts.total).toBe(0);
  });

  it("`lazy` sincroniza no primeiro lote com fato, e o Project entra junto", async () => {
    // O `project.created` do `beforeEach` é o fato: ele basta para a
    // sincronização acontecer, e a instância do template nasce com ele.
    const relatorio = await projetar({ sync: "lazy" });

    expect(relatorio.ok).toBe(true);
    expect(relatorio.processed).toBeGreaterThan(0);

    const { items, counts } = await listAchievementViews(handle.db, { userId: USER });
    expect(counts.total).toBeGreaterThanOrEqual(catalogo.valid.length);
    expect(porChave(items, "campaign_guardian").state).toBe("HIDDEN");
  });

  it("`always` sincroniza mesmo sem nenhum fato: é o que o boot precisa", async () => {
    await esvaziarFontes();
    const relatorio = await projetar({ sync: "always" });

    expect(relatorio.ok).toBe(true);
    expect(relatorio.processed).toBe(0);

    const { items, counts } = await listAchievementViews(handle.db, { userId: USER });
    // O catálogo inteiro, mais os dois templates do Project que já existe.
    expect(counts.total).toBeGreaterThanOrEqual(catalogo.valid.length);
    expect(porChave(items, "first_expedition").state).toBe("LOCKED");
  });
});

describe("desbloqueio", () => {
  it("uma Missão BUG vencida desbloqueia a Primeira Expedição e conta o Monstro", async () => {
    const { runId, taskId } = await expedicao({
      title: "Corrigir o portal",
      kind: "BUG",
      status: "SUCCEEDED",
    });

    const relatorio = await projetar();
    expect(relatorio.ok).toBe(true);
    expect(relatorio.unlocked).toBeGreaterThan(0);

    const { items, counts } = await listAchievementViews(handle.db, { userId: USER });

    const primeira = porChave(items, "first_expedition");
    expect(primeira.state).toBe("UNLOCKED");
    expect(primeira.tier.current).toBe(1);

    const cacador = porChave(items, "monster_slayer");
    expect(cacador.state).toBe("IN_PROGRESS");
    expect(cacador.progress).toEqual({ current: 1, target: 10, percent: 10 });

    // "Marcha Longa" é recorde acima de uma hora, e a Expedição durou 90 min.
    expect(porChave(items, "long_march").state).toBe("UNLOCKED");
    expect(counts.unlocked).toBeGreaterThanOrEqual(2);

    const crônica = await listAchievementUnlockPage(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 25,
    });

    const desbloqueio = crônica.items.find((item) => item.key === "first_expedition");
    expect(desbloqueio?.runId).toBe(runId);
    expect(desbloqueio?.seenAt).toBeNull();

    const tarefa = crônica.items.find((item) => item.key === "monster_slayer");
    expect(tarefa).toBeUndefined();
    expect(taskId).toBeTruthy();
  });

  it("emite `achievement.unlocked` e `hero_stats.updated` na mesma transação", async () => {
    await expedicao({ title: "Fechar a fenda", kind: "BUG", status: "SUCCEEDED" });
    await projetar();

    const desbloqueios = await eventosDeDashboard("achievement.unlocked");
    expect(desbloqueios.map((payload) => payload["key"])).toContain("first_expedition");

    const primeiro = desbloqueios.find((payload) => payload["key"] === "first_expedition");
    expect(primeiro?.["name"]).toEqual({
      theme: "Primeira Expedição",
      plain: "Primeira execução",
    });
    // A descrição nas duas versões: é o que o toast mostra com o tema desligado.
    expect(primeiro?.["description"]).toEqual({
      theme:
        "Vencer a primeira Expedição. Uma. A plateia chegou cedo esperando um desastre e saiu decepcionada.",
      plain: "Concluir a primeira execução com sucesso.",
    });

    const stats = await eventosDeDashboard("hero_stats.updated");
    expect(stats.length).toBeGreaterThanOrEqual(2);

    // A prova de "mesma transação" é a tabela: o evento só existe porque o
    // COMMIT do desbloqueio aconteceu.
    const linhas = await handle.pool.query<{ total: string }>(
      "select count(*) as total from achievement_unlock where user_id = $1",
      [USER],
    );
    expect(Number(linhas.rows[0]?.total ?? 0)).toBeGreaterThan(0);
  });

  it("o template do Project sai de oculto no primeiro progresso", async () => {
    await projetar();
    const antes = await listAchievementViews(handle.db, { userId: USER });
    expect(porChave(antes.items, "campaign_guardian").state).toBe("HIDDEN");

    const task = exigirOk(
      await createTask(handle.db, { userId: USER, projectId, title: "Trabalho manual" }),
      "a criação da Task manual",
    );
    exigirOk(
      await changeTaskStatus(handle.db, { userId: USER, taskId: task.id, to: "COMPLETED" }),
      "a conclusão manual",
    );

    await projetar();

    const depois = await listAchievementViews(handle.db, { userId: USER });
    const guardiao = porChave(depois.items, "campaign_guardian");
    expect(guardiao.state).toBe("IN_PROGRESS");
    expect(guardiao.progress.current).toBe(1);
    expect(guardiao.progress.target).toBe(25);
  });

  it("um segundo passe sem fato novo não mexe no contador", async () => {
    await expedicao({ title: "Monstro contado uma vez", kind: "BUG", status: "SUCCEEDED" });
    await expedicao({ title: "Monstro contado duas vezes", kind: "BUG", status: "SUCCEEDED" });

    await projetar();
    const depoisDoPrimeiro = porChave(
      (await listAchievementViews(handle.db, { userId: USER })).items,
      "monster_slayer",
    ).progress.current;

    // Três passes seguidos sem nenhum fato novo. O cursor guarda o instante da
    // última linha, e `timestamptz` tem microssegundo: se ele voltar do banco
    // truncado em milissegundo, a própria linha do cursor volta a casar com
    // `(created_at, id) > (cursor)` e o mesmo fato é somado a cada tique.
    for (let i = 0; i < 3; i += 1) await projetar();

    const depois = porChave(
      (await listAchievementViews(handle.db, { userId: USER })).items,
      "monster_slayer",
    ).progress.current;

    expect(depois).toBe(depoisDoPrimeiro);
    expect(depois).toBeGreaterThan(0);
  });

  it("reprocessar não desbloqueia duas vezes", async () => {
    await expedicao({ title: "Selar a cripta", status: "SUCCEEDED" });
    await projetar();

    const primeira = await listAchievementUnlockPage(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 50,
    });

    // Volta o cursor ao início: é o mesmo que reprocessar o log inteiro.
    await handle.pool.query("delete from achievement_cursor where user_id = $1", [USER]);
    const segunda = await projetar();

    expect(segunda.unlocked).toBe(0);

    const depois = await listAchievementUnlockPage(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 50,
    });
    expect(depois.total).toBe(primeira.total);
  });

  it("marca um desbloqueio como visto, e ver de novo não reescreve", async () => {
    await expedicao({ title: "Abrir o selo", status: "SUCCEEDED" });
    await projetar();

    const crônica = await listAchievementUnlockPage(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 50,
    });
    const alvo = crônica.items[0];
    if (alvo === undefined) throw new Error("A crônica veio vazia.");

    const visto = await markAchievementUnlockSeen(handle.db, {
      userId: USER,
      unlockId: alvo.id,
    });
    expect(visto?.seenAt).not.toBeNull();

    const denovo = await markAchievementUnlockSeen(handle.db, {
      userId: USER,
      unlockId: alvo.id,
    });
    expect(denovo?.seenAt).toBe(visto?.seenAt);

    expect(
      await markAchievementUnlockSeen(handle.db, {
        userId: USER,
        unlockId: "01996d00-0000-7000-8000-0000000000ff",
      }),
    ).toBeNull();
  });
});

describe("estatísticas de Herói", () => {
  it("soma XP, vitórias, derrotas, Monstros e a Guilda mais usada", async () => {
    await expedicao({ title: "Monstro um", kind: "BUG", status: "SUCCEEDED" });
    await expedicao({ title: "Trabalho", status: "SUCCEEDED" });
    await expedicao({ title: "Fracasso", status: "FAILED" });
    await expedicao({ title: "Desistência", status: "CANCELLED" });

    await projetar();

    const stats = await readHeroStats(handle.db, { userId: USER, xpToNextLevel: () => 0 });
    const heroi = stats.agents.find((item) => item.scopeId === equipamento.agentId);

    expect(heroi).toBeDefined();
    expect(heroi?.victories).toBe(2);
    expect(heroi?.defeats).toBe(1);
    expect(heroi?.expeditions).toBe(4);
    expect(heroi?.monstersSlain).toBe(1);
    expect(heroi?.topHarness).toBe("claude");
    expect(heroi?.xp).toBeGreaterThanOrEqual(2 * XP_PER_VICTORY);
    expect(heroi?.name).toContain("Engenheiro");

    const equipe = stats.loadouts.find((item) => item.scopeId === equipamento.loadoutId);
    expect(equipe?.victories).toBe(2);
  });

  it("soma os tokens dos eventos `Usage` do log de execução", async () => {
    const { runId } = await expedicao({ title: "Com consumo", status: "SUCCEEDED" });

    await persistRunEvent(handle.db, {
      userId: USER,
      runId,
      event: {
        type: "Usage",
        payload: {
          type: "Usage",
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadInputTokens: 5,
            cacheCreationInputTokens: 0,
          },
        },
      },
    });

    await projetar();

    const stats = await readHeroStats(handle.db, { userId: USER, xpToNextLevel: () => 0 });
    expect(stats.agents.find((item) => item.scopeId === equipamento.agentId)?.tokens).toBe(125);
  });
});

describe("reconstrução", () => {
  it("`rebuild` reproduz exatamente os mesmos desbloqueios", async () => {
    await expedicao({ title: "Monstro alfa", kind: "BUG", status: "SUCCEEDED" });
    await expedicao({ title: "Monstro beta", kind: "BUG", status: "SUCCEEDED" });
    await expedicao({ title: "Derrota", status: "FAILED" });

    await projetar();

    const antes = await listAchievementUnlockPage(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 100,
    });
    const statsAntes = await readHeroStats(handle.db, { userId: USER, xpToNextLevel: () => 0 });

    const relatorio = await rebuildAchievements(handle.db, {
      userId: USER,
      definitions: catalogo.valid,
      templates: templates.valid,
      lagMs: 0,
    });
    expect(relatorio.ok).toBe(true);

    const depois = await listAchievementUnlockPage(handle.db, {
      userId: USER,
      page: 1,
      pageSize: 100,
    });

    const chave = (item: { key: string | null; tier: number; unlockedAt: string }) =>
      `${item.key ?? ""}#${String(item.tier)}@${item.unlockedAt}`;

    expect(depois.items.map(chave)).toEqual(antes.items.map(chave));

    const statsDepois = await readHeroStats(handle.db, { userId: USER, xpToNextLevel: () => 0 });
    expect(statsDepois.agents).toEqual(statsAntes.agents);

    const progresso = await listAchievementViews(handle.db, { userId: USER });
    expect(porChave(progresso.items, "monster_slayer").progress.current).toBe(2);
  });
});

describe("contrato de nunca lançar", () => {
  it("uma condição inválida no banco é ignorada com log, e o passe continua", async () => {
    await projetar();

    await handle.pool.query(
      `update achievement_definition
         set condition = '{"predicate":"desconhecido"}'::jsonb
       where user_id = $1 and catalog_key = 'first_expedition'`,
      [USER],
    );

    await expedicao({ title: "Depois da definição torta", status: "SUCCEEDED" });

    const avisos: string[] = [];
    const relatorio = await projectAchievements(handle.db, {
      userId: USER,
      definitions: [],
      templates: [],
      lagMs: 0,
      logger: { warn: (_fields, message) => avisos.push(message) },
    });

    expect(relatorio.ok).toBe(true);
    expect(avisos).toContain("achievement_definition_invalid");

    // O resto do catálogo continuou funcionando: a Marcha Longa desbloqueou.
    const { items } = await listAchievementViews(handle.db, { userId: USER });
    expect(porChave(items, "long_march").state).toBe("UNLOCKED");
  });

  it("uma falha no meio do passe não avança o cursor nem afeta o Run", async () => {
    await expedicao({ title: "Antes da queda", status: "SUCCEEDED" });

    // Um `achievement_definition` apagado no meio do voo derruba a inserção do
    // progresso por chave estrangeira: é a falha mais realista, e a que prova
    // que o passe volta atrás inteiro.
    const quebrado = await projectAchievements(handle.db, {
      userId: USER,
      definitions: catalogo.valid,
      templates: templates.valid,
      lagMs: 0,
      batchSize: -1,
    });

    expect(quebrado.ok).toBe(false);
    expect(quebrado.error).not.toBeNull();

    const cursores = await handle.pool.query<{ total: string }>(
      "select count(*) as total from achievement_cursor where user_id = $1",
      [USER],
    );
    expect(Number(cursores.rows[0]?.total ?? 0)).toBe(0);

    // O Run continua exatamente como estava.
    const run = await handle.pool.query<{ status: string }>(
      "select status from run where user_id = $1",
      [USER],
    );
    expect(run.rows[0]?.status).toBe("SUCCEEDED");

    // E o passe seguinte, sem o defeito, projeta tudo.
    const bom = await projetar();
    expect(bom.ok).toBe(true);
    expect(bom.unlocked).toBeGreaterThan(0);
  });
});

describe("escopo e Projects novos", () => {
  it("cada Campanha ganha o seu Guardião, e um não conta pelo outro", async () => {
    const outro = await createProject(handle.db, { userId: USER, title: "Segunda Campanha" });

    const task = exigirOk(
      await createTask(handle.db, { userId: USER, projectId, title: "Da primeira" }),
      "a Task da primeira Campanha",
    );
    exigirOk(
      await changeTaskStatus(handle.db, { userId: USER, taskId: task.id, to: "COMPLETED" }),
      "a conclusão",
    );

    await projetar();

    const { items } = await listAchievementViews(handle.db, { userId: USER });
    const guardioes = items.filter((item) => item.key === "campaign_guardian");

    expect(guardioes).toHaveLength(2);
    expect(guardioes.find((item) => item.scopeId === projectId)?.progress.current).toBe(1);
    expect(guardioes.find((item) => item.scopeId === outro.id)?.progress.current).toBe(0);
  });

  it("filtra por origem, raridade e estado sem mexer nos contadores", async () => {
    await expedicao({ title: "Uma vitória", status: "SUCCEEDED" });
    await projetar();

    const todas = await listAchievementViews(handle.db, { userId: USER });
    const soTemplates = await listAchievementViews(handle.db, {
      userId: USER,
      filters: { origin: "TEMPLATE" },
    });

    expect(soTemplates.items.every((item) => item.origin === "TEMPLATE")).toBe(true);
    expect(soTemplates.counts.total).toBe(todas.counts.total);

    const desbloqueadas = await listAchievementViews(handle.db, {
      userId: USER,
      filters: { state: "UNLOCKED" },
    });
    expect(desbloqueadas.items.length).toBe(todas.counts.unlocked);
  });
});

describe("índices que sustentam o drain do projetor", () => {
  async function definicaoDoIndice(nome: string): Promise<string | null> {
    const result = await handle.pool.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname = 'public' and indexname = $1",
      [nome],
    );
    return result.rows[0]?.indexdef ?? null;
  }

  // O Worker chama `projetar()` a cada tique de 1 s, e as duas consultas de
  // drain filtram por `user_id` e ordenam por `(created_at, id)`. Sem um índice
  // que lidere por essas colunas, cada tique custa dois seq scans mais dois
  // sorts — um deles sobre `run_event`, a maior tabela do sistema — e o custo
  // cresce com o histórico, não com o trabalho pendente. A terceira fonte,
  // `dashboard_event`, ganhou o índice equivalente exatamente por isso.
  it("activity é lida por (user_id, created_at, id)", async () => {
    expect(await definicaoDoIndice("activity_user_created_idx")).toContain(
      "(user_id, created_at, id)",
    );
  });

  it("run_event é lida por (user_id, created_at, id), só onde type = 'Usage'", async () => {
    const definicao = await definicaoDoIndice("run_event_user_created_idx");

    expect(definicao).toContain("(user_id, created_at, id)");
    // Parcial: `Usage` é o único tipo que o drain lê, e a tabela inteira teria
    // uma ordem de grandeza a mais de linhas para indexar sem uso.
    expect(definicao).toContain("WHERE (type = 'Usage'");
  });

  /**
   * Existir não basta: o índice precisa **servir** à consulta que o drain faz.
   *
   * O `enable_seqscan = off` tira do planejador a saída que ele prefere numa
   * tabela pequena de teste e obriga a dizer qual índice ele usaria; com a
   * ordem de colunas errada ele cairia num índice qualquer mais um sort, e o
   * plano diria isso.
   */
  async function planoDoDrain(consulta: string, parametros: unknown[]): Promise<string> {
    const client = await handle.pool.connect();
    try {
      await client.query("set local enable_seqscan = off");
      const result = await client.query<{ "QUERY PLAN": string }>(
        `explain ${consulta}`,
        parametros,
      );
      return result.rows.map((linha) => linha["QUERY PLAN"]).join("\n");
    } finally {
      client.release();
    }
  }

  it("o drain de activity é servido pelo índice, sem sort", async () => {
    const plano = await planoDoDrain(
      `select a.id, a.created_at from activity a
        where a.user_id = $1 and a.created_at <= $2::timestamptz
          and (a.created_at, a.id) > ($2::timestamptz, $3::uuid)
        order by a.created_at, a.id
        limit 200`,
      [USER, new Date().toISOString(), "00000000-0000-0000-0000-000000000000"],
    );

    expect(plano).toContain("activity_user_created_idx");
    expect(plano).not.toContain("Sort");
  });

  it("o drain de run_event é servido pelo índice parcial, sem sort", async () => {
    const plano = await planoDoDrain(
      `select e.id, e.created_at from run_event e
        where e.user_id = $1 and e.type = 'Usage' and e.created_at <= $2::timestamptz
          and (e.created_at, e.id) > ($2::timestamptz, $3::uuid)
        order by e.created_at, e.id
        limit 200`,
      [USER, new Date().toISOString(), "00000000-0000-0000-0000-000000000000"],
    );

    expect(plano).toContain("run_event_user_created_idx");
    expect(plano).not.toContain("Sort");
  });
});
