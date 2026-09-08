import { DockerPreflightSchema } from "@dungeon-master/contracts";
import { createRoute } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";

/**
 * O preflight do backend Docker, sob demanda.
 *
 * Roda na chamada, nunca no boot: o daemon pode subir e cair entre duas
 * aberturas de Settings, e um resultado guardado diria "no ar" sobre um
 * Docker Desktop fechado. O caminho é `preflights/docker` para o de host
 * poder entrar ao lado dele um dia, sem mudar o recurso.
 */
export const dockerPreflightRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/preflights/docker`,
  tags: ["execution"],
  summary: "O preflight do backend Docker",
  description:
    "Mede na hora: daemon acessível e versão, imagem de referência presente e " +
    "seu `USER`, e, por harness que sabe rodar em container, a versão da CLI e a " +
    "checagem de credencial dentro de um container descartável. Teto curto por " +
    "comando e por harness; um harness que não responde sai com `timedOut`. Sem " +
    "daemon ou sem imagem os harnesses não são verificados. Um resultado " +
    "aprovado de um harness pode ser reaproveitado pelo adapter por alguns " +
    "minutos; o daemon e a imagem são medidos em toda chamada.",
  responses: {
    200: {
      description: "O resultado do preflight, mesmo com problemas: eles vêm no corpo.",
      content: { "application/json": { schema: DockerPreflightSchema } },
    },
  },
});
