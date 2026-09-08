import { z } from "zod";

import { PageQuerySchema, paginatedSchema } from "./pagination.js";
import { TaskKindSchema, TaskPrioritySchema } from "./task.js";

/**
 * ProposedTask: trabalho que um agente encontrou pelo caminho e não fez
 * (planejamento v0.4, Fase 5).
 *
 * Nasce dos `discoveredTasks` do `TaskExecutionResult`, gravada **na mesma
 * transação** em que `run.result` e o status terminal do Run são escritos
 * (documento técnico, seções 21 e 39): uma proposta que commitasse separada do
 * desfecho seria uma proposta que pode se perder em silêncio, e o caminho de
 * escrita de resultado não é fire-and-forget.
 *
 * Aprovar é criar trabalho de verdade: uma Task no mesmo Project, filha da
 * Task de origem por padrão, com as dependências que quem aprovou escolheu. A
 * decisão é um CAS (`status = 'PROPOSED'`), como o do ApprovalGate: quem perde
 * a corrida recebe `409` com a proposta como ela está, e nada é sobrescrito.
 * Não há inferência por modelo em nenhum passo: as dependências são
 * explícitas, e a política de autoaprovação é um ponto de extensão que hoje
 * sempre devolve revisão humana (`decideProposalPolicy`, em
 * `@dungeon-master/domain`).
 */

export const PROPOSED_TASK_STATUS_VALUES = ["PROPOSED", "APPROVED", "REJECTED"] as const;

export const ProposedTaskStatusSchema = z
  .enum(PROPOSED_TASK_STATUS_VALUES)
  .meta({ id: "ProposedTaskStatus", description: "Estado de uma ProposedTask." });

export type ProposedTaskStatus = z.infer<typeof ProposedTaskStatusSchema>;

export const PROPOSED_TASK_NOTE_MAX_LENGTH = 5_000;

export const ProposedTaskSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 da proposta."),
    projectId: z.uuid().describe("Project da Task de origem. A Task aprovada nasce nele."),
    originTaskId: z.uuid().describe("A Task cujo Run encontrou este trabalho."),
    originRunId: z.uuid().describe("O Run cujo resultado propôs este trabalho."),
    title: z.string().describe("Título proposto pelo agente."),
    description: z.string().nullable().describe("Descrição proposta pelo agente."),
    rationale: z.string().nullable().describe("Por que o agente acha que ela precisa existir."),
    status: ProposedTaskStatusSchema,
    decidedAt: z.iso
      .datetime()
      .nullable()
      .describe("Quando a decisão foi gravada, em UTC. Nulo enquanto `PROPOSED`."),
    note: z.string().nullable().describe("Justificativa de quem decidiu, sanitizada."),
    createdTaskId: z
      .uuid()
      .nullable()
      .describe("A Task criada pela aprovação. Nulo até aprovar, e sempre nulo numa recusa."),
    createdAt: z.iso
      .datetime()
      .describe("Gravação, em UTC (ISO 8601): o instante do desfecho do Run."),
  })
  .meta({ id: "ProposedTask", description: "Trabalho proposto pelo resultado de um Run." });

export type ProposedTask = z.infer<typeof ProposedTaskSchema>;

/**
 * A proposta com os títulos que a lista mostra em toda linha.
 *
 * Vêm por junção, como `taskTitle` em `RunListItem`: sem eles a tela faria uma
 * leitura por proposta só para dizer de onde ela veio.
 */
export const ProposedTaskListItemSchema = ProposedTaskSchema.extend({
  originTaskTitle: z.string().describe("Título da Task de origem no momento da leitura."),
  projectTitle: z.string().describe("Título do Project no momento da leitura."),
}).meta({
  id: "ProposedTaskListItem",
  description: "Uma ProposedTask com os títulos da Task de origem e do Project.",
});

export type ProposedTaskListItem = z.infer<typeof ProposedTaskListItemSchema>;

export const ProposedTaskListQuerySchema = PageQuerySchema.extend({
  status: ProposedTaskStatusSchema.optional().describe("Só as propostas neste estado."),
  projectId: z.uuid().optional().describe("Só as propostas deste Project."),
  taskId: z.uuid().optional().describe("Só as propostas cuja Task de origem é esta."),
}).meta({ id: "ProposedTaskListQuery" });

export type ProposedTaskListQuery = z.infer<typeof ProposedTaskListQuerySchema>;

export const ProposedTaskPageSchema = paginatedSchema(
  ProposedTaskListItemSchema,
  "ProposedTaskPage",
  "Uma página de propostas, da mais recente para a mais antiga.",
);

export type ProposedTaskPage = z.infer<typeof ProposedTaskPageSchema>;

/** Teto de dependências numa aprovação. Acima disso é engano, não intenção. */
export const PROPOSED_TASK_MAX_DEPENDENCIES = 100;

export const ApproveProposedTaskSchema = z
  .object({
    parentTaskId: z
      .uuid()
      .nullish()
      .describe(
        "Task mãe da Task criada. Ausente usa a Task de origem da proposta; `null` cria uma " +
          "Task sem mãe. Precisa pertencer ao mesmo Project e não estar em `INBOX`.",
      ),
    dependsOn: z
      .array(z.uuid())
      .max(PROPOSED_TASK_MAX_DEPENDENCIES)
      .optional()
      .describe(
        "Tasks que precisam terminar antes da Task criada poder ser enfileirada. Todas do " +
          "mesmo Project. Escolhidas por quem aprova: nada é inferido.",
      ),
    kind: TaskKindSchema.optional().describe("Natureza da Task criada. Padrão: `FEATURE`."),
    priority: TaskPrioritySchema.optional().describe(
      "Prioridade da Task criada. Padrão: `MEDIUM`.",
    ),
    workflowId: z
      .uuid()
      .optional()
      .describe("Workflow que os Runs da Task criada seguem. Ausente é o Run simples."),
    note: z
      .string()
      .trim()
      .max(PROPOSED_TASK_NOTE_MAX_LENGTH)
      .optional()
      .describe("Justificativa da aprovação. Fica na proposta."),
  })
  .meta({
    id: "ApproveProposedTask",
    description: "Corpo de `POST /api/v1/proposed-tasks/{id}/approve`.",
  });

export type ApproveProposedTask = z.infer<typeof ApproveProposedTaskSchema>;

export const RejectProposedTaskSchema = z
  .object({
    note: z
      .string()
      .trim()
      .max(PROPOSED_TASK_NOTE_MAX_LENGTH)
      .optional()
      .describe("Por que a proposta foi recusada. Fica na proposta."),
  })
  .meta({
    id: "RejectProposedTask",
    description: "Corpo de `POST /api/v1/proposed-tasks/{id}/reject`.",
  });

export type RejectProposedTask = z.infer<typeof RejectProposedTaskSchema>;
