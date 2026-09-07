/**
 * PostgreSQL embutido para testes, iniciado e parado por `pg_ctl`.
 *
 * Por que não usar `start()`/`stop()` do pacote `embedded-postgres`:
 *
 * - `start()` lança `postgres.exe` diretamente, e o servidor **recusa rodar com
 *   privilégios de administrador** no Windows ("Execution of PostgreSQL by a
 *   user with administrative permissions is not permitted"). O runner
 *   `windows-latest` do GitHub Actions é administrador, e o CI caía nisso.
 *   `pg_ctl` é o caminho oficial: quando é chamado por um administrador, cria um
 *   token restrito e lança o servidor com ele.
 * - `stop()` mata o servidor com `taskkill /f` no Windows e `SIGINT` no POSIX,
 *   mantendo o servidor como filho do processo do Vitest. Backends órfãos
 *   herdavam os pipes e impediam o Vitest de encerrar ("something prevents Vite
 *   servers from exiting"). Com `pg_ctl` o servidor é desanexado, o log vai
 *   para arquivo, e `pg_ctl stop -m fast -w` desliga tudo de forma limpa.
 *
 * O pacote `embedded-postgres` continua responsável por baixar os binários e
 * por `initialise()` (initdb). O `createDatabase()` dele exige que o servidor
 * tenha sido iniciado pelo próprio pacote, então o banco de teste é criado
 * aqui com um `Client` do `pg`.
 *
 * Este módulo é **só para testes** (subpath `@dungeon-master/database/testing`);
 * `embedded-postgres` é devDependency deste pacote.
 */
import { spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";

import { createDatabase } from "../client.js";
import { runMigrations } from "../migrate.js";
import { seedLocalUser } from "../seed.js";

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
 * Caminho do `pg_ctl` que acompanha os binários do `embedded-postgres`.
 *
 * O pacote de binários é dependência opcional do `embedded-postgres`, não
 * nossa; com o `node_modules` estrito do pnpm ele só resolve a partir da pasta
 * do próprio `embedded-postgres`. Daí a cadeia de dois `createRequire`.
 */
async function resolvePgCtl(): Promise<string> {
  const requireFromHere = createRequire(import.meta.url);
  const embeddedEntry = requireFromHere.resolve("embedded-postgres");
  const requireFromEmbedded = createRequire(embeddedEntry);
  const binariesEntry = requireFromEmbedded.resolve(binariesPackageName());
  const binaries = (await import(pathToFileURL(binariesEntry).href)) as { pg_ctl: string };
  return binaries.pg_ctl;
}

/**
 * Roda `pg_ctl` com a saída em arquivo, nunca em pipe.
 *
 * No Windows, `pg_ctl start` cria o servidor com `bInheritHandles`, e o
 * postmaster herda **todos** os handles herdáveis, inclusive os pipes que o
 * Node daria a `execFile`. O servidor fica vivo, os pipes nunca fecham e a
 * chamada nunca retorna. Com stdio em descritor de arquivo não há pipe a
 * herdar, e o evento `exit` basta.
 */
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

async function pgCtl(pgCtlPath: string, args: readonly string[], logFile: string): Promise<void> {
  const fd = openSync(logFile, "a");
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(pgCtlPath, [...args], { stdio: ["ignore", fd, fd], windowsHide: true });
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
      `pg_ctl ${args[0] ?? ""} saiu com código ${String(exitCode)}${detail ? `:\n${detail}` : ""}`,
    );
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
  const pgCtlPath = await resolvePgCtl();

  const embedded = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: TEST_USER,
    password: TEST_PASSWORD,
    port,
    persistent: true, // nós apagamos o diretório; `stop()` do pacote nunca é chamado
    // Sem estes flags o initdb herda a locale do sistema: WIN1252 e
    // `portuguese` no Windows, UTF8 e `en_US` no macOS. Ordenação e busca
    // textual passariam a depender da máquina.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => undefined,
    onError: (message) => process.stderr.write(String(message)),
  });

  await embedded.initialise();

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
  // servidor herda os pipes deste processo e o `execFile` nunca retorna.
  await pgCtl(
    pgCtlPath,
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
    await pgCtl(
      pgCtlPath,
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
      await seedLocalUser(handle.db);
    } finally {
      await handle.close();
    }

    return { databaseUrl, dataDir, port, stop };
  } catch (error) {
    await stop().catch(() => undefined);
    throw error;
  }
}
