import { z } from "zod";

import { SORT_ORDERS, TASK_SORT_FIELDS } from "@/lib/domain";

/**
 * Os parâmetros de busca tipados das telas com filtro.
 *
 * Toda chave tem `.catch()`: uma URL colada à mão, ou de uma versão anterior,
 * nunca derruba a rota — o valor inválido cai no padrão e a tela abre. Sem isso
 * `validateSearch` lançaria e o usuário veria uma tela de erro por causa de um
 * parâmetro que ele nem sabe que existe.
 *
 * Os valores são os enums canônicos, em maiúsculas, e não os labels: a URL não
 * muda com o interruptor de tema, que é a regra da seção 14 do planejamento.
 */

const TASK_KIND_VALUES = ["BUG", "FEATURE", "RESEARCH", "CHORE"] as const;
const TASK_PRIORITY_VALUES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const TASK_STATUS_VALUES = [
  "INBOX",
  "READY",
  "QUEUED",
  "RUNNING",
  "WAITING",
  "BLOCKED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export const taskSearchSchema = z.object({
  projectId: z.uuid().optional().catch(undefined),
  kind: z.enum(TASK_KIND_VALUES).optional().catch(undefined),
  priority: z.enum(TASK_PRIORITY_VALUES).optional().catch(undefined),
  status: z.array(z.enum(TASK_STATUS_VALUES)).nonempty().optional().catch(undefined),
  q: z.string().trim().min(1).optional().catch(undefined),
  sort: z.enum(TASK_SORT_FIELDS).default("updatedAt").catch("updatedAt"),
  order: z.enum(SORT_ORDERS).default("desc").catch("desc"),
  page: z.coerce.number().int().min(1).default(1).catch(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25).catch(25),
});

export type TaskSearch = z.infer<typeof taskSearchSchema>;

const RUN_STATUS_VALUES = [
  "CREATED",
  "QUEUED",
  "PREPARING",
  "RUNNING",
  "WAITING_APPROVAL",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
] as const;

const HARNESS_KEY_VALUES = ["CLAUDE_CODE", "CODEX", "PI", "ANTIGRAVITY"] as const;

/**
 * O filtro da lista de Expedições.
 *
 * Os três — `projectId`, `harnessKey` e `status` — viajam para a API, então o
 * link reproduz a mesma tela e o total do rodapé é o do servidor. Os valores
 * são os enums canônicos: a URL não muda com o interruptor de tema.
 */
export const runSearchSchema = z.object({
  projectId: z.uuid().optional().catch(undefined),
  taskId: z.uuid().optional().catch(undefined),
  harnessKey: z.enum(HARNESS_KEY_VALUES).optional().catch(undefined),
  status: z.array(z.enum(RUN_STATUS_VALUES)).nonempty().optional().catch(undefined),
  page: z.coerce.number().int().min(1).default(1).catch(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25).catch(25),
});

export type RunSearch = z.infer<typeof runSearchSchema>;

/** Os filtros do Diário de uma Expedição, na URL do cockpit. */
export const runDetailSearchSchema = z.object({
  events: z
    .enum(["all", "tools", "text", "usage", "system", "diagnostic"])
    .default("all")
    .catch("all"),
});

export type RunDetailSearch = z.infer<typeof runDetailSearchSchema>;

export const projectSearchSchema = z.object({
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional().catch(undefined),
});

export type ProjectSearch = z.infer<typeof projectSearchSchema>;

export const projectDetailSearchSchema = z.object({
  activityPage: z.coerce.number().int().min(1).default(1).catch(1),
});

export type ProjectDetailSearch = z.infer<typeof projectDetailSearchSchema>;
