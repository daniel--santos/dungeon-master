import type {
  Activity,
  DashboardEvent,
  DashboardEventType,
  JsonValue,
  Project,
  ProjectDetail,
  ProjectStatus,
  SortOrder,
  Task,
  TaskDetail,
  TaskKind,
  TaskPriority,
  TaskSort,
  TaskStatus,
  UserSettings,
  UserSettingsKey,
} from "@dungeon-master/contracts";
import type {
  DependencyWriteFailure,
  InboxFailure,
  PageResult,
  Result,
  TaskFilters,
  TaskWriteFailure,
} from "@dungeon-master/database";
import { SseTransport } from "@dungeon-master/events";

import type { AchievementCatalog } from "./routes/achievements.js";

/**
 * As dependências que `createApp` recebe de fora.
 *
 * Toda uma por injeção, e nenhuma aberta no escopo do módulo: o
 * `scripts/gen-openapi.ts` instancia a app para gerar a spec sem servidor e sem
 * PostgreSQL, e um handler que abrisse conexão na importação quebraria o
 * `pnpm gen` e o CI junto.
 */

/** Resultado do `SELECT 1` que o health check reporta. */
export interface DatabaseProbe {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly error: string | null;
}

/** O transporte SSE já ligado ao poller e ao ouvinte de NOTIFY. */
export type DashboardEventTransport = SseTransport<DashboardEvent>;

export interface DashboardEventsPort {
  readonly transport: DashboardEventTransport;
  /** Eventos posteriores ao cursor, em ordem crescente de `sequence`. */
  listSince(afterSequence: number, limit: number): Promise<DashboardEvent[]>;
  /** Grava um evento. Hoje só o endpoint de ping usa. */
  append(input: { type: DashboardEventType; payload: JsonValue }): Promise<DashboardEvent>;
}

export interface SettingsPort {
  /** O objeto completo, com os padrões aplicados. */
  read(): Promise<UserSettings>;
  /**
   * Grava uma chave e emite `settings.changed` **na mesma transação**, e
   * devolve o objeto completo já atualizado.
   */
  write(key: UserSettingsKey, value: JsonValue): Promise<UserSettings>;
}

/** Paginação já resolvida em números pelo handler. */
export interface PageRequest {
  page: number;
  pageSize: number;
}

/**
 * As três portas de trabalho: Project, Task e Inbox.
 *
 * Cada método espelha uma função de `@dungeon-master/database`, com o `userId`
 * já fechado na composição — a API nunca escolhe de quem são os dados.
 *
 * A convenção de retorno é a mesma do repositório e é o que dá à API os três
 * status HTTP sem inspecionar mensagem de erro: `null` é 404, `{ ok: false }` é
 * a regra de domínio que vira 409 (ou 404, quando o id recusado veio no corpo),
 * e o resto é sucesso.
 */
export interface ProjectsPort {
  list(input: PageRequest & { status?: ProjectStatus | undefined }): Promise<PageResult<Project>>;
  create(input: { title: string; description?: string | null }): Promise<Project>;
  get(projectId: string): Promise<ProjectDetail | null>;
  update(
    projectId: string,
    patch: { title?: string; description?: string | null },
  ): Promise<ProjectDetail | null>;
  setArchived(projectId: string, archived: boolean): Promise<ProjectDetail | null>;
  /** `null` quando o Project não existe: o diário de um Project inexistente é 404. */
  activity(projectId: string, page: PageRequest): Promise<PageResult<Activity> | null>;
}

export interface CreateTaskRequest {
  projectId: string;
  parentTaskId?: string | null;
  title: string;
  description?: string | null;
  kind?: TaskKind;
  priority?: TaskPriority;
}

export interface UpdateTaskRequest {
  projectId?: string;
  parentTaskId?: string | null;
  title?: string;
  description?: string | null;
  kind?: TaskKind;
  priority?: TaskPriority;
}

export interface TasksPort {
  list(
    input: PageRequest & {
      filters: TaskFilters;
      sort: TaskSort;
      order: SortOrder;
    },
  ): Promise<PageResult<Task>>;
  create(input: CreateTaskRequest): Promise<Result<Task, TaskWriteFailure>>;
  get(taskId: string): Promise<TaskDetail | null>;
  update(
    taskId: string,
    patch: UpdateTaskRequest,
  ): Promise<Result<TaskDetail, TaskWriteFailure> | null>;
  changeStatus(
    taskId: string,
    to: TaskStatus,
  ): Promise<Result<TaskDetail, TaskWriteFailure> | null>;
  addDependency(
    taskId: string,
    dependsOnTaskId: string,
  ): Promise<Result<TaskDetail, DependencyWriteFailure> | null>;
  removeDependency(taskId: string, dependsOnTaskId: string): Promise<TaskDetail | null>;
}

export interface PromoteInboxRequest {
  projectId: string;
  title?: string;
  kind?: TaskKind;
  priority?: TaskPriority;
}

export interface InboxPort {
  capture(text: string): Promise<Task>;
  list(page: PageRequest): Promise<PageResult<Task>>;
  promote(taskId: string, input: PromoteInboxRequest): Promise<Result<Task, InboxFailure> | null>;
  discard(taskId: string): Promise<Result<Task, InboxFailure> | null>;
}

/** As três juntas, para `createApp` receber uma dependência em vez de três. */
export interface WorkPort {
  readonly projects: ProjectsPort;
  readonly tasks: TasksPort;
  readonly inbox: InboxPort;
}

/**
 * Portas inertes, para quando a app é instanciada só pela forma das rotas.
 *
 * Usadas por `scripts/gen-openapi.ts` e pelos testes que só olham `/health`.
 * Toda chamada lança: se um handler que deveria estar desligado for exercitado,
 * o teste falha alto em vez de passar por acidente.
 */
export function createSpecPorts(): {
  probeDatabase: () => Promise<DatabaseProbe>;
  events: DashboardEventsPort;
  settings: SettingsPort;
  work: WorkPort;
  achievements: AchievementCatalog;
} {
  const recusar = (recurso: string): never => {
    throw new Error(`Porta inerte: ${recurso} não está disponível nesta instância da app.`);
  };

  /**
   * Uma função que sempre lança serve para qualquer assinatura da porta: menos
   * parâmetros é aceito, e `Promise<never>` é atribuível a qualquer retorno.
   */
  const inerte = (recurso: string) => async (): Promise<never> => recusar(recurso);

  return {
    probeDatabase: async () => ({ ok: true, latencyMs: 0, error: null }),
    events: {
      // O transporte não abre nada até `start()`; construir é barato e sem efeito.
      transport: new SseTransport<DashboardEvent>({
        serialize: (event) => JSON.stringify(event),
        heartbeatIntervalMs: 0,
      }),
      listSince: async () => recusar("o replay de eventos"),
      append: async () => recusar("a gravação de eventos"),
    },
    settings: {
      read: async () => recusar("a leitura de configurações"),
      write: async () => recusar("a escrita de configurações"),
    },
    work: {
      projects: {
        list: inerte("a listagem de Projects"),
        create: inerte("a criação de Project"),
        get: inerte("a leitura de Project"),
        update: inerte("a edição de Project"),
        setArchived: inerte("o arquivamento de Project"),
        activity: inerte("o diário de Project"),
      },
      tasks: {
        list: inerte("a listagem de Tasks"),
        create: inerte("a criação de Task"),
        get: inerte("a leitura de Task"),
        update: inerte("a edição de Task"),
        changeStatus: inerte("a transição de status"),
        addDependency: inerte("a criação de dependência"),
        removeDependency: inerte("a remoção de dependência"),
      },
      inbox: {
        capture: inerte("a captura da Inbox"),
        list: inerte("a listagem da Inbox"),
        promote: inerte("a promoção de uma captura"),
        discard: inerte("o descarte de uma captura"),
      },
    },
    // Vazio, e não o catálogo de verdade: o `pnpm gen` instancia a app só pela
    // forma das rotas, e ler o disco ali faria a spec depender de um arquivo
    // que nada na spec descreve. O catálogo real entra por injeção no boot.
    achievements: { definitions: [], templates: [], invalid: [] },
  };
}
