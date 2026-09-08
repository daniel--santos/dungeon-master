import {
  DEFAULT_USER_SETTINGS,
  isUserSettingsKey,
  type JsonValue,
  USER_SETTING_VALUE_SCHEMAS,
  type UserSettings,
  type UserSettingsKey,
} from "@dungeon-master/contracts";
import { eq, sql } from "drizzle-orm";

import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { userSettings } from "./schema/user.js";

export interface ReadUserSettingsInput {
  userId: string;
}

export interface WriteUserSettingInput {
  userId: string;
  key: UserSettingsKey;
  value: JsonValue;
}

/**
 * Lê `user_setting` e projeta em cima dos padrões.
 *
 * Um valor gravado que não passa mais no schema da chave — porque o contrato
 * mudou depois da escrita — é ignorado em favor do padrão, em vez de vazar
 * para a API e quebrar a validação da resposta. A linha continua no banco: uma
 * migração de dados é decisão consciente, não efeito colateral de um GET.
 */
export async function readUserSettings(
  db: DatabaseExecutor,
  input: ReadUserSettingsInput,
): Promise<UserSettings> {
  const rows = await db
    .select({ key: userSettings.key, value: userSettings.value })
    .from(userSettings)
    .where(eq(userSettings.userId, input.userId));

  const settings: UserSettings = { ...DEFAULT_USER_SETTINGS };

  for (const row of rows) {
    if (!isUserSettingsKey(row.key)) continue;

    const parsed = USER_SETTING_VALUE_SCHEMAS[row.key].safeParse(row.value);
    if (!parsed.success) continue;

    // `row.key` é a união das chaves conhecidas, e uma escrita em `obj[união]`
    // exige o tipo comum a todas — que não existe assim que há duas chaves de
    // tipos diferentes. O schema indexado pela mesma chave já validou o valor
    // na linha acima, então a correlação é real; o que falta é o TypeScript
    // conseguir enxergá-la sem um parâmetro genérico.
    Object.assign(settings, { [row.key]: parsed.data });
  }

  return settings;
}

/**
 * Grava a configuração e o evento `settings.changed` **na mesma transação**.
 *
 * Os dois juntos, ou nenhum: uma escrita que commitasse sem o evento deixaria a
 * tela mostrando o valor antigo até alguém recarregar, e um evento sem a
 * escrita mandaria a tela buscar um valor que não mudou.
 *
 * O `NOTIFY` sai do trigger, no COMMIT, então o drain só enxerga o par completo.
 */
export async function writeUserSetting(
  db: Database,
  input: WriteUserSettingInput,
): Promise<UserSettings> {
  // post-mortem #1 (08/09/2026): gravar `knowledge.loadoutId = null` respondia
  // 500. Para o Drizzle, `null` numa coluna `jsonb` é o NULL do SQL, e não o
  // `null` do JSON — a coluna é `not null` e a inserção falhava. O valor passa
  // a ir serializado e convertido explicitamente com `::jsonb`, o que grava o
  // literal `null` do JSON; a leitura já tratava `null` como valor válido da
  // chave. A configuração anulável da Fase 6 foi a primeira a exercitar isto.
  const value = sql`${JSON.stringify(input.value)}::jsonb`;

  return await db.transaction(async (tx) => {
    await tx
      .insert(userSettings)
      .values({ userId: input.userId, key: input.key, value })
      .onConflictDoUpdate({
        target: [userSettings.userId, userSettings.key],
        set: { value, updatedAt: new Date() },
      });

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "settings.changed",
      payload: { key: input.key, value: input.value },
    });

    return await readUserSettings(tx, { userId: input.userId });
  });
}
