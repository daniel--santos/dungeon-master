import {
  DEFAULT_USER_SETTINGS,
  isUserSettingsKey,
  type JsonValue,
  USER_SETTING_VALUE_SCHEMAS,
  type UserSettings,
  type UserSettingsKey,
} from "@dungeon-master/contracts";
import { eq } from "drizzle-orm";

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
  return await db.transaction(async (tx) => {
    await tx
      .insert(userSettings)
      .values({ userId: input.userId, key: input.key, value: input.value })
      .onConflictDoUpdate({
        target: [userSettings.userId, userSettings.key],
        set: { value: input.value, updatedAt: new Date() },
      });

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "settings.changed",
      payload: { key: input.key, value: input.value },
    });

    return await readUserSettings(tx, { userId: input.userId });
  });
}
