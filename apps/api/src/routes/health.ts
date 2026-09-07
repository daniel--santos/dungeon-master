import { HealthResponseSchema, ProblemDetailsSchema } from "@dungeon-master/contracts";
import { createRoute } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";

export const healthRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/health`,
  tags: ["system"],
  summary: "Saúde da API",
  description:
    "Reporta o estado do processo e o resultado de um `SELECT 1` no PostgreSQL. " +
    "Responde 200 mesmo com o banco fora, com `status: degraded`, para que a " +
    "diferença entre 'processo caiu' e 'dependência caiu' fique visível.",
  responses: {
    200: {
      description: "Estado atual da API e do banco.",
      content: {
        "application/json": { schema: HealthResponseSchema },
      },
    },
    500: {
      description: "Falha inesperada.",
      content: {
        [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema },
      },
    },
  },
});
