import { z } from "zod";

import { PageQuerySchema, paginatedSchema, SortOrderSchema } from "./pagination.js";

/**
 * Task é a única entidade de trabalho do sistema.
 *
 * A Inbox não tem tabela própria: uma captura rápida é uma Task em `INBOX`, sem
 * Project (documento técnico, seção 38). Promover é atribuir um Project e
 * passar para `READY`. O banco garante a metade estrutural dessa regra com um
 * `CHECK (status = 'INBOX' OR project_id IS NOT NULL)`.
 *
 * Task não é Run (documento técnico, seção 5.1): Task é o trabalho, Run é uma
 * tentativa concreta de realizá-lo, e um Run chega só na Fase 2.
 */

/**
 * Os nove estados de uma Task (planejamento v0.4, Fase 1).
 *
 * O array vem antes do schema porque três lugares precisam dele como valor: o
 * `z.enum` aqui, o tipo `pgEnum` do PostgreSQL em `@dungeon-master/database` e
 * a tabela de transições de `@dungeon-master/domain`. Um único array impede que
 * os três divirjam sem erro de compilação.
 */
export const TASK_STATUS_VALUES = [
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

export const TaskStatusSchema = z
  .enum(TASK_STATUS_VALUES)
  .meta({ id: "TaskStatus", description: "Estado de uma Task na máquina de estados." });

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/**
 * Tipo de trabalho. `BUG` é o que alimenta o Bestiário e as Conquistas
 * (planejamento v0.4, seção 14) — mas isso é label de interface, não código.
 */
export const TASK_KIND_VALUES = ["BUG", "FEATURE", "RESEARCH", "CHORE"] as const;

export const TaskKindSchema = z
  .enum(TASK_KIND_VALUES)
  .meta({ id: "TaskKind", description: "Natureza do trabalho de uma Task." });

export type TaskKind = z.infer<typeof TaskKindSchema>;

export const TASK_PRIORITY_VALUES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export const TaskPrioritySchema = z
  .enum(TASK_PRIORITY_VALUES)
  .meta({ id: "TaskPriority", description: "Prioridade de uma Task." });

export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

/** Valores usados quando `POST /tasks` não diz nada a respeito. */
export const DEFAULT_TASK_KIND: TaskKind = "FEATURE";
export const DEFAULT_TASK_PRIORITY: TaskPriority = "MEDIUM";

/** Limites de texto, compartilhados entre criação, edição e captura. */
export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_DESCRIPTION_MAX_LENGTH = 20_000;

const TitleSchema = z.string().trim().min(1).max(TASK_TITLE_MAX_LENGTH);
const DescriptionSchema = z.string().max(TASK_DESCRIPTION_MAX_LENGTH);

// --------------------------------------------------------------------------
// Representações
// --------------------------------------------------------------------------

export const TaskSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 da Task."),
    projectId: z
      .uuid()
      .nullable()
      .describe("Project dono da Task. Nulo apenas enquanto o status é `INBOX`."),
    parentTaskId: z.uuid().nullable().describe("Task mãe, quando esta é uma subtarefa."),
    workflowId: z
      .uuid()
      .nullable()
      .describe(
        "Workflow que os Runs desta Task seguem. Nulo é o Run simples, de um agente só. " +
          "O Run congela a definição vigente ao nascer, então trocar aqui não afeta Run em voo.",
      ),
    title: z.string().describe("Título da Task."),
    description: z.string().nullable().describe("Descrição livre."),
    kind: TaskKindSchema,
    status: TaskStatusSchema,
    priority: TaskPrioritySchema,
    completedAt: z.iso
      .datetime()
      .nullable()
      .describe("Instante em que entrou em `COMPLETED`, em UTC (ISO 8601)."),
    createdAt: z.iso.datetime().describe("Criação, em UTC (ISO 8601)."),
    updatedAt: z.iso.datetime().describe("Última escrita, em UTC (ISO 8601)."),
  })
  .meta({ id: "Task", description: "Uma unidade de trabalho." });

export type Task = z.infer<typeof TaskSchema>;

/**
 * A forma reduzida usada nas listas que acompanham o detalhe de uma Task.
 *
 * Filhas, dependências e dependentes vêm assim, e não como `Task` inteira, para
 * o detalhe de uma Task com muitas ligações não virar uma resposta enorme
 * carregando descrições que a tela não mostra.
 */
export const TaskSummarySchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid().nullable(),
    title: z.string(),
    kind: TaskKindSchema,
    status: TaskStatusSchema,
    priority: TaskPrioritySchema,
  })
  .meta({ id: "TaskSummary", description: "Forma reduzida de uma Task, para listas de ligação." });

export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const TaskDetailSchema = TaskSchema.extend({
  children: z.array(TaskSummarySchema).describe("Subtarefas, da mais antiga para a mais nova."),
  dependencies: z
    .array(TaskSummarySchema)
    .describe("Tasks que precisam terminar antes desta poder ser enfileirada."),
  dependents: z.array(TaskSummarySchema).describe("Tasks que esperam por esta."),
}).meta({ id: "TaskDetail", description: "Uma Task com filhas, dependências e dependentes." });

export type TaskDetail = z.infer<typeof TaskDetailSchema>;

/** Quantas Tasks o Project tem em cada estado. Todas as chaves sempre presentes. */
export const TaskStatusCountsSchema = z
  .object({
    INBOX: z.number().int().nonnegative(),
    READY: z.number().int().nonnegative(),
    QUEUED: z.number().int().nonnegative(),
    RUNNING: z.number().int().nonnegative(),
    WAITING: z.number().int().nonnegative(),
    BLOCKED: z.number().int().nonnegative(),
    COMPLETED: z.number().int().nonnegative(),
    FAILED: z.number().int().nonnegative(),
    CANCELLED: z.number().int().nonnegative(),
  })
  .meta({ id: "TaskStatusCounts", description: "Contagem de Tasks por estado." });

export type TaskStatusCounts = z.infer<typeof TaskStatusCountsSchema>;

// --------------------------------------------------------------------------
// Escrita
// --------------------------------------------------------------------------

export const CreateTaskSchema = z
  .object({
    projectId: z
      .uuid()
      .describe(
        "Project dono da Task. Obrigatório: só a captura pela Inbox cria Task sem Project.",
      ),
    parentTaskId: z
      .uuid()
      .nullish()
      .describe("Task mãe. Precisa pertencer ao mesmo Project e não estar em `INBOX`."),
    workflowId: z
      .uuid()
      .nullish()
      .describe("Workflow que os Runs desta Task seguem. Precisa existir."),
    title: TitleSchema.describe("Título da Task."),
    description: DescriptionSchema.nullish().describe("Descrição livre."),
    kind: TaskKindSchema.optional().describe(`Padrão: \`${DEFAULT_TASK_KIND}\`.`),
    priority: TaskPrioritySchema.optional().describe(`Padrão: \`${DEFAULT_TASK_PRIORITY}\`.`),
  })
  .meta({ id: "CreateTask", description: "Corpo de `POST /api/v1/tasks`. Nasce em `READY`." });

export type CreateTask = z.infer<typeof CreateTaskSchema>;

/**
 * Campos editáveis de uma Task.
 *
 * `status` **não** entra aqui de propósito: mudar de estado passa pela máquina
 * de estados em `POST /api/v1/tasks/{id}/status`, que valida a transição e as
 * regras de filhas e dependências. Um `PATCH` que também mudasse status seria
 * uma segunda porta para o mesmo domínio, sem as mesmas checagens.
 */
export const UpdateTaskSchema = z
  .object({
    projectId: z
      .uuid()
      .optional()
      .describe("Move a Task para outro Project, que precisa estar ativo."),
    parentTaskId: z
      .uuid()
      .nullish()
      .describe("Troca ou remove a Task mãe. `null` desliga a subtarefa da mãe."),
    workflowId: z
      .uuid()
      .nullish()
      .describe(
        "Troca ou remove o Workflow. `null` volta ao Run simples. Não afeta Runs já criados: " +
          "cada um congelou a definição que valia quando nasceu.",
      ),
    title: TitleSchema.optional(),
    description: DescriptionSchema.nullish(),
    kind: TaskKindSchema.optional(),
    priority: TaskPrioritySchema.optional(),
  })
  .meta({
    id: "UpdateTask",
    description: "Corpo de `PATCH /api/v1/tasks/{id}`. Status não entra.",
  });

export type UpdateTask = z.infer<typeof UpdateTaskSchema>;

export const ChangeTaskStatusSchema = z
  .object({
    to: TaskStatusSchema.describe("Estado desejado. Precisa ser alcançável a partir do atual."),
  })
  .meta({
    id: "ChangeTaskStatus",
    description: "Corpo de `POST /api/v1/tasks/{id}/status`.",
  });

export type ChangeTaskStatus = z.infer<typeof ChangeTaskStatusSchema>;

// --------------------------------------------------------------------------
// Listagem
// --------------------------------------------------------------------------

/**
 * `status` aceita um valor ou vários.
 *
 * Na query string `?status=READY&status=BLOCKED` chega como array e
 * `?status=READY` como texto — é assim que o Hono entrega os parâmetros
 * repetidos. Aceitar as duas formas evita que o filtro mais comum, o de um
 * estado só, precise de uma sintaxe especial.
 */
export const TaskStatusFilterSchema = z
  .union([TaskStatusSchema, z.array(TaskStatusSchema)])
  .optional()
  .describe("Filtra por um estado ou por vários, repetindo o parâmetro.");

/**
 * Por qual campo a listagem ordena.
 *
 * `priority` ordena por urgência, não pelo alfabeto: `URGENT` vem antes de
 * `HIGH`, que vem antes de `MEDIUM` e de `LOW`. Ordenar a prioridade como texto
 * poria `HIGH` antes de `URGENT` e a tela mostraria a fila errada.
 */
export const TASK_SORT_VALUES = ["updatedAt", "createdAt", "priority", "title"] as const;

export const TaskSortSchema = z
  .enum(TASK_SORT_VALUES)
  .meta({ id: "TaskSort", description: "Campo de ordenação de `GET /api/v1/tasks`." });

export type TaskSort = z.infer<typeof TaskSortSchema>;

/** Ordenação usada quando a requisição não pede nada. */
export const DEFAULT_TASK_SORT: TaskSort = "updatedAt";
export const DEFAULT_TASK_SORT_ORDER = "desc" as const;

export const TaskListQuerySchema = PageQuerySchema.extend({
  projectId: z.uuid().optional().describe("Só as Tasks deste Project."),
  parentTaskId: z.uuid().optional().describe("Só as subtarefas desta Task mãe."),
  kind: TaskKindSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  status: TaskStatusFilterSchema,
  /**
   * O avesso de `status`, para o caso mais comum da tela de Missões: "tudo
   * menos as capturas". Sem ele, tirar um único estado obrigaria a listar os
   * outros oito na URL, e cada estado novo da máquina quebraria o filtro em
   * silêncio, deixando de fora exatamente o que acabou de ser criado.
   *
   * Aplicado depois de `status`, e não no lugar dele: pedir os dois é legítimo
   * e a interseção é o resultado.
   */
  excludeStatus: TaskStatusFilterSchema.describe(
    "Esconde um estado ou vários, repetindo o parâmetro. Aplicado depois de `status`.",
  ),
  q: z
    .string()
    .trim()
    .min(1)
    .max(TASK_TITLE_MAX_LENGTH)
    .optional()
    .describe("Busca por trecho do título, sem diferenciar maiúsculas."),
  sort: TaskSortSchema.optional().describe(
    `Campo de ordenação. Padrão: \`${DEFAULT_TASK_SORT}\`. ` +
      "`priority` ordena por urgência (URGENT, HIGH, MEDIUM, LOW), não pelo alfabeto.",
  ),
  order: SortOrderSchema.optional().describe(`Direção. Padrão: \`${DEFAULT_TASK_SORT_ORDER}\`.`),
}).meta({ id: "TaskListQuery" });

export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;

export const TaskPageSchema = paginatedSchema(
  TaskSchema,
  "TaskPage",
  "Uma página de Tasks, na ordem pedida por `sort` e `order`.",
);

export type TaskPage = z.infer<typeof TaskPageSchema>;

// --------------------------------------------------------------------------
// Reaberturas
// --------------------------------------------------------------------------

/**
 * Quantas vezes uma Task saiu de `COMPLETED`.
 *
 * Não é coluna: é contado no diário (`activity`), das transições
 * `task.status_changed` que **saem** de `COMPLETED`. É a mesma definição que
 * instancia a Conquista de nêmesis, e existe uma só de propósito. A máquina de
 * estados de hoje não tem aresta saindo de `COMPLETED`, então a contagem é
 * zero para toda Task até que reabrir seja possível; a leitura já está pronta
 * para esse dia.
 */
export const TaskReopeningSchema = z
  .object({
    taskId: z.uuid(),
    count: z.number().int().positive().describe("Quantas vezes a Task saiu de `COMPLETED`."),
    lastReopenedAt: z.iso.datetime().describe("Instante da última reabertura, em UTC."),
  })
  .meta({
    id: "TaskReopening",
    description: "As reaberturas de uma Task, contadas no diário. Só Tasks com pelo menos uma.",
  });

export type TaskReopening = z.infer<typeof TaskReopeningSchema>;

export const TaskReopeningListQuerySchema = z
  .object({
    kind: TaskKindSchema.optional().describe("Só as Tasks deste tipo."),
  })
  .meta({ id: "TaskReopeningListQuery" });

export type TaskReopeningListQuery = z.infer<typeof TaskReopeningListQuerySchema>;

export const TaskReopeningListSchema = z
  .object({
    items: z
      .array(TaskReopeningSchema)
      .describe("Uma entrada por Task reaberta, da reabertura mais recente para a mais antiga."),
  })
  .meta({
    id: "TaskReopeningList",
    description: "As Tasks que já foram reabertas, com a contagem.",
  });

export type TaskReopeningList = z.infer<typeof TaskReopeningListSchema>;
