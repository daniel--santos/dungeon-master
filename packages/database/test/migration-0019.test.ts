import { readFileSync } from "node:fs";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { MIGRATIONS_FOLDER } from "../src/migrate.js";

/**
 * A migração `0019` (ADR 0003), exercitada contra o schema **anterior**.
 *
 * O banco embutido da suíte já nasce migrado até o fim, então este teste cria
 * um banco irmão no mesmo servidor, aplica as migrações `0000`–`0018` a partir
 * dos arquivos commitados, grava linhas em `hero_stats` e um `dashboard_event`
 * do tipo antigo, e só então aplica a `0019`. É a única forma de provar que o
 * SQL escrito à mão **renomeia** — tabela, tipo, colunas, constraints e o
 * tipo do evento — sem perder o que estava gravado, em vez de só produzir o
 * schema que o código novo aceita.
 */

const BANCO = "dm_migracao_0019";
const USER = "01996d00-0000-7000-8000-000000000001";
const AGENT = "01996d00-0000-7000-8000-00000000b001";
const LOADOUT = "01996d00-0000-7000-8000-00000000d001";
const STATS_AGENT = "01996d00-0000-7000-8000-00000000e001";
const STATS_LOADOUT = "01996d00-0000-7000-8000-00000000e002";

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

function lerJournal(): JournalEntry[] {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8")) as {
    entries: JournalEntry[];
  };
  return journal.entries;
}

async function aplicar(client: Client, tag: string): Promise<void> {
  const sql = readFileSync(`${MIGRATIONS_FOLDER}/${tag}.sql`, "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    const texto = statement.trim();
    if (texto.length === 0) continue;
    await client.query(texto);
  }
}

let admin: Client;
let client: Client;

beforeAll(async () => {
  const base = new URL(inject("databaseUrl"));
  const manutencao = new URL(base);
  manutencao.pathname = "/postgres";
  admin = new Client({ connectionString: manutencao.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${BANCO}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${BANCO}"`);

  const alvo = new URL(base);
  alvo.pathname = `/${BANCO}`;
  client = new Client({ connectionString: alvo.toString() });
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");

  const entries = lerJournal();
  const ate0018 = entries.filter((entry) => entry.idx <= 18);
  expect(ate0018).toHaveLength(19);
  for (const entry of ate0018) await aplicar(client, entry.tag);

  // ------------------------------------------------------------ fixture
  // Só o que a linha antiga exige: `scope_id` não tem chave estrangeira de
  // propósito (a estatística sobrevive à entidade), então nem Agent nem
  // Loadout precisam existir.
  await client.query(`insert into "user" (id) values ($1)`, [USER]);
  await client.query(
    `insert into hero_stats (id, user_id, scope, scope_id, xp, level, expeditions, victories,
       defeats, monsters_slain, docker_victories, tokens, harness_counts, top_harness)
     values
       ($1, $2, 'AGENT', $3, 350, 3, 7, 5, 1, 2, 1, 12345, '{"claude":4,"codex":3}'::jsonb, 'claude'),
       ($4, $2, 'LOADOUT', $5, 100, 2, 2, 1, 1, 0, 0, 500, '{"pi":2}'::jsonb, 'pi')`,
    [STATS_AGENT, USER, AGENT, STATS_LOADOUT, LOADOUT],
  );
  await client.query(
    `insert into dashboard_event (user_id, type, payload) values
       ($1, 'hero_stats.updated', '{"scope":"AGENT","xp":350}'::jsonb),
       ($1, 'achievement.unlocked', '{"key":"first_expedition"}'::jsonb)`,
    [USER],
  );

  const dezenove = entries.find((entry) => entry.idx === 19);
  if (dezenove === undefined) throw new Error("A migração 0019 não está no journal.");
  await aplicar(client, dezenove.tag);
}, 120_000);

afterAll(async () => {
  await client?.end();
  await admin?.query(`DROP DATABASE IF EXISTS "${BANCO}" WITH (FORCE)`);
  await admin?.end();
});

describe("migração 0019: hero_stats vira execution_stats sem perder linhas", () => {
  it("as linhas sobrevivem, com os valores nas colunas renomeadas", async () => {
    const linhas = await client.query<{
      id: string;
      scope: string;
      scope_id: string;
      xp: number;
      level: number;
      runs_total: number;
      runs_succeeded: number;
      runs_failed: number;
      bug_tasks_completed: number;
      docker_runs_succeeded: number;
      tokens: string;
      harness_counts: Record<string, number>;
      top_harness: string | null;
    }>(
      `select id, scope, scope_id, xp, level, runs_total, runs_succeeded, runs_failed,
         bug_tasks_completed, docker_runs_succeeded, tokens, harness_counts, top_harness
       from execution_stats where user_id = $1 order by xp desc`,
      [USER],
    );

    expect(linhas.rows).toEqual([
      {
        id: STATS_AGENT,
        scope: "AGENT",
        scope_id: AGENT,
        xp: 350,
        level: 3,
        runs_total: 7,
        runs_succeeded: 5,
        runs_failed: 1,
        bug_tasks_completed: 2,
        docker_runs_succeeded: 1,
        tokens: "12345",
        harness_counts: { claude: 4, codex: 3 },
        top_harness: "claude",
      },
      {
        id: STATS_LOADOUT,
        scope: "LOADOUT",
        scope_id: LOADOUT,
        xp: 100,
        level: 2,
        runs_total: 2,
        runs_succeeded: 1,
        runs_failed: 1,
        bug_tasks_completed: 0,
        docker_runs_succeeded: 0,
        tokens: "500",
        harness_counts: { pi: 2 },
        top_harness: "pi",
      },
    ]);
  });

  it("a tabela, o tipo e as colunas antigas deixam de existir", async () => {
    const tabelas = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name in ('hero_stats', 'execution_stats')`,
    );
    expect(tabelas.rows).toEqual([{ table_name: "execution_stats" }]);

    const tipos = await client.query<{ typname: string }>(
      `select typname from pg_type where typname in ('hero_scope', 'execution_stats_scope')`,
    );
    expect(tipos.rows).toEqual([{ typname: "execution_stats_scope" }]);

    const colunas = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'execution_stats' order by ordinal_position`,
    );
    expect(colunas.rows.map((row) => row.column_name)).toEqual([
      "id",
      "user_id",
      "scope",
      "scope_id",
      "xp",
      "level",
      "runs_total",
      "runs_succeeded",
      "runs_failed",
      "bug_tasks_completed",
      "docker_runs_succeeded",
      "tokens",
      "harness_counts",
      "top_harness",
      "updated_at",
    ]);
  });

  it("as constraints seguem o nome novo, e a unicidade por escopo continua valendo", async () => {
    const constraints = await client.query<{ conname: string; contype: string }>(
      `select conname, contype from pg_constraint
       where conrelid = 'execution_stats'::regclass order by conname`,
    );
    expect(constraints.rows).toEqual([
      { conname: "execution_stats_pkey", contype: "p" },
      { conname: "execution_stats_scope_uq", contype: "u" },
      { conname: "execution_stats_user_id_user_id_fk", contype: "f" },
    ]);

    await expect(
      client.query(
        `insert into execution_stats (id, user_id, scope, scope_id) values ($1, $2, 'AGENT', $3)`,
        ["01996d00-0000-7000-8000-00000000e003", USER, AGENT],
      ),
    ).rejects.toThrow(/execution_stats_scope_uq/);
  });

  it("o evento de painel antigo passa a ter o tipo novo; os outros ficam como estavam", async () => {
    const eventos = await client.query<{ type: string; payload: Record<string, unknown> }>(
      `select type, payload from dashboard_event where user_id = $1 order by sequence`,
      [USER],
    );
    expect(eventos.rows).toEqual([
      { type: "execution_stats.updated", payload: { scope: "AGENT", xp: 350 } },
      { type: "achievement.unlocked", payload: { key: "first_expedition" } },
    ]);
  });
});
