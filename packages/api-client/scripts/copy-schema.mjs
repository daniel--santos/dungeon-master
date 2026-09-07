/**
 * `src/schema.d.ts` é gerado por `openapi-typescript` e contém apenas
 * declarações de tipo. O `tsc` usa o arquivo para checar tipos, mas não o
 * emite em `dist/`, porque não há JavaScript para gerar. Sem esta cópia, o
 * `dist/index.d.ts` apontaria para um módulo inexistente.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const source = join(packageRoot, "src", "schema.d.ts");
const target = join(packageRoot, "dist", "schema.d.ts");

if (!existsSync(source)) {
  console.error(`[api-client] ${source} não existe. Rode \`pnpm gen\` na raiz do monorepo.`);
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`[api-client] schema.d.ts copiado para ${target}`);
