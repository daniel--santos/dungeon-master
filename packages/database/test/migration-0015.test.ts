import { readFileSync } from "node:fs";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { MIGRATIONS_FOLDER } from "../src/migrate.js";

/**
 * A migração de dados da `0015`, exercitada contra o schema **anterior**.
 *
 * O banco embutido da suíte já nasce migrado até o fim, então este teste cria
 * um banco irmão no mesmo servidor, aplica as migrações `0000`–`0014` a partir
 * dos arquivos commitados, grava Loadouts com as colunas `jsonb` que a Fase 2
 * usava e só então aplica a `0015`. É a única forma de provar que o SQL
 * escrito à mão transforma o que está gravado, e não só o que o schema novo
 * aceita.
 */

const BANCO = "dm_migracao_0015";
const USER = "01996d00-0000-7000-8000-000000000001";
const HARNESS_CLAUDE = "01996d00-0000-7000-8000-00000000a001";
const HARNESS_PI = "01996d00-0000-7000-8000-00000000a002";
const AGENT = "01996d00-0000-7000-8000-00000000b001";
const PROFILE = "01996d00-0000-7000-8000-00000000c001";
const LOADOUT_A = "01996d00-0000-7000-8000-00000000d001";
const LOADOUT_B = "01996d00-0000-7000-8000-00000000d002";

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

const ONZE = {
  streaming: true,
  structuredOutput: true,
  resume: true,
  multiTurnProcess: false,
  toolEvents: true,
  tokenUsage: true,
  modelSelection: true,
  agentSelection: false,
  nativePermissions: true,
  hostExecution: true,
  dockerExecution: true,
};

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
  const ate0014 = entries.filter((entry) => entry.idx <= 14);
  expect(ate0014).toHaveLength(15);
  for (const entry of ate0014) await aplicar(client, entry.tag);

  // ------------------------------------------------------------ fixture
  await client.query(`insert into "user" (id) values ($1)`, [USER]);
  await client.query(
    `insert into harness (id, user_id, key, name, enabled, capabilities) values
       ($1, $2, 'CLAUDE_CODE', 'Claude Code', true, $3::jsonb),
       ($4, $2, 'PI', 'Pi', true, $5::jsonb)`,
    [
      HARNESS_CLAUDE,
      USER,
      JSON.stringify(ONZE),
      HARNESS_PI,
      // O Pi já tinha `mcpServers` gravado por um preflight: o que existe vence.
      JSON.stringify({ ...ONZE, nativePermissions: false, mcpServers: true }),
    ],
  );
  await client.query(
    `insert into agent (id, user_id, name, role, instructions) values ($1, $2, 'Eng', 'ENGINEER', 'x')`,
    [AGENT, USER],
  );
  await client.query(
    `insert into execution_profile (id, user_id, name, mode, workspace_strategy, enforcement,
       permission_policy, environment_policy, network_policy, enabled, is_default)
     values ($1, $2, 'Campo aberto', 'HOST', 'GIT_WORKTREE', 'HARNESS_NATIVE',
       '{"workspaceWrite":true,"commandExecution":"ALLOWLIST","allowedCommands":[],"deniedCommands":[]}',
       '{"allowedVariables":[],"inheritPath":true}', '{"access":"ALL","allowedHosts":[]}', true, true)`,
    [PROFILE, USER],
  );
  const politicas = {
    knowledge: JSON.stringify({
      includeProjectSummary: true,
      includeDecisions: true,
      maxItems: 20,
    }),
    context: JSON.stringify({
      includeParentContext: true,
      includeDependencyContext: true,
      maxTokens: 0,
    }),
  };
  await client.query(
    `insert into loadout (id, user_id, name, agent_id, harness_id, model_id, execution_profile_id,
       skills, tools, mcp_servers, knowledge_policy, context_policy, version, is_default, created_at)
     values
       ($1, $2, 'A', $3, $4, null, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, 3, true,
        '2026-09-01T00:00:00Z'),
       ($11, $2, 'B', $3, $4, null, $5, $12::jsonb, '[]'::jsonb, $13::jsonb, $9::jsonb, $10::jsonb, 1, false,
        '2026-09-02T00:00:00Z')`,
    [
      LOADOUT_A,
      USER,
      AGENT,
      HARNESS_CLAUDE,
      PROFILE,
      JSON.stringify(["typescript", " postgresql ", "typescript"]),
      JSON.stringify(["Ler"]),
      JSON.stringify([
        { name: "figma", transport: "HTTP", target: "https://mcp.figma.com/sse" },
        { name: "docs", transport: "STDIO", target: "node /srv/docs server.js --port 1" },
      ]),
      politicas.knowledge,
      politicas.context,
      LOADOUT_B,
      JSON.stringify(["postgresql"]),
      JSON.stringify([{ name: "docs", transport: "STDIO", target: "node outro.js" }]),
    ],
  );

  const quinze = entries.find((entry) => entry.idx === 15);
  if (quinze === undefined) throw new Error("A migração 0015 não está no journal.");
  await aplicar(client, quinze.tag);
}, 120_000);

afterAll(async () => {
  await client?.end();
  await admin?.query(`DROP DATABASE IF EXISTS "${BANCO}" WITH (FORCE)`);
  await admin?.end();
});

describe("migração 0015: jsonb do Loadout vira registro", () => {
  it("as strings de skills viram Skills com conteúdo vazio na versão 1, sem duplicar", async () => {
    const skills = await client.query<{ id: string; name: string; latest_version: number }>(
      `select id, name, latest_version from skill where user_id = $1 order by name`,
      [USER],
    );
    expect(skills.rows.map((row) => [row.name, row.latest_version])).toEqual([
      ["postgresql", 1],
      ["typescript", 1],
    ]);

    const versoes = await client.query<{ version: number; content: string }>(
      `select version, content from skill_version where user_id = $1`,
      [USER],
    );
    expect(versoes.rows).toHaveLength(2);
    expect(versoes.rows.every((row) => row.version === 1 && row.content === "")).toBe(true);

    const ids = Object.fromEntries(skills.rows.map((row) => [row.name, row.id]));
    for (const id of Object.values(ids)) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);

    const juncao = await client.query<{
      loadout_id: string;
      skill_id: string;
      pinned_version: number | null;
      position: number;
    }>(
      `select loadout_id, skill_id, pinned_version, position from loadout_skill
       where user_id = $1 order by loadout_id, position`,
      [USER],
    );
    expect(juncao.rows).toEqual([
      { loadout_id: LOADOUT_A, skill_id: ids["typescript"], pinned_version: null, position: 0 },
      { loadout_id: LOADOUT_A, skill_id: ids["postgresql"], pinned_version: null, position: 1 },
      { loadout_id: LOADOUT_B, skill_id: ids["postgresql"], pinned_version: null, position: 0 },
    ]);
  });

  it("as strings de tools viram Tools COMMAND com o nome como comando", async () => {
    const tools = await client.query<{ name: string; kind: string; command: string }>(
      `select name, kind, command from tool where user_id = $1`,
      [USER],
    );
    expect(tools.rows).toEqual([{ name: "Ler", kind: "COMMAND", command: "Ler" }]);

    const juncao = await client.query<{ loadout_id: string; position: number }>(
      `select loadout_id, position from loadout_tool where user_id = $1`,
      [USER],
    );
    expect(juncao.rows).toEqual([{ loadout_id: LOADOUT_A, position: 0 }]);
  });

  it("os servidores inline viram mcp_server, com comando e argumentos separados", async () => {
    const servidores = await client.query<{
      id: string;
      name: string;
      transport: string;
      command: string | null;
      args: string[];
      url: string | null;
      built_in: boolean;
    }>(
      `select id, name, transport, command, args, url, built_in from mcp_server
       where user_id = $1 order by name`,
      [USER],
    );
    expect(
      servidores.rows.map((row) => [row.name, row.transport, row.command, row.args, row.url]),
    ).toEqual([
      ["docs", "STDIO", "node", ["/srv/docs", "server.js", "--port", "1"], null],
      ["docs-2", "STDIO", "node", ["outro.js"], null],
      ["figma", "HTTP", null, [], "https://mcp.figma.com/sse"],
    ]);
    expect(servidores.rows.every((row) => !row.built_in)).toBe(true);

    const porNome = Object.fromEntries(servidores.rows.map((row) => [row.name, row.id]));
    const juncao = await client.query<{
      loadout_id: string;
      mcp_server_id: string;
      position: number;
    }>(
      `select loadout_id, mcp_server_id, position from loadout_mcp
       where user_id = $1 order by loadout_id, position`,
      [USER],
    );
    expect(juncao.rows).toEqual([
      { loadout_id: LOADOUT_A, mcp_server_id: porNome["figma"], position: 0 },
      { loadout_id: LOADOUT_A, mcp_server_id: porNome["docs"], position: 1 },
      { loadout_id: LOADOUT_B, mcp_server_id: porNome["docs-2"], position: 0 },
    ]);
  });

  it("loadout_version recebe a versão atual de cada Loadout, por referências", async () => {
    const versoes = await client.query<{
      loadout_id: string;
      version: number;
      definition: Record<string, unknown>;
    }>(
      `select loadout_id, version, definition from loadout_version where user_id = $1 order by loadout_id`,
      [USER],
    );
    expect(versoes.rows.map((row) => [row.loadout_id, row.version])).toEqual([
      [LOADOUT_A, 3],
      [LOADOUT_B, 1],
    ]);

    const a = versoes.rows[0]!.definition;
    expect(a["name"]).toBe("A");
    expect(a["isDefault"]).toBe(true);
    expect(a["modelId"]).toBeNull();
    expect(a["skillRefs"]).toHaveLength(2);
    expect((a["skillRefs"] as { pinnedVersion: unknown }[])[0]?.pinnedVersion).toBeNull();
    expect(a["toolIds"]).toHaveLength(1);
    expect(a["mcpServerIds"]).toHaveLength(2);
    expect(a["knowledgePolicy"]).toEqual({
      includeProjectSummary: true,
      includeDecisions: true,
      maxItems: 20,
    });
  });

  it("harness.capabilities ganha as duas chaves; o que já estava gravado vence", async () => {
    const harnesses = await client.query<{ key: string; capabilities: Record<string, boolean> }>(
      `select key, capabilities from harness where user_id = $1 order by key`,
      [USER],
    );
    const claude = harnesses.rows.find((row) => row.key === "CLAUDE_CODE")!.capabilities;
    const pi = harnesses.rows.find((row) => row.key === "PI")!.capabilities;

    expect(claude["mcpServers"]).toBe(true);
    expect(claude["forkSession"]).toBe(true);
    expect(Object.keys(claude)).toHaveLength(13);
    // O Pi tinha `mcpServers: true` de um preflight antigo: fica; só `forkSession` entra.
    expect(pi["mcpServers"]).toBe(true);
    expect(pi["forkSession"]).toBe(false);
    expect(pi["nativePermissions"]).toBe(false);
  });

  it("as colunas jsonb do Loadout deixam de existir", async () => {
    const colunas = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'loadout' and column_name in ('skills', 'tools', 'mcp_servers')`,
    );
    expect(colunas.rows).toEqual([]);
  });
});
