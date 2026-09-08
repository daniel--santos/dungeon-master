import "dotenv/config";

import { createDatabase } from "../src/client.js";
import { seedDemoData } from "../src/demo.js";
import { resolveDatabaseUrl } from "../src/env.js";
import { LOCAL_USER_ID, seedLocalUser } from "../src/seed.js";
import { seedExecutionRegistry } from "../src/seed-execution.js";
import { seedKnowledgeLoadout } from "../src/seed-knowledge.js";
import { seedWorkflows } from "../src/seed-workflow.js";

/**
 * `pnpm db:seed` garante o usuário local, os quatro Harnesses, os dois
 * ExecutionProfiles e o Workflow de partida. `pnpm db:seed --demo` acrescenta a massa de demonstração:
 * dois Projects, catorze Tasks e três capturas na Inbox.
 *
 * A massa é opcional de propósito. O usuário local e os cadastros fechados são
 * infraestrutura — sem eles nada escreve e nenhum Loadout pode ser criado —,
 * mas dados de exemplo num banco de trabalho de verdade são lixo, e apagá-los à
 * mão é pior do que nunca tê-los criado.
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

  const execucao = await seedExecutionRegistry(handle.db, { userId: LOCAL_USER_ID });

  console.log(
    `[db:seed] execução: ${String(execucao.harnessesTotal)} Harnesses ` +
      `(${String(execucao.harnessesCreated)} novos), ` +
      `${String(execucao.executionProfilesTotal)} ExecutionProfiles ` +
      `(${String(execucao.executionProfilesCreated)} novos)`,
  );

  const escriba = await seedKnowledgeLoadout(handle.db, { userId: LOCAL_USER_ID });

  console.log(
    escriba.loadoutId === null
      ? `[db:seed] Loadout do Escriba não semeado: ${escriba.reason ?? "motivo desconhecido"}`
      : `[db:seed] Loadout do Escriba ${escriba.loadoutId} ${escriba.created ? "criado" : "já existia"}`,
  );

  const rituais = await seedWorkflows(handle.db, { userId: LOCAL_USER_ID });

  console.log(
    `[db:seed] workflows: ${String(rituais.workflowsTotal)} Workflows ` +
      `(${String(rituais.workflowsCreated)} novos)`,
  );

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
