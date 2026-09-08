/**
 * PostgreSQL embutido para testes: `initdb`, `pg_ctl start` e `pg_ctl stop`
 * chamados diretamente sobre os binários que o pacote `embedded-postgres`
 * instala. O pacote em si **nunca é importado em runtime**; ele fica em
 * devDependencies só para trazer `@embedded-postgres/<plataforma>`.
 *
 * Três motivos, todos descobertos no CI:
 *
 * - `start()` do pacote lança `postgres.exe` diretamente, e o servidor
 *   **recusa rodar com privilégios de administrador** no Windows. O runner
 *   `windows-latest` do GitHub Actions é administrador. `pg_ctl` é o caminho
 *   oficial: chamado por um administrador, cria um token restrito.
 * - `stop()` do pacote mata o servidor com `taskkill /f` ou `SIGINT` mantendo-o
 *   como filho do Vitest; backends órfãos herdavam pipes e impediam o Vitest
 *   de encerrar. Com `pg_ctl` o servidor é desanexado e `stop -m fast -w`
 *   desliga tudo limpo.
 * - **Importar o pacote instala um `async-exit-hook` global** que intercepta
 *   `process.exit` e devolvia código 0 mesmo com teste falhando. O CI ficava
 *   verde com suíte vermelha. Sem o import, o hook não existe.
 *
 * Este módulo é **só para testes** (subpath `@dungeon-master/database/testing`).
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "pg";

import { createDatabase } from "../client.js";
import { runMigrations } from "../migrate.js";
import { seedLocalUser } from "../seed.js";
import { seedExecutionRegistry } from "../seed-execution.js";
import { seedKnowledgeLoadout } from "../seed-knowledge.js";

const TEST_USER = "dungeon";
const TEST_PASSWORD = "dungeon";
const START_TIMEOUT_S = 120;
const STOP_TIMEOUT_S = 60;

export interface StartTestPostgresOptions {
  /** Prefixo do diretório temporário de dados; útil para distinguir pacotes nos logs. */
  readonly prefix?: string;
  /** Nome do banco de teste criado, migrado e semeado. */
  readonly database?: string;
}

export interface TestPostgres {
  readonly databaseUrl: string;
  readonly dataDir: string;
  readonly port: number;
  /** Desliga o servidor com `pg_ctl stop -m fast -w` e apaga o diretório de dados. */
  stop(): Promise<void>;
}

interface PostgresBinaries {
  readonly initdb: string;
  readonly pg_ctl: string;
}

/** Pede uma porta livre ao sistema operacional em vez de chutar um número. */
async function findFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Não foi possível descobrir uma porta livre."));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Nome do pacote de binários que `embedded-postgres` usa nesta plataforma.
 * Espelha `embedded-postgres/dist/binary.js`, que não é exportado.
 */
function binariesPackageName(): string {
  const os = platform();
  const cpu = arch();
  const platformName = os === "win32" ? "windows" : os;
  const supported = new Set([
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-arm",
    "linux-ia32",
    "linux-ppc64",
    "linux-x64",
    "windows-x64",
  ]);
  const name = `${platformName}-${cpu}`;
  if (!supported.has(name)) {
    throw new Error(`embedded-postgres não tem binários para ${os}/${cpu}.`);
  }
  return `@embedded-postgres/${name}`;
}

/**
 * Caminhos de `initdb` e `pg_ctl` que acompanham os binários do
 * `embedded-postgres`.
 *
 * O pacote de binários é dependência opcional do `embedded-postgres`, não
 * nossa; com o `node_modules` estrito do pnpm ele só resolve a partir da pasta
 * do próprio `embedded-postgres`. `require.resolve` só localiza o arquivo, não
 * o executa: o pacote e seu exit hook nunca são carregados.
 */
async function resolveBinaries(): Promise<PostgresBinaries> {
  const requireFromHere = createRequire(import.meta.url);
  const embeddedEntry = requireFromHere.resolve("embedded-postgres");
  const requireFromEmbedded = createRequire(embeddedEntry);
  const binariesEntry = requireFromEmbedded.resolve(binariesPackageName());
  const binaries = (await import(pathToFileURL(binariesEntry).href)) as PostgresBinaries;
  return { initdb: binaries.initdb, pg_ctl: binaries.pg_ctl };
}

/**
 * Roda um binário do PostgreSQL com a saída em arquivo, nunca em pipe.
 *
 * No Windows, `pg_ctl start` cria o servidor com `bInheritHandles`, e o
 * postmaster herda **todos** os handles herdáveis, inclusive os pipes que o
 * Node daria a `execFile`. O servidor fica vivo, os pipes nunca fecham e a
 * chamada nunca retorna. Com stdio em descritor de arquivo não há pipe a
 * herdar, e o evento `exit` basta.
 */
async function runBinary(
  binary: string,
  args: readonly string[],
  logFile: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const fd = openSync(logFile, "a");
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(binary, [...args], { stdio: ["ignore", fd, fd], windowsHide: true, env });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  }).finally(() => closeSync(fd));

  if (exitCode !== 0) {
    let detail = "";
    try {
      detail = readFileSync(logFile, "utf8").trim().split("\n").slice(-20).join("\n");
    } catch {
      // Sem log; o código de saída já diz o essencial.
    }
    throw new Error(
      `${binary} ${args[0] ?? ""} saiu com código ${String(exitCode)}${detail ? `:\n${detail}` : ""}`,
    );
  }
}

/**
 * `initdb` com os mesmos flags que o `embedded-postgres` usaria, mais os que
 * fixam a locale: sem eles o initdb herda a do sistema (WIN1252 e `portuguese`
 * no Windows, UTF8 e `en_US` no macOS) e ordenação e busca textual passariam a
 * depender da máquina. A senha vai por arquivo, como o initdb exige.
 */
async function initCluster(
  binaries: PostgresBinaries,
  dataDir: string,
  logFile: string,
): Promise<void> {
  const passwordFile = join(tmpdir(), `dm-pgpw-${randomBytes(6).toString("hex")}`);
  writeFileSync(passwordFile, `${TEST_PASSWORD}\n`, { mode: 0o600 });
  try {
    await runBinary(
      binaries.initdb,
      [
        `--pgdata=${dataDir}`,
        "--auth=password",
        `--username=${TEST_USER}`,
        `--pwfile=${passwordFile}`,
        "--encoding=UTF8",
        "--locale=C",
        "--lc-messages=C",
      ],
      logFile,
      { ...process.env, LC_MESSAGES: "C" },
    );
  } finally {
    rmSync(passwordFile, { force: true });
  }
}

/** `CREATE DATABASE` no banco de manutenção `postgres`, com o superusuário do initdb. */
async function createTestDatabase(port: number, name: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Nome de banco de teste inválido: ${name}`);
  }
  const client = new Client({
    host: "127.0.0.1",
    port,
    user: TEST_USER,
    password: TEST_PASSWORD,
    database: "postgres",
  });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

/**
 * Sobe um PostgreSQL embutido em porta livre, cria o banco de teste, aplica as
 * migrações e semeia o usuário local. Use no `globalSetup` do Vitest e
 * publique `databaseUrl` com `provide`.
 */
export async function startTestPostgres(
  options: StartTestPostgresOptions = {},
): Promise<TestPostgres> {
  const prefix = options.prefix ?? "dm-pgdata-";
  const database = options.database ?? "dungeon_master_test";

  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  const port = await findFreePort();
  const binaries = await resolveBinaries();

  // O initdb exige um diretório vazio ou inexistente; o log vai para um irmão.
  const initdbLog = `${dataDir}.initdb.log`;
  await initCluster(binaries, dataDir, initdbLog);
  rmSync(initdbLog, { force: true });

  const logFile = join(dataDir, "server.log");
  const pgCtlLog = join(dataDir, "pg_ctl.log");
  const serverOptions = [
    `-p ${String(port)}`,
    // Durabilidade não importa num banco descartável; acelera os testes.
    "-c fsync=off",
    "-c full_page_writes=off",
    "-c synchronous_commit=off",
  ].join(" ");

  // `-w` espera o servidor aceitar conexões; `-l` é obrigatório, senão o
  // servidor herda os pipes deste processo e a chamada nunca retorna.
  await runBinary(
    binaries.pg_ctl,
    [
      "start",
      "-D",
      dataDir,
      "-w",
      "-t",
      String(START_TIMEOUT_S),
      "-l",
      logFile,
      "-o",
      serverOptions,
    ],
    pgCtlLog,
  );

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await runBinary(
      binaries.pg_ctl,
      ["stop", "-D", dataDir, "-m", "fast", "-w", "-t", String(STOP_TIMEOUT_S)],
      pgCtlLog,
    );
    // No Windows, arquivos de um processo que acabou de sair podem ficar
    // travados por alguns milissegundos; as tentativas cobrem isso.
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };

  try {
    await createTestDatabase(port, database);

    const databaseUrl = `postgresql://${TEST_USER}:${TEST_PASSWORD}@127.0.0.1:${String(port)}/${database}`;

    await runMigrations(databaseUrl);

    const handle = createDatabase({ url: databaseUrl, max: 1, applicationName: "vitest-seed" });
    try {
      // Os cadastros fechados entram junto do usuário local: sem Harness e sem
      // ExecutionProfile nenhum Loadout pode ser criado, e um teste de execução
      // começaria montando à mão o vocabulário que o `db:seed` já define.
      const { userId } = await seedLocalUser(handle.db);
      await seedExecutionRegistry(handle.db, { userId });
      // O Loadout do Escriba vai junto pelo mesmo motivo: um teste do
      // Distiller começaria montando à mão o que o `db:seed` já define.
      await seedKnowledgeLoadout(handle.db, { userId });
    } finally {
      await handle.close();
    }

    return { databaseUrl, dataDir, port, stop };
  } catch (error) {
    await stop().catch(() => undefined);
    throw error;
  }
}
