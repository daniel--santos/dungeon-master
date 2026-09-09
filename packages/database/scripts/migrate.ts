import "../src/load-env.js";

import { resolveDatabaseUrl } from "../src/env.js";
import { runMigrations } from "../src/migrate.js";

const url = resolveDatabaseUrl();

const result = await runMigrations(url);

console.log(`[db:migrate] migrações aplicadas a partir de ${result.migrationsFolder}`);
console.log(`[db:migrate] concluído em ${result.durationMs} ms`);
