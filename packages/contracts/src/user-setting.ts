import { z } from "zod";

/**
 * Configuração do usuário local: chave textual e valor JSON.
 *
 * É onde a preferência do interruptor "Tema Dungeon Master" será guardada
 * (planejamento v0.4, seção 47.1). O endpoint de configurações não faz parte
 * da Fase 0 do esqueleto; aqui existe apenas o contrato.
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

/** Chave de configuração: minúsculas, dígitos, ponto, hífen e sublinhado. */
export const UserSettingKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "A chave usa minúsculas, dígitos, ponto, hífen e sublinhado.")
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
