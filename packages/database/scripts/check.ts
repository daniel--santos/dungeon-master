/**
 * `pnpm db:check` — falha quando o schema Drizzle e as migrações divergem.
 *
 * Não abre conexão. Roda `drizzle-kit generate`, que compara `src/schema` com
 * os snapshots em `drizzle/meta`. Se o gerador produzir qualquer arquivo, é
 * porque existe mudança de schema sem migração correspondente: o script mostra
 * o SQL que faltava, desfaz o que gerou e sai com código 1.
 *
 * A disciplina é a da seção 3.4 do planejamento: nenhuma mudança de schema
 * entra sem migração versionada.
 */
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS_DIR = "drizzle";
const PROBE_NAME = "db_check_probe";

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: packageRoot, encoding: "utf8" });
}

function migrationsDirStatus(): string {
  return git(["status", "--porcelain", "--", MIGRATIONS_DIR]).trim();
}

function fail(message: string): never {
  console.error(`[db:check] ${message}`);
  process.exit(1);
}

const statusBefore = migrationsDirStatus();

if (statusBefore !== "") {
  console.error("[db:check] a pasta de migrações já tem alterações não commitadas:");
  console.error(statusBefore);
  fail(
    "commite ou descarte essas alterações antes de rodar o check, senão não dá para " +
      "distinguir divergência de trabalho em andamento.",
  );
}

console.log("[db:check] gerando migração de sondagem para detectar divergência...");

try {
  execSync(`pnpm exec drizzle-kit generate --name ${PROBE_NAME}`, {
    cwd: packageRoot,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });
} catch (error) {
  fail(`drizzle-kit generate falhou: ${error instanceof Error ? error.message : String(error)}`);
}

const statusAfter = migrationsDirStatus();

if (statusAfter === "") {
  console.log("[db:check] schema e migrações estão em dia.");
  process.exit(0);
}

console.error("[db:check] o schema Drizzle não corresponde às migrações commitadas.");
console.error("[db:check] arquivos que o gerador produziu:");
console.error(statusAfter);
console.error(
  "[db:check] rode `pnpm db:generate` com um nome descritivo e commite a migração gerada.",
);

// Desfaz a sondagem para não deixar lixo na árvore de trabalho.
try {
  git(["checkout", "--", MIGRATIONS_DIR]);
  git(["clean", "-fdq", "--", MIGRATIONS_DIR]);
} catch (error) {
  console.error(
    `[db:check] não foi possível desfazer a sondagem em ${MIGRATIONS_DIR}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

process.exit(1);
