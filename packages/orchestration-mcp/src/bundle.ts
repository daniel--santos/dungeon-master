import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { ORCHESTRATION_MCP_BUNDLE_FILE } from "./entrypoint.js";

/**
 * O empacotamento do servidor num arquivo só, igual ao do Grimório
 * (`packages/knowledge-mcp/src/bundle.ts`): mora em `src/` porque o teste de
 * stdio usa a mesma função, e **não** é reexportado pelo `index.ts` — o
 * `esbuild` é dependência de desenvolvimento.
 */

export interface BundleOrchestrationMcpOptions {
  /** Ponto de entrada. Padrão: o `dist/bin.js` deste pacote. */
  readonly entry?: string;
  readonly outfile: string;
}

/** O caminho padrão do arquivo empacotado: `dist/bundle/orchestration-mcp.mjs`. */
export function defaultBundleOutfile(): string {
  return fileURLToPath(new URL(`../dist/bundle/${ORCHESTRATION_MCP_BUNDLE_FILE}`, import.meta.url));
}

export async function bundleOrchestrationMcp(
  options: BundleOrchestrationMcpOptions,
): Promise<void> {
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
