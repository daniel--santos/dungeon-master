import { createDatabase, type DatabaseHandle } from "@dungeon-master/database";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createOrchestrationMcpServer } from "./server.js";
import { createDatabaseOrchestrationToolStore } from "./store-database.js";

/**
 * O processo do servidor:
 * `node orchestration-mcp.mjs --run <id> --project <id> --user <id>`.
 *
 * As mesmas regras do Grimório (`packages/knowledge-mcp/src/bin.ts`): ids no
 * argv e o segredo no ambiente (`DATABASE_URL` pela allow-list do harness);
 * stdout é do protocolo; sem `DATABASE_URL` não sobe. O Run mãe é fixado na
 * partida: este processo delega em nome dele e de mais ninguém.
 */

const EXIT_USAGE = 2;

const ArgsSchema = z.object({
  run: z.uuid(),
  project: z.uuid(),
  user: z.uuid(),
});

function parseArgs(argv: readonly string[]): { run: string; project: string; user: string } {
  const valores: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run" || arg === "--project" || arg === "--user") {
      const valor = argv[i + 1];
      if (valor === undefined) fail(`${arg} exige um valor.`);
      valores[arg.slice(2)] = valor;
      i += 1;
      continue;
    }
    fail(`Argumento desconhecido: ${arg ?? ""}. Uso: --run <uuid> --project <uuid> --user <uuid>`);
  }
  const parsed = ArgsSchema.safeParse(valores);
  if (!parsed.success) {
    fail(
      `Uso: --run <uuid> --project <uuid> --user <uuid>. ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

function fail(message: string): never {
  console.error(`orchestration-mcp: ${message}`);
  process.exit(EXIT_USAGE);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const databaseUrl = process.env["DATABASE_URL"]?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    fail("DATABASE_URL não está no ambiente. O Worker a entrega pela allow-list do harness.");
  }

  const handle: DatabaseHandle = createDatabase({
    url: databaseUrl,
    // Uma ferramenta por vez, e uma conexão de folga para a que ficou presa.
    max: 2,
    applicationName: "dungeon-master-orchestration-mcp",
  });

  const server = createOrchestrationMcpServer({
    store: createDatabaseOrchestrationToolStore(handle.db, {
      userId: args.user,
      projectId: args.project,
      runId: args.run,
    }),
    runId: args.run,
    projectId: args.project,
  });

  let encerrando = false;
  const encerrar = async (): Promise<void> => {
    if (encerrando) return;
    encerrando = true;
    try {
      await server.close();
    } catch {
      // O transporte já pode ter fechado sozinho; o que importa é o pool.
    }
    await handle.close().catch(() => undefined);
    process.exit(0);
  };

  // SIGBREAK junto de SIGINT e SIGTERM (CLAUDE.md, seção 8).
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
    process.on(signal, () => void encerrar());
  }
  process.stdin.on("end", () => void encerrar());
  server.server.onclose = () => void encerrar();

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(
    `orchestration-mcp: falha na partida: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
