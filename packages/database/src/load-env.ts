/**
 * Carga do ambiente dos scripts de banco (`pnpm db:migrate`, `pnpm db:seed`).
 * Precisa ser o **primeiro** import de cada script: em ESM os módulos
 * importados são avaliados na ordem em que aparecem, e `resolveDatabaseUrl()`
 * lê `process.env` no corpo do script.
 *
 * Lê o `.env` de `packages/database` e o `.env` da raiz do monorepo, nessa
 * ordem de precedência. Não troque por `import "dotenv/config"`: ele só olha
 * para `process.cwd()`, e `pnpm --filter` deixa o `cwd` no diretório do pacote
 * — que é exatamente como uma migração ia parar no banco errado
 * (post-mortem #2, em `@dungeon-master/platform`).
 *
 * O módulo mora em `src/` e não em `scripts/` porque o `.env` da raiz é o que
 * decide o `DATABASE_URL` de uma migração, e isso merece teste: `src/` é o que
 * o Vitest deste pacote coleta (`src/load-env.test.ts`). Nada da biblioteca o
 * importa; ele é side-effect de ponto de entrada.
 */
import { loadWorkspaceEnv } from "@dungeon-master/platform";
import { config as dotenvConfig } from "dotenv";

loadWorkspaceEnv(dotenvConfig);
