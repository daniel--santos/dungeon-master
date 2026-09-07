import { z } from "zod";

import { PageQuerySchema, paginatedSchema } from "./pagination.js";
import { TaskStatusCountsSchema } from "./task.js";

/**
 * Project é a unidade persistente de contexto (documento técnico, seção 3).
 *
 * Tasks, conhecimento, decisões e artefatos pertencem ao Project, não à sessão
 * de um agente. Arquivar é o fim de linha reversível: um Project arquivado não
 * aceita Task nova, mas continua legível.
 */

export const PROJECT_STATUS_VALUES = ["ACTIVE", "ARCHIVED"] as const;

export const ProjectStatusSchema = z
  .enum(PROJECT_STATUS_VALUES)
  .meta({ id: "ProjectStatus", description: "Estado de um Project." });

export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const PROJECT_TITLE_MAX_LENGTH = 200;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 20_000;

const TitleSchema = z.string().trim().min(1).max(PROJECT_TITLE_MAX_LENGTH);
const DescriptionSchema = z.string().max(PROJECT_DESCRIPTION_MAX_LENGTH);

export const ProjectSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do Project."),
    title: z.string().describe("Título do Project."),
    description: z.string().nullable().describe("Descrição livre."),
    status: ProjectStatusSchema,
    archivedAt: z.iso
      .datetime()
      .nullable()
      .describe("Instante do arquivamento, em UTC (ISO 8601). Nulo enquanto ativo."),
    createdAt: z.iso.datetime().describe("Criação, em UTC (ISO 8601)."),
    updatedAt: z.iso.datetime().describe("Última escrita, em UTC (ISO 8601)."),
  })
  .meta({ id: "Project", description: "A unidade persistente de contexto." });

export type Project = z.infer<typeof ProjectSchema>;

/**
 * O Project com a contagem de Tasks por estado.
 *
 * A contagem vem junto porque a tela de overview a mostra sempre, e uma segunda
 * requisição só para isso deixaria a página com dois estados de carregamento.
 */
export const ProjectDetailSchema = ProjectSchema.extend({
  taskCounts: TaskStatusCountsSchema.describe("Tasks do Project agrupadas por estado."),
}).meta({ id: "ProjectDetail", description: "Um Project com a contagem de Tasks por estado." });

export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;

export const CreateProjectSchema = z
  .object({
    title: TitleSchema.describe("Título do Project."),
    description: DescriptionSchema.nullish().describe("Descrição livre."),
  })
  .meta({ id: "CreateProject", description: "Corpo de `POST /api/v1/projects`." });

export type CreateProject = z.infer<typeof CreateProjectSchema>;

/**
 * Campos editáveis de um Project.
 *
 * `status` não entra: arquivar e desarquivar têm rotas próprias, que também
 * escrevem `archived_at`. Duas portas para o mesmo estado deixariam a coluna
 * de instante inconsistente.
 */
export const UpdateProjectSchema = z
  .object({
    title: TitleSchema.optional(),
    description: DescriptionSchema.nullish(),
  })
  .meta({ id: "UpdateProject", description: "Corpo de `PATCH /api/v1/projects/{id}`." });

export type UpdateProject = z.infer<typeof UpdateProjectSchema>;

export const ProjectListQuerySchema = PageQuerySchema.extend({
  status: ProjectStatusSchema.optional().describe("Só os Projects neste estado."),
}).meta({ id: "ProjectListQuery" });

export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;

export const ProjectPageSchema = paginatedSchema(
  ProjectSchema,
  "ProjectPage",
  "Uma página de Projects, do último editado para o mais antigo.",
);

export type ProjectPage = z.infer<typeof ProjectPageSchema>;
