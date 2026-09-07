import { z } from "zod";

/**
 * RFC 9457 — Problem Details for HTTP APIs.
 *
 * Todo erro da API é serializado neste formato, com o content type
 * `application/problem+json` (planejamento v0.4, decisões de partida da Fase 0).
 */

/** Prefixo dos URIs de `type`. Não precisa resolver na rede; identifica a classe do erro. */
export const PROBLEM_TYPE_BASE_URI = "https://dungeon-master.local/problems" as const;

/** Um erro de validação individual, apontando o campo que falhou. */
export const ValidationIssueSchema = z
  .object({
    path: z
      .string()
      .describe("Caminho do campo com problema, em notação de ponto. Vazio para a raiz."),
    message: z.string().describe("Descrição legível do problema."),
    code: z.string().describe("Código do problema, vindo do schema Zod."),
  })
  .meta({ id: "ValidationIssue" });

export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

/** Corpo de resposta de qualquer erro da API. */
export const ProblemDetailsSchema = z
  .object({
    type: z
      .string()
      .describe("URI que identifica o tipo do problema. `about:blank` quando genérico."),
    title: z.string().describe("Resumo curto e estável do tipo do problema."),
    status: z.number().int().min(100).max(599).describe("Código HTTP da resposta."),
    detail: z.string().describe("Explicação específica desta ocorrência."),
    instance: z.string().describe("URI da ocorrência: o caminho da requisição."),
    requestId: z
      .string()
      .optional()
      .describe("Identificador da requisição, para casar com os logs."),
    errors: z
      .array(ValidationIssueSchema)
      .optional()
      .describe("Presente quando a validação de entrada falhou."),
  })
  .meta({
    id: "ProblemDetails",
    description: "Erro no formato RFC 9457 (`application/problem+json`).",
  });

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;
