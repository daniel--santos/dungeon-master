import { z } from "zod";

/** Resultado da checagem de conectividade com o PostgreSQL (`SELECT 1`). */
export const DatabaseHealthSchema = z
  .object({
    ok: z.boolean().describe("Verdadeiro quando o `SELECT 1` respondeu."),
    latencyMs: z.number().int().nonnegative().describe("Tempo da consulta, em milissegundos."),
    error: z
      .string()
      .nullable()
      .describe("Mensagem do erro quando a consulta falhou; nulo caso contrário."),
  })
  .meta({ id: "DatabaseHealth", description: "Estado da conexão com o banco." });

export type DatabaseHealth = z.infer<typeof DatabaseHealthSchema>;

/** Estado agregado do serviço. `degraded` significa processo no ar com dependência fora. */
export const HealthStatusSchema = z.enum(["ok", "degraded"]).meta({ id: "HealthStatus" });

export type HealthStatus = z.infer<typeof HealthStatusSchema>;

/** Corpo de `GET /api/v1/health`. */
export const HealthResponseSchema = z
  .object({
    status: HealthStatusSchema,
    service: z.string().describe("Nome do processo que respondeu."),
    version: z.string().describe("Versão do pacote da API."),
    uptimeSeconds: z.number().nonnegative().describe("Segundos desde o boot do processo."),
    checkedAt: z.iso.datetime().describe("Instante da checagem, em UTC (ISO 8601)."),
    database: DatabaseHealthSchema,
  })
  .meta({ id: "HealthResponse", description: "Saúde da API e de suas dependências." });

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
