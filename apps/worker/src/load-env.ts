/**
 * Carga do ambiente do Worker e da CLI `pnpm dm`. Precisa ser o **primeiro**
 * import dos dois pontos de entrada: em ESM os módulos importados são
 * avaliados na ordem em que aparecem, e a configuração é lida no corpo dos
 * módulos seguintes.
 *
 * Lê o `.env` de `apps/worker` e o `.env` da raiz do monorepo, nessa ordem de
 * precedência. Não troque por `import "dotenv/config"`: ele só olha para
 * `process.cwd()`, e `pnpm --filter` deixa o `cwd` no diretório do pacote
 * (post-mortem #2, em `@dungeon-master/platform`).
 */
import { loadWorkspaceEnv } from "@dungeon-master/platform";
import { config as dotenvConfig } from "dotenv";

loadWorkspaceEnv(dotenvConfig);
