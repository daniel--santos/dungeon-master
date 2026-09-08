import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { KNOWLEDGE_MCP_BUNDLE_FILE } from "./entrypoint.js";

/**
 * O empacotamento do servidor num arquivo só.
 *
 * Fica em `src/` e não só no script de build porque o teste de stdio usa a
 * mesma função: o servidor que o teste sobe é empacotado do mesmo jeito que o
 * que o Worker monta no container. `esbuild` é dependência de desenvolvimento
 * e este módulo **não** é reexportado pelo `index.ts` — quem importa o pacote
 * em produção nunca o carrega.
 *
 * `pg-native` e `pg-cloudflare` ficam de fora: são os `require` opcionais do
 * `pg`, dentro de `try`/`catch`, para ambientes que este servidor não é. O
 * `require` de dentro do bundle ESM é o do `createRequire`, definido no topo.
 */

export interface BundleKnowledgeMcpOptions {
  /** Ponto de entrada. Padrão: o `dist/bin.js` deste pacote. */
  readonly entry?: string;
  readonly outfile: string;
}

/** O caminho padrão do arquivo empacotado: `dist/bundle/knowledge-mcp.mjs`. */
export function defaultBundleOutfile(): string {
  return fileURLToPath(new URL(`../dist/bundle/${KNOWLEDGE_MCP_BUNDLE_FILE}`, import.meta.url));
}

export async function bundleKnowledgeMcp(options: BundleKnowledgeMcpOptions): Promise<void> {
  const entry = options.entry ?? fileURLToPath(new URL("../dist/bin.js", import.meta.url));
  await mkdir(dirname(options.outfile), { recursive: true });
  await build({
    entryPoints: [entry],
    outfile: options.outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["pg-native", "pg-cloudflare"],
    banner: {
      js: "import { createRequire as __dmCreateRequire } from 'node:module';\nconst require = __dmCreateRequire(import.meta.url);",
    },
    legalComments: "none",
    sourcemap: false,
    logLevel: "silent",
  });
}
