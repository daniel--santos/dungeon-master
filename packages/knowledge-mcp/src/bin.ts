import { createDatabase, type DatabaseHandle } from "@dungeon-master/database";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createKnowledgeMcpServer } from "./server.js";
import { createDatabaseKnowledgeToolStore } from "./store-database.js";

/**
 * O processo do servidor: `node knowledge-mcp.mjs --project <id> --user <id>`.
 *
 * Três regras, todas visíveis no argv e no ambiente:
 *
 * - **ids no argv, segredo no ambiente.** `--project` e `--user` são
 *   identificadores; `DATABASE_URL` chega pela allow-list de ambiente do
 *   harness (ou pelo `-e NOME` do container) e nunca pela linha de comando,
 *   que qualquer processo da máquina lê (CLAUDE.md, seção 8).
 * - **stdout é do protocolo.** Todo aviso vai para o stderr: uma linha solta no
 *   stdout quebraria o JSON-RPC do cliente.
 * - **sem `DATABASE_URL`, não sobe.** Cair no banco de desenvolvimento por
 *   padrão faria um Run de outro ambiente consultar o Grimório errado em
 *   silêncio; é melhor o harness ver o servidor falhar na partida.
 */

const EXIT_USAGE = 2;

const ArgsSchema = z.object({
  project: z.uuid(),
  user: z.uuid(),
});

function parseArgs(argv: readonly string[]): { project: string; user: string } {
  const valores: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project" || arg === "--user") {
      const valor = argv[i + 1];
      if (valor === undefined) fail(`${arg} exige um valor.`);
      valores[arg.slice(2)] = valor;
      i += 1;
      continue;
    }
    fail(`Argumento desconhecido: ${arg ?? ""}. Uso: --project <uuid> --user <uuid>`);
  }
  const parsed = ArgsSchema.safeParse(valores);
  if (!parsed.success) {
    fail(
      `Uso: --project <uuid> --user <uuid>. ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

function fail(message: string): never {
  console.error(`knowledge-mcp: ${message}`);
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
    applicationName: "dungeon-master-knowledge-mcp",
  });

  const server = createKnowledgeMcpServer({
    store: createDatabaseKnowledgeToolStore(handle.db, {
      userId: args.user,
      projectId: args.project,
    }),
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
    // `exit` explícito: um handle de socket do `pg` ainda aberto seguraria o
    // processo, e o harness esperaria por um servidor que já não fala.
    process.exit(0);
  };

  // SIGBREAK junto de SIGINT e SIGTERM (CLAUDE.md, seção 8).
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
    process.on(signal, () => void encerrar());
  }
  // O cliente fechou o stdin: o Run acabou e o servidor vai junto.
  process.stdin.on("end", () => void encerrar());
  server.server.onclose = () => void encerrar();

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(
    `knowledge-mcp: falha na partida: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
