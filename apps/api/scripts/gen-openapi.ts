/**
 * `pnpm --filter @dungeon-master/api gen` — escreve a spec OpenAPI.
 *
 * Não sobe servidor e não conecta no banco: instancia a app e pede o documento
 * ao gerador. O arquivo é commitado e o CI regenera para falhar em caso de
 * diff (planejamento v0.4, seção 3.8).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildOpenApiDocument } from "../src/openapi.js";

const OUTPUT = fileURLToPath(new URL("../../../packages/api-client/openapi.json", import.meta.url));

const document = buildOpenApiDocument();

// Indentação fixa e quebra de linha final: o diff precisa ser estável entre
// Windows e macOS, então a serialização não pode depender do ambiente.
const json = `${JSON.stringify(document, null, 2)}\n`;

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, json, { encoding: "utf8" });

const paths = Object.keys((document["paths"] as Record<string, unknown>) ?? {});
console.log(`[gen:openapi] ${OUTPUT}`);
console.log(`[gen:openapi] ${paths.length} caminho(s): ${paths.join(", ")}`);
