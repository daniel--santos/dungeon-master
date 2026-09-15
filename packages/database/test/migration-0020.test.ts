import { readFileSync } from "node:fs";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { MIGRATIONS_FOLDER } from "../src/migrate.js";

/**
 * A migração `0020` (Fase 10A), exercitada contra o schema **anterior**.
 *
 * O banco embutido da suíte já nasce migrado até o fim, então este teste cria
 * um banco irmão no mesmo servidor, aplica as migrações `0000`–`0019` a partir
 * dos arquivos commitados, grava um Provider e um Run **antigos** e só então
 * aplica a `0020`. É a única forma de provar que a migração acrescenta tabelas
 * e colunas sem perder o que já estava lá — e que os `CHECK`s novos aceitam as
 * linhas que existiam antes deles.
 */

const BANCO = "dm_migracao_0020";
const USER = "01996d00-0000-7000-8000-000000000001";
const PROVIDER = "01996d00-0000-7000-8000-00000000c001";

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
  const ate0019 = entries.filter((entry) => entry.idx <= 19);
  expect(ate0019).toHaveLength(20);
  for (const entry of ate0019) await aplicar(client, entry.tag);

  // ------------------------------------------------------------- fixture
  await client.query(`insert into "user" (id) values ($1)`, [USER]);
  await client.query(
    `insert into provider (id, user_id, name, kind, auth_env_keys, harness_keys)
     values ($1, $2, 'Anthropic', 'SUBSCRIPTION', '[]'::jsonb, '["CLAUDE_CODE"]'::jsonb)`,
    [PROVIDER, USER],
  );

  const vinte = entries.find((entry) => entry.idx === 20);
  if (vinte === undefined) throw new Error("A migração 0020 não está no journal.");
  await aplicar(client, vinte.tag);
}, 120_000);

afterAll(async () => {
  await client?.end();
  await admin?.query(`DROP DATABASE IF EXISTS "${BANCO}" WITH (FORCE)`);
  await admin?.end();
});

describe("migração 0020: métricas, preço de Model e presença de Worker", () => {
  it("as cinco tabelas novas passam a existir", async () => {
    const tabelas = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in ('run_metric', 'metric_daily', 'metric_cursor', 'model_price', 'worker')
       order by table_name`,
    );
    expect(tabelas.rows.map((linha) => linha.table_name)).toEqual([
      "metric_cursor",
      "metric_daily",
      "model_price",
      "run_metric",
      "worker",
    ]);
  });

  it("o Provider antigo sobrevive, com as colunas de cobrança nulas", async () => {
    const linhas = await client.query<{
      name: string;
      billing_kind: string | null;
      monthly_cost: string | null;
      currency: string | null;
    }>(`select name, billing_kind, monthly_cost, currency from provider where id = $1`, [PROVIDER]);

    expect(linhas.rows).toEqual([
      { name: "Anthropic", billing_kind: null, monthly_cost: null, currency: null },
    ]);
  });

  it("uma mensalidade sem moeda é recusada pelo banco, e não só pelo Zod", async () => {
    await expect(
      client.query(`update provider set monthly_cost = 200 where id = $1`, [PROVIDER]),
    ).rejects.toThrow(/provider_monthly_cost_ck/);

    await client.query(
      `update provider set billing_kind = 'SUBSCRIPTION', monthly_cost = 200, currency = 'USD'
       where id = $1`,
      [PROVIDER],
    );

    const linhas = await client.query<{ monthly_cost: string; currency: string }>(
      `select monthly_cost, currency from provider where id = $1`,
      [PROVIDER],
    );
    expect(linhas.rows[0]?.currency).toBe("USD");
  });

  it("só uma vigência corrente por Model, pelo índice único parcial", async () => {
    const indices = await client.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'model_price' order by indexname`,
    );
    const parcial = indices.rows.find((linha) => linha.indexdef.includes("model_price_current_uq"));
    expect(parcial?.indexdef).toMatch(/WHERE \(effective_to IS NULL\)/i);
  });

  it("`run_metric` recusa um desfecho que não é terminal", async () => {
    const constraints = await client.query<{ conname: string }>(
      `select conname from pg_constraint
       where conrelid = 'run_metric'::regclass and contype = 'c' order by conname`,
    );
    expect(constraints.rows.map((linha) => linha.conname)).toContain(
      "run_metric_status_terminal_ck",
    );
  });

  it("o drain do projetor tem índice parcial em `run`", async () => {
    const indices = await client.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'run' and indexname = 'run_user_finished_idx'`,
    );
    expect(indices.rows[0]?.indexdef).toMatch(/WHERE \(finished_at IS NOT NULL\)/i);
  });
});
