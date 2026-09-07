import { z } from "zod";

/**
 * Configuração do usuário local: chave textual e valor JSON.
 *
 * É onde a preferência do interruptor "Tema Dungeon Master" fica guardada
 * (planejamento v0.4, seção 47.1). `UserSetting` é a linha crua da tabela;
 * `UserSettings` logo abaixo é a projeção tipada que a API expõe, com os
 * padrões já aplicados sobre o que estiver gravado.
 */

/** Qualquer valor representável em JSON, que é o que a coluna `value jsonb` aceita. */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Chave de configuração: começa em minúscula e segue em `camelCase` pontuado.
 *
 * O primeiro caractere continua tendo de ser minúsculo, para que `UI.Theme`
 * nunca seja aceito como sinônimo de `ui.theme` — duas grafias da mesma chave
 * seriam duas configurações no banco. Depois dele, maiúsculas são permitidas
 * porque a chave é um campo de JSON, e campo de JSON é `camelCase` neste
 * projeto (CLAUDE.md, seção 1): `execution.hostAcknowledged`.
 */
export const UserSettingKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-z0-9][A-Za-z0-9._-]*$/,
    "A chave começa em minúscula e segue em camelCase, com ponto, hífen e sublinhado.",
  )
  .meta({ id: "UserSettingKey" });

export type UserSettingKey = z.infer<typeof UserSettingKeySchema>;

/** Uma linha de `user_setting`. */
export const UserSettingSchema = z
  .object({
    userId: z.uuid().describe("UUIDv7 do usuário dono da configuração."),
    key: UserSettingKeySchema,
    value: JsonValueSchema.describe("Valor da configuração, em JSON."),
    updatedAt: z.iso.datetime().describe("Última escrita, em UTC (ISO 8601)."),
  })
  .meta({ id: "UserSetting", description: "Par chave/valor de configuração do usuário." });

export type UserSetting = z.infer<typeof UserSettingSchema>;

/** Corpo aceito ao gravar uma configuração. */
export const UserSettingWriteSchema = z
  .object({
    value: JsonValueSchema,
  })
  .meta({ id: "UserSettingWrite" });

export type UserSettingWrite = z.infer<typeof UserSettingWriteSchema>;

// --------------------------------------------------------------------------
// Configurações conhecidas
// --------------------------------------------------------------------------

/**
 * Qual dos dois glossários a interface usa.
 *
 * O tema é um skin: alternar troca só texto, e rotas, URLs, ícones, layout e
 * payloads são idênticos nos dois modos (planejamento v0.4, seção 47.1). O
 * padrão é `dnd`, que é o interruptor "Tema Dungeon Master" ligado.
 */
export const UiThemeSchema = z
  .enum(["dnd", "plain"])
  .meta({ id: "UiTheme", description: "Glossário ativo da interface." });

export type UiTheme = z.infer<typeof UiThemeSchema>;

/**
 * O aceite explícito de executar no modo `HOST`, sem isolamento.
 *
 * A Fase 2B exige aceite explícito antes de um Run em `HOST` (planejamento
 * v0.4, "Segurança obrigatória no modo HOST"). Perguntar a cada Expedição
 * treinaria o usuário a clicar sem ler, então o aceite fica gravado aqui e a
 * interface oferece revogá-lo em Settings. Guardar a preferência **não** apaga
 * o aviso: o badge de ambiente e o texto canônico continuam em toda tela.
 */
export const HostAcknowledgedSchema = z.boolean().meta({
  id: "HostAcknowledged",
  description: "O usuário já aceitou explicitamente executar sem isolamento no host.",
});

/**
 * O objeto completo de configurações do usuário, com todas as chaves conhecidas
 * sempre presentes.
 *
 * A chave é o mesmo texto gravado em `user_setting.key`, e não uma versão
 * camelizada, para que só exista um nome de configuração no sistema inteiro.
 */
export const UserSettingsSchema = z
  .object({
    "ui.theme": UiThemeSchema,
    "execution.hostAcknowledged": HostAcknowledgedSchema,
  })
  .meta({
    id: "UserSettings",
    description: "Configurações do usuário com os padrões já aplicados.",
  });

export type UserSettings = z.infer<typeof UserSettingsSchema>;

/** Padrões aplicados sobre o que não estiver gravado em `user_setting`. */
export const DEFAULT_USER_SETTINGS: UserSettings = Object.freeze({
  "ui.theme": "dnd",
  // O padrão é não ter aceitado: o aviso do modo host aparece na primeira vez.
  "execution.hostAcknowledged": false,
});

/**
 * Schema do valor de cada chave conhecida.
 *
 * `PUT /api/v1/settings/{key}` consulta este mapa duas vezes: para decidir se a
 * chave existe (senão, 404) e para validar o valor (senão, 400). Manter os dois
 * lados no mesmo lugar impede que uma chave nova entre sem validação.
 */
export const USER_SETTING_VALUE_SCHEMAS = {
  "ui.theme": UiThemeSchema,
  "execution.hostAcknowledged": HostAcknowledgedSchema,
} as const satisfies Record<keyof UserSettings, z.ZodType>;

/** As chaves conhecidas, na ordem em que aparecem no objeto. */
export const USER_SETTINGS_KEYS = Object.keys(USER_SETTING_VALUE_SCHEMAS) as Array<
  keyof UserSettings
>;

export type UserSettingsKey = keyof UserSettings;

/** Verdadeiro quando a chave existe no contrato de configurações. */
export function isUserSettingsKey(key: string): key is UserSettingsKey {
  return Object.hasOwn(USER_SETTING_VALUE_SCHEMAS, key);
}

/**
 * Corpo de `PUT /api/v1/settings/{key}`.
 *
 * `value` é `unknown` no schema da rota porque a validação de verdade depende
 * da chave e acontece no handler, com `USER_SETTING_VALUE_SCHEMAS`. Fechar aqui
 * exigiria uma união de todos os valores possíveis, que ficaria desatualizada a
 * cada chave nova e não diria qual chave aceita qual valor.
 */
export const UpdateUserSettingSchema = z
  .object({
    value: z.unknown().describe("Novo valor da configuração. Validado pelo schema da chave."),
  })
  .meta({ id: "UpdateUserSetting", description: "Novo valor de uma configuração." });

export type UpdateUserSetting = z.infer<typeof UpdateUserSettingSchema>;
