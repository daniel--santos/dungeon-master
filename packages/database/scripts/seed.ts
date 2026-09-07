import "dotenv/config";

import { createDatabase } from "../src/client.js";
import { seedDemoData } from "../src/demo.js";
import { resolveDatabaseUrl } from "../src/env.js";
import { LOCAL_USER_ID, seedLocalUser } from "../src/seed.js";

/**
 * `pnpm db:seed` garante o usuário local. `pnpm db:seed --demo` acrescenta a
 * massa de demonstração: dois Projects, catorze Tasks e três capturas na Inbox.
 *
 * A massa é opcional de propósito. O usuário local é infraestrutura — sem ele
 * nada escreve —, mas dados de exemplo num banco de trabalho de verdade são
 * lixo, e apagá-los à mão é pior do que nunca tê-los criado.
 */
const demo = process.argv.slice(2).includes("--demo");

const handle = createDatabase({
  url: resolveDatabaseUrl(),
  max: 1,
  applicationName: "dungeon-master-seed",
});

try {
  const result = await seedLocalUser(handle.db);
  const verb = result.created ? "criado" : "já existia";
  console.log(`[db:seed] usuário local ${LOCAL_USER_ID} ${verb}`);

  if (demo) {
    const massa = await seedDemoData(handle.db, { userId: LOCAL_USER_ID });

    console.log(
      `[db:seed] demonstração: ${String(massa.projectsTotal)} Projects ` +
        `(${String(massa.projectsCreated)} novos), ${String(massa.tasksTotal)} Tasks ` +
        `(${String(massa.tasksCreated)} novas), incluindo ` +
        `${String(massa.capturesTotal)} capturas na Inbox`,
    );
  }
} finally {
  await handle.close();
}
