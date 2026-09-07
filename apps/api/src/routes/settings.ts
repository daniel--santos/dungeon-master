import {
  ProblemDetailsSchema,
  UpdateUserSettingSchema,
  UserSettingKeySchema,
  UserSettingsSchema,
} from "@dungeon-master/contracts";
import { createRoute, z } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";

/**
 * A chave é validada como texto, e não como enum das chaves conhecidas.
 *
 * Se fosse enum, uma chave desconhecida viraria 400 no validador antes de
 * chegar ao handler, e o contrato pede 404: "esta configuração não existe" é
 * um recurso ausente, não um corpo malformado.
 */
export const SettingKeyParamSchema = z.object({
  key: UserSettingKeySchema.describe("Chave da configuração, como gravada em `user_setting`."),
});

export const settingsReadRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/settings`,
  tags: ["settings"],
  summary: "Configurações do usuário",
  description:
    "Devolve todas as chaves conhecidas, com os padrões aplicados sobre o que " +
    "estiver gravado em `user_setting`. Nenhuma chave falta na resposta.",
  responses: {
    200: {
      description: "Configurações atuais.",
      content: { "application/json": { schema: UserSettingsSchema } },
    },
  },
});

export const settingsUpdateRoute = createRoute({
  method: "put",
  path: `${API_BASE_PATH}/settings/{key}`,
  tags: ["settings"],
  summary: "Grava uma configuração",
  description:
    "Valida o valor pelo schema da chave, faz upsert e grava um evento " +
    "`settings.changed` na mesma transação. Devolve o objeto completo já " +
    "atualizado, para a tela não precisar de uma segunda ida ao servidor.",
  request: {
    params: SettingKeyParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: UpdateUserSettingSchema } },
    },
  },
  responses: {
    200: {
      description: "Configurações depois da escrita.",
      content: { "application/json": { schema: UserSettingsSchema } },
    },
    400: {
      description: "O valor não passou no schema da chave.",
      content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
    },
    404: {
      description: "A chave não existe no contrato de configurações.",
      content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
    },
  },
});
