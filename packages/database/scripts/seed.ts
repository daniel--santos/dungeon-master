import "dotenv/config";

import { createDatabase } from "../src/client.js";
import { resolveDatabaseUrl } from "../src/env.js";
import { LOCAL_USER_ID, seedLocalUser } from "../src/seed.js";

const handle = createDatabase({
  url: resolveDatabaseUrl(),
  max: 1,
  applicationName: "dungeon-master-seed",
});

try {
  const result = await seedLocalUser(handle.db);
  const verb = result.created ? "criado" : "já existia";
  console.log(`[db:seed] usuário local ${LOCAL_USER_ID} ${verb}`);
} finally {
  await handle.close();
}
