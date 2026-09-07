import { defineConfig } from "drizzle-kit";

import { resolveDatabaseUrl } from "./src/env.js";

/**
 * `drizzle-kit generate` é offline: compara o schema com os snapshots em
 * `drizzle/meta` e não abre conexão. As credenciais só são usadas por
 * `drizzle-kit studio` e por comandos que tocam o banco.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
  dbCredentials: {
    url: resolveDatabaseUrl({ silent: true }),
  },
});
