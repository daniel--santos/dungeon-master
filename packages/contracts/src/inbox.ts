import { z } from "zod";

import { PageQuerySchema, paginatedSchema } from "./pagination.js";
import { TASK_TITLE_MAX_LENGTH, TaskKindSchema, TaskPrioritySchema, TaskSchema } from "./task.js";

/**
 * A Inbox é captura de intenção, não uma entidade (documento técnico, seção 38).
 *
 * Uma captura cria uma Task em `INBOX`, sem Project: o custo de anotar precisa
 * ser um campo de texto e nada mais. Promover atribui um Project e leva para
 * `READY`; descartar leva para `CANCELLED`. Nenhuma das duas apaga a linha, e o
 * que foi capturado continua auditável.
 */

export const CaptureInboxSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1)
      .max(TASK_TITLE_MAX_LENGTH)
      .describe("O texto da captura. Vira o título da Task em `INBOX`."),
  })
  .meta({ id: "CaptureInbox", description: "Corpo de `POST /api/v1/inbox`." });

export type CaptureInbox = z.infer<typeof CaptureInboxSchema>;

/**
 * Promover é o momento em que a captura vira trabalho de verdade.
 *
 * `projectId` é obrigatório porque `READY` sem Project é um estado que o banco
 * recusa: o `CHECK` da tabela só admite `project_id` nulo em `INBOX`.
 */
export const PromoteInboxSchema = z
  .object({
    projectId: z.uuid().describe("Project que passa a ser dono da Task."),
    title: z
      .string()
      .trim()
      .min(1)
      .max(TASK_TITLE_MAX_LENGTH)
      .optional()
      .describe("Substitui o texto capturado. Ausente mantém o título atual."),
    kind: TaskKindSchema.optional().describe("Ausente mantém o `kind` atual."),
    priority: TaskPrioritySchema.optional().describe("Ausente mantém a prioridade atual."),
  })
  .meta({ id: "PromoteInbox", description: "Corpo de `POST /api/v1/inbox/{id}/promote`." });

export type PromoteInbox = z.infer<typeof PromoteInboxSchema>;

export const InboxListQuerySchema = PageQuerySchema.meta({ id: "InboxListQuery" });

export type InboxListQuery = z.infer<typeof InboxListQuerySchema>;

export const InboxPageSchema = paginatedSchema(
  TaskSchema,
  "InboxPage",
  "Uma página da Inbox: Tasks em `INBOX`, da mais recente para a mais antiga.",
);

export type InboxPage = z.infer<typeof InboxPageSchema>;
