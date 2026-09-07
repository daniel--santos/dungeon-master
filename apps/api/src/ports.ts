import type {
  Activity,
  Agent,
  DashboardEvent,
  DashboardEventType,
  ExecutionProfile,
  Harness,
  JsonValue,
  Loadout,
  Model,
  Project,
  ProjectDetail,
  ProjectStatus,
  Run,
  RunEvent,
  SortOrder,
  Task,
  TaskDetail,
  TaskKind,
  TaskPriority,
  TaskSort,
  TaskStatus,
  UserSettings,
  UserSettingsKey,
  WorkspaceKind,
} from "@dungeon-master/contracts";
import type {
  CreateAgentInput,
  CreateExecutionProfileInput,
  CreateLoadoutInput,
  DependencyWriteFailure,
  InboxFailure,
  PageResult,
  RegistryWriteFailure,
  Result,
  RunFilters,
  RunWriteFailure,
  TaskFilters,
  TaskWriteFailure,
  UpdateAgentPatch,
  UpdateExecutionProfilePatch,
  UpdateLoadoutPatch,
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
  list(
    input: PageRequest & { status?: ProjectStatus | undefined },
  ): Promise<PageResult<ProjectDetail>>;
  create(input: { title: string; description?: string | null }): Promise<Project>;
  get(projectId: string): Promise<ProjectDetail | null>;
  update(projectId: string, patch: UpdateProjectRequest): Promise<ProjectDetail | null>;
  setArchived(projectId: string, archived: boolean): Promise<ProjectDetail | null>;
  /** `null` quando o Project não existe: o diário de um Project inexistente é 404. */
  activity(projectId: string, page: PageRequest): Promise<PageResult<Activity> | null>;
}

/**
 * O que `PATCH /projects/{id}` aceita, já validado.
 *
 * `workspacePath` chega aqui **normalizado e conferido no disco** pelo handler:
 * o repositório não conhece o sistema de arquivos, e um caminho relativo ou
 * inexistente precisa virar `400` com a explicação, não uma linha gravada.
 */
export interface UpdateProjectRequest {
  title?: string;
  description?: string | null;
  workspaceKind?: WorkspaceKind;
  workspacePath?: string | null;
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

// --------------------------------------------------------------------------
// Cadastros de execução
// --------------------------------------------------------------------------

/**
 * Harness é cadastro **fechado**: as quatro linhas nascem no `db:seed` e a API
 * não cria nem apaga. Um harness novo é um adapter novo, não um `INSERT`.
 */
export interface HarnessesPort {
  list(): Promise<Harness[]>;
  setEnabled(harnessId: string, enabled: boolean): Promise<Harness | null>;
}

export interface ModelsPort {
  list(harnessId?: string | undefined): Promise<Model[]>;
  create(input: {
    harnessId: string;
    key: string;
    name: string;
    isDefault?: boolean;
  }): Promise<Result<Model, RegistryWriteFailure>>;
  update(
    modelId: string,
    patch: { key?: string; name?: string; isDefault?: boolean },
  ): Promise<Result<Model, RegistryWriteFailure> | null>;
  remove(modelId: string): Promise<Result<null, RegistryWriteFailure> | null>;
}

export interface AgentsPort {
  list(): Promise<Agent[]>;
  get(agentId: string): Promise<Agent | null>;
  create(input: Omit<CreateAgentInput, "userId">): Promise<Result<Agent, RegistryWriteFailure>>;
  update(
    agentId: string,
    patch: UpdateAgentPatch,
  ): Promise<Result<Agent, RegistryWriteFailure> | null>;
  remove(agentId: string): Promise<Result<null, RegistryWriteFailure> | null>;
}

export interface ExecutionProfilesPort {
  list(): Promise<ExecutionProfile[]>;
  get(executionProfileId: string): Promise<ExecutionProfile | null>;
  create(
    input: Omit<CreateExecutionProfileInput, "userId">,
  ): Promise<Result<ExecutionProfile, RegistryWriteFailure>>;
  update(
    executionProfileId: string,
    patch: UpdateExecutionProfilePatch,
  ): Promise<Result<ExecutionProfile, RegistryWriteFailure> | null>;
  remove(executionProfileId: string): Promise<Result<null, RegistryWriteFailure> | null>;
}

export interface LoadoutsPort {
  list(): Promise<Loadout[]>;
  get(loadoutId: string): Promise<Loadout | null>;
  create(input: Omit<CreateLoadoutInput, "userId">): Promise<Result<Loadout, RegistryWriteFailure>>;
  update(
    loadoutId: string,
    patch: UpdateLoadoutPatch,
  ): Promise<Result<Loadout, RegistryWriteFailure> | null>;
  remove(loadoutId: string): Promise<Result<null, RegistryWriteFailure> | null>;
}

/**
 * O stream de eventos de um Run.
 *
 * `open` devolve o transporte daquele Run e a fonte de replay; `close` é
 * obrigatório e libera o poller quando ninguém mais está assinando. Sem o
 * `close`, um Run olhado uma vez continuaria consultando o banco para sempre.
 */
export interface RunStreamHandle {
  readonly transport: SseTransport<RunEvent>;
  listSince(afterSequence: number, limit: number): Promise<RunEvent[]>;
  close(): void;
}

export interface RunsPort {
  list(input: PageRequest & { filters: RunFilters }): Promise<PageResult<Run>>;
  get(runId: string): Promise<Run | null>;
  create(
    taskId: string,
    input: {
      loadoutId?: string;
      executionProfileId?: string;
      prompt?: string;
      resumeFromRunId?: string;
    },
  ): Promise<Result<Run, RunWriteFailure> | null>;
  cancel(runId: string): Promise<Result<Run, RunWriteFailure> | null>;
  events(runId: string, input: { afterSequence: number; limit: number }): Promise<RunEvent[]>;
  openStream(runId: string): RunStreamHandle;
}

/** As portas de execução juntas, para `createApp` receber uma em vez de seis. */
export interface ExecutionPort {
  readonly harnesses: HarnessesPort;
  readonly models: ModelsPort;
  readonly agents: AgentsPort;
  readonly executionProfiles: ExecutionProfilesPort;
  readonly loadouts: LoadoutsPort;
  readonly runs: RunsPort;
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
  execution: ExecutionPort;
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
    execution: {
      harnesses: {
        list: inerte("a listagem de Harnesses"),
        setEnabled: inerte("o interruptor de Harness"),
      },
      models: {
        list: inerte("a listagem de Models"),
        create: inerte("a criação de Model"),
        update: inerte("a edição de Model"),
        remove: inerte("a remoção de Model"),
      },
      agents: {
        list: inerte("a listagem de Agents"),
        get: inerte("a leitura de Agent"),
        create: inerte("a criação de Agent"),
        update: inerte("a edição de Agent"),
        remove: inerte("a remoção de Agent"),
      },
      executionProfiles: {
        list: inerte("a listagem de ExecutionProfiles"),
        get: inerte("a leitura de ExecutionProfile"),
        create: inerte("a criação de ExecutionProfile"),
        update: inerte("a edição de ExecutionProfile"),
        remove: inerte("a remoção de ExecutionProfile"),
      },
      loadouts: {
        list: inerte("a listagem de Loadouts"),
        get: inerte("a leitura de Loadout"),
        create: inerte("a criação de Loadout"),
        update: inerte("a edição de Loadout"),
        remove: inerte("a remoção de Loadout"),
      },
      runs: {
        list: inerte("a listagem de Runs"),
        get: inerte("a leitura de Run"),
        create: inerte("a criação de Run"),
        cancel: inerte("o cancelamento de Run"),
        events: inerte("o log de eventos de Run"),
        openStream: () => recusar("o stream de eventos de Run"),
      },
    },
    // Vazio, e não o catálogo de verdade: o `pnpm gen` instancia a app só pela
    // forma das rotas, e ler o disco ali faria a spec depender de um arquivo
    // que nada na spec descreve. O catálogo real entra por injeção no boot.
    achievements: { definitions: [], templates: [], invalid: [] },
  };
}
