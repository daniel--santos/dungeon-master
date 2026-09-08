import { loadCatalog, loadTemplates, xpToNextLevel } from "@dungeon-master/achievements";
import { type DashboardEvent, RUN_EVENT_CHANNEL, type RunEvent } from "@dungeon-master/contracts";
import {
  addTaskDependency,
  appendDashboardEvent,
  approveForgedAchievement,
  approveKnowledgeItem,
  approveProposedTask,
  discardForgedAchievement,
  listAchievementUnlockPage,
  listAchievementViews,
  listDistillationRuns,
  listForgedAchievements,
  listKnowledgeItems,
  listProjectDecisions,
  markAchievementUnlockSeen,
  getKnowledgeItem,
  getProjectSummary,
  readHeroStats,
  rejectKnowledgeItem,
  renameForgedAchievement,
  requestDistillation,
  updateKnowledgeItem,
  captureInboxTask,
  changeTaskStatus,
  createAgent,
  createExecutionProfile,
  createLoadout,
  createModel,
  createPgNotifier,
  createProject,
  createRun,
  createTask,
  createWorkflow,
  type Database,
  type DatabaseHandle,
  DASHBOARD_EVENT_CHANNEL,
  deleteAgent,
  deleteExecutionProfile,
  deleteLoadout,
  deleteModel,
  deleteWorkflow,
  discardInboxTask,
  findAgentRow,
  findExecutionProfileRow,
  findLoadoutRow,
  findProjectRow,
  findWorkflowRow,
  getProject,
  getProposedTask,
  getRun,
  getTaskDetail,
  getTaskGraph,
  getWorkflow,
  getWorkflowVersionDetail,
  latestDashboardEventSequence,
  listAgents,
  listApprovalGates,
  listDashboardEventsSince,
  listExecutionProfiles,
  listHarnesses,
  listInboxTasks,
  listKnowledgeCandidates,
  listLoadouts,
  listModels,
  listProjectActivity,
  listProjects,
  listProposedTasks,
  listRunApprovalGates,
  listRunEventsSince,
  listRuns,
  listRunSteps,
  listTaskReopenings,
  listTasks,
  listWorkflows,
  listWorkflowVersions,
  promoteInboxTask,
  readUserSettings,
  rejectProposedTask,
  removeTaskDependency,
  replaceTaskDependencies,
  requestRunCancellation,
  resolveApprovalGate,
  setHarnessEnabled,
  setProjectArchived,
  toAgent,
  toExecutionProfile,
  toLoadout,
  updateAgent,
  updateExecutionProfile,
  updateLoadout,
  updateModel,
  updateProject,
  updateTask,
  updateWorkflow,
  writeUserSetting,
} from "@dungeon-master/database";
import { DashboardEventPoller, PgNotifyListener, SseTransport } from "@dungeon-master/events";

import type { Logger } from "./logger.js";
import type {
  AchievementsPort,
  DockerPreflightPort,
  DashboardEventsPort,
  ExecutionPort,
  RunStreamHandle,
  SettingsPort,
  WorkPort,
} from "./ports.js";
import type { AchievementCatalog } from "./routes/achievements.js";

/**
 * Monta as dependências concretas de `createApp` a partir de uma conexão.
 *
 * Fica separado de `server.ts` para que os testes de integração montem
 * exatamente a mesma fiação sobre o `embedded-postgres`, em vez de uma versão
 * paralela que pode divergir sem ninguém notar.
 */

export interface EventsRuntimeOptions {
  db: Database;
  /**
   * Pool do `pg`, para a conexão dedicada do `LISTEN`.
   *
   * O tipo vem do handle de `@dungeon-master/database` para a API não precisar
   * de `pg` nem de `@types/pg` só por causa desta assinatura.
   */
  pool: DatabaseHandle["pool"];
  userId: string;
  logger?: Logger;
  /** Tique de segurança do poller, para o caso de uma notificação se perder. */
  fallbackIntervalMs?: number;
  /** Intervalo do heartbeat do SSE. `0` desliga. */
  heartbeatIntervalMs?: number;
}

export interface EventsRuntime {
  port: DashboardEventsPort;
  /** Liga heartbeat, tique de segurança e `LISTEN`. */
  start: () => Promise<void>;
  /** Desliga tudo e fecha as conexões SSE abertas. */
  stop: () => Promise<void>;
}

/**
 * Transporte SSE, drain por cursor e ponte de NOTIFY, um conjunto por processo.
 *
 * A conexão do `LISTEN` é dedicada e não volta ao pool, então não pode haver um
 * `PgNotifyListener` por requisição — daí o conjunto nascer aqui, no boot, e
 * não dentro de um handler.
 */
export async function createEventsRuntime(options: EventsRuntimeOptions): Promise<EventsRuntime> {
  const { db, pool, userId, logger } = options;

  const transport = new SseTransport<DashboardEvent>({
    serialize: (event) => JSON.stringify(event),
    ...(options.heartbeatIntervalMs === undefined
      ? {}
      : { heartbeatIntervalMs: options.heartbeatIntervalMs }),
    ...(logger === undefined ? {} : { logger }),
  });

  const listSince = (afterSequence: number, limit: number): Promise<DashboardEvent[]> =>
    listDashboardEventsSince(db, { userId, afterSequence, limit });

  // O poller começa do que já existe: o histórico de quem conecta vem do
  // replay da própria rota, lido do banco, e não de uma reemissão do log
  // inteiro pelo transporte.
  const startCursor = await latestDashboardEventSequence(db, { userId });

  const poller = new DashboardEventPoller<DashboardEvent>({
    source: { listSince },
    transport,
    startCursor,
    ...(logger === undefined ? {} : { logger }),
  });

  const listener = new PgNotifyListener({
    notifier: createPgNotifier(pool),
    drainable: poller,
    channel: DASHBOARD_EVENT_CHANNEL,
    ...(logger === undefined ? {} : { logger }),
  });

  const port: DashboardEventsPort = {
    transport,
    listSince,
    append: (input) => appendDashboardEvent(db, { userId, ...input }),
  };

  return {
    port,
    start: async () => {
      transport.start();
      poller.start(options.fallbackIntervalMs);
      // Não é fatal: sem o `LISTEN` o stream continua funcionando pelo tique de
      // segurança, só com a latência do intervalo em vez de instantânea.
      await listener.start();
    },
    stop: async () => {
      listener.stop();
      poller.stop();
      await transport.stop();
    },
  };
}

export interface SettingsPortOptions {
  db: Database;
  userId: string;
}

export function createSettingsPort(options: SettingsPortOptions): SettingsPort {
  const { db, userId } = options;

  return {
    read: () => readUserSettings(db, { userId }),
    write: (key, value) => writeUserSetting(db, { userId, key, value }),
  };
}

/**
 * Lê e valida o catálogo de Conquistas, uma vez, no boot.
 *
 * O carregador é fail-closed e nunca lança: uma definição torta fica de fora e
 * aparece em `invalid`, com a chave e o erro. Conquistas são cosméticas
 * (planejamento v0.4, Fase 2.5), então uma entrada errada no arquivo não pode
 * derrubar a API — mas também não pode passar em silêncio, e é por isso que o
 * que foi recusado sai no log de boot e na resposta da rota.
 */
export function loadAchievementCatalog(options: { logger?: Logger } = {}): AchievementCatalog {
  const catalog = loadCatalog();
  const templates = loadTemplates();

  const invalid = [
    ...catalog.invalid.map((entry) => ({ ...entry, source: "catalog" as const })),
    ...templates.invalid.map((entry) => ({ ...entry, source: "templates" as const })),
  ].map((entry) => ({ ...entry, issues: [...entry.issues] }));

  if (invalid.length > 0) {
    options.logger?.warn(
      {
        invalid: invalid.map((entry) => ({
          source: entry.source,
          key: entry.key,
          error: entry.error,
        })),
      },
      "catálogo de Conquistas com entradas recusadas",
    );
  }

  return { definitions: [...catalog.valid], templates: [...templates.valid], invalid };
}

export interface AchievementsPortOptions {
  db: Database;
  userId: string;
}

/**
 * Liga o Hall dos Heróis à projeção.
 *
 * Só leitura: quem escreve progresso, desbloqueio e estatística é o projetor do
 * Worker. Uma rota que projetasse sob demanda faria a abertura de uma tela
 * gravar no banco, e duas abas abertas disputariam o mesmo cursor.
 *
 * `xpToNextLevel` entra do pacote puro, e não recalculada aqui: a curva de
 * nível é dado do catálogo, e uma segunda fórmula divergiria da primeira.
 */
export function createAchievementsPort(options: AchievementsPortOptions): AchievementsPort {
  const { db, userId } = options;

  return {
    list: (filters) => listAchievementViews(db, { userId, filters }),
    unlocks: (page) => listAchievementUnlockPage(db, { userId, ...page }),
    markSeen: (unlockId) => markAchievementUnlockSeen(db, { userId, unlockId }),
    heroStats: () => readHeroStats(db, { userId, xpToNextLevel }),
    listForged: (reviewStatus) => listForgedAchievements(db, { userId, reviewStatus }),
    approveForged: (definitionId, patch) =>
      approveForgedAchievement(db, { userId, definitionId, patch }),
    renameForged: (definitionId, patch) =>
      renameForgedAchievement(db, { userId, definitionId, patch }),
    discardForged: (definitionId) => discardForgedAchievement(db, { userId, definitionId }),
  };
}

// --------------------------------------------------------------------------
// Execução
// --------------------------------------------------------------------------

export interface RunEventsRuntimeOptions {
  db: Database;
  pool: DatabaseHandle["pool"];
  userId: string;
  logger?: Logger;
  /** Tique de segurança do poller, para o caso de uma notificação se perder. */
  fallbackIntervalMs?: number;
  /** Intervalo do heartbeat do SSE. `0` desliga. */
  heartbeatIntervalMs?: number;
}

export interface RunEventsRuntime {
  /** Abre (ou reaproveita) o stream daquele Run. Quem abre é obrigado a fechar. */
  openStream(runId: string): RunStreamHandle;
  /** Liga o `LISTEN` do canal de `run_event`. */
  start: () => Promise<void>;
  /** Desliga tudo e fecha os streams abertos. */
  stop: () => Promise<void>;
}

interface RunStreamEntry {
  readonly transport: SseTransport<RunEvent>;
  readonly poller: DashboardEventPoller<RunEvent>;
  refs: number;
}

/**
 * Os streams de eventos por Run.
 *
 * Um transporte e um poller **por Run olhado**, criados sob demanda e
 * desmontados quando a última aba fecha. O canal de `LISTEN` é um só: a
 * notificação de `run_event` não diz de qual Run veio — ela não carrega payload
 * de propósito —, então ela acorda o drain de todos os Runs abertos, e cada
 * poller descobre pelo próprio cursor se tem algo novo. Com uma ou duas
 * execuções abertas na tela, que é o caso real, isso custa uma consulta barata
 * por notificação e evita um canal por Run, que estouraria o limite de
 * identificadores do PostgreSQL e obrigaria a uma conexão dedicada por Run.
 *
 * A contagem de referências é o que impede um Run olhado uma vez de continuar
 * consultando o banco para sempre.
 */
export function createRunEventsRuntime(options: RunEventsRuntimeOptions): RunEventsRuntime {
  const { db, pool, userId, logger } = options;
  const streams = new Map<string, RunStreamEntry>();

  const drainAll = async (): Promise<void> => {
    await Promise.all([...streams.values()].map((entry) => entry.poller.drainNow()));
  };

  const listener = new PgNotifyListener({
    notifier: createPgNotifier(pool),
    drainable: { drainNow: drainAll },
    channel: RUN_EVENT_CHANNEL,
    ...(logger === undefined ? {} : { logger }),
  });

  const openStream = (runId: string): RunStreamHandle => {
    let entry = streams.get(runId);

    if (entry === undefined) {
      const transport = new SseTransport<RunEvent>({
        serialize: (event) => JSON.stringify(event),
        ...(options.heartbeatIntervalMs === undefined
          ? {}
          : { heartbeatIntervalMs: options.heartbeatIntervalMs }),
        ...(logger === undefined ? {} : { logger }),
      });

      const poller = new DashboardEventPoller<RunEvent>({
        source: {
          listSince: (afterSequence, limit) =>
            listRunEventsSince(db, { userId, runId, afterSequence, limit }),
        },
        transport,
        // Do zero: quem acabou de abrir o stream pode estar pedindo o log
        // inteiro, e a assinatura descarta pelo cursor o que ela já tem.
        startCursor: 0,
        ...(logger === undefined ? {} : { logger }),
      });

      transport.start();
      poller.start(options.fallbackIntervalMs);

      entry = { transport, poller, refs: 0 };
      streams.set(runId, entry);
    }

    entry.refs += 1;
    const atual = entry;

    let fechado = false;

    return {
      transport: atual.transport,
      listSince: (afterSequence, limit) =>
        listRunEventsSince(db, { userId, runId, afterSequence, limit }),
      close: () => {
        if (fechado) return;
        fechado = true;
        atual.refs -= 1;
        if (atual.refs > 0) return;

        streams.delete(runId);
        atual.poller.stop();
        // Fire-and-forget: fechar o transporte é só limpar temporizadores e
        // sockets já mortos, e o handler que chamou `close` está terminando.
        void atual.transport.stop();
      },
    };
  };

  return {
    openStream,
    start: async () => {
      // Não é fatal: sem o `LISTEN` o stream continua funcionando pelo tique de
      // segurança do poller, com a latência do intervalo em vez de instantânea.
      await listener.start();
    },
    stop: async () => {
      listener.stop();
      const abertos = [...streams.values()];
      streams.clear();
      for (const entry of abertos) entry.poller.stop();
      await Promise.all(abertos.map((entry) => entry.transport.stop()));
    },
  };
}

export interface ExecutionPortOptions {
  /**
   * O preflight do Docker. Opcional porque os testes com banco embutido não
   * têm Docker: sem ele, a rota responde que o preflight não está disponível.
   */
  readonly dockerPreflight?: DockerPreflightPort;
  db: Database;
  userId: string;
  runEvents: RunEventsRuntime;
}

/**
 * Liga as rotas de execução ao repositório.
 *
 * Como em `createWorkPort`, o `userId` é fechado aqui e nenhum handler escolhe
 * de quem são os dados.
 */
export function createExecutionPort(options: ExecutionPortOptions): ExecutionPort {
  const { db, userId, runEvents } = options;

  return {
    dockerPreflight: options.dockerPreflight ?? {
      check: () =>
        Promise.reject(new Error("O preflight do Docker não está disponível nesta instância.")),
    },
    harnesses: {
      list: () => listHarnesses(db, { userId }),
      setEnabled: (harnessId, enabled) => setHarnessEnabled(db, { userId, harnessId, enabled }),
    },
    models: {
      list: (harnessId) => listModels(db, { userId, harnessId }),
      create: (input) => createModel(db, { userId, ...input }),
      update: (modelId, patch) => updateModel(db, { userId, modelId, patch }),
      remove: (modelId) => deleteModel(db, { userId, modelId }),
    },
    agents: {
      list: () => listAgents(db, { userId }),
      get: async (agentId) => {
        const row = await findAgentRow(db, { userId, agentId });
        return row === null ? null : toAgent(row);
      },
      create: (input) => createAgent(db, { userId, ...input }),
      update: (agentId, patch) => updateAgent(db, { userId, agentId, patch }),
      remove: (agentId) => deleteAgent(db, { userId, agentId }),
    },
    executionProfiles: {
      list: () => listExecutionProfiles(db, { userId }),
      get: async (executionProfileId) => {
        const row = await findExecutionProfileRow(db, { userId, executionProfileId });
        return row === null ? null : toExecutionProfile(row);
      },
      create: (input) => createExecutionProfile(db, { userId, ...input }),
      update: (executionProfileId, patch) =>
        updateExecutionProfile(db, { userId, executionProfileId, patch }),
      remove: (executionProfileId) => deleteExecutionProfile(db, { userId, executionProfileId }),
    },
    loadouts: {
      list: () => listLoadouts(db, { userId }),
      get: async (loadoutId) => {
        const row = await findLoadoutRow(db, { userId, loadoutId });
        return row === null ? null : toLoadout(row);
      },
      create: (input) => createLoadout(db, { userId, ...input }),
      update: (loadoutId, patch) => updateLoadout(db, { userId, loadoutId, patch }),
      remove: (loadoutId) => deleteLoadout(db, { userId, loadoutId }),
    },
    runs: {
      list: (input) =>
        listRuns(db, {
          userId,
          page: input.page,
          pageSize: input.pageSize,
          filters: input.filters,
        }),
      get: (runId) => getRun(db, { userId, runId }),
      create: (taskId, input) => createRun(db, { userId, taskId, ...input }),
      cancel: (runId) => requestRunCancellation(db, { userId, runId }),
      events: (runId, input) =>
        listRunEventsSince(db, {
          userId,
          runId,
          afterSequence: input.afterSequence,
          limit: input.limit,
        }),
      openStream: (runId) => runEvents.openStream(runId),
      steps: (runId) => listRunSteps(db, { userId, runId }),
      gates: (runId) => listRunApprovalGates(db, { userId, runId }),
    },
    workflows: {
      list: (page) => listWorkflows(db, { userId, ...page }),
      create: (definition) => createWorkflow(db, { userId, definition }),
      get: (workflowId) => getWorkflow(db, { userId, workflowId }),
      update: (workflowId, definition) => updateWorkflow(db, { userId, workflowId, definition }),
      remove: (workflowId) => deleteWorkflow(db, { userId, workflowId }),
      versions: async (workflowId, page) => {
        // A existência é checada antes de listar: as versões de um Workflow
        // inexistente são 404, não uma página vazia.
        const workflow = await findWorkflowRow(db, { userId, workflowId });
        if (workflow === null) return null;
        return await listWorkflowVersions(db, { userId, workflowId, ...page });
      },
      version: (workflowVersionId) => getWorkflowVersionDetail(db, { userId, workflowVersionId }),
    },
    approvalGates: {
      list: (input) =>
        listApprovalGates(db, {
          userId,
          page: input.page,
          pageSize: input.pageSize,
          filters: input.filters,
        }),
      resolve: (gateId, input) => resolveApprovalGate(db, { userId, gateId, ...input }),
    },
  };
}

export interface WorkPortOptions {
  db: Database;
  userId: string;
}

/**
 * Liga as rotas de Project, Task e Inbox ao repositório.
 *
 * O `userId` é fechado aqui, uma vez: nenhum handler recebe ou escolhe de quem
 * são os dados, então não existe rota que possa esquecer o escopo. Enquanto o
 * sistema é single-user isso é redundante; no dia em que deixar de ser, o lugar
 * a mudar é este e só este.
 */
export function createWorkPort(options: WorkPortOptions): WorkPort {
  const { db, userId } = options;

  return {
    projects: {
      list: (input) =>
        listProjects(db, {
          userId,
          page: input.page,
          pageSize: input.pageSize,
          status: input.status,
        }),
      create: (input) => createProject(db, { userId, ...input }),
      get: (projectId) => getProject(db, { userId, projectId }),
      update: (projectId, patch) => updateProject(db, { userId, projectId, patch }),
      setArchived: (projectId, archived) => setProjectArchived(db, { userId, projectId, archived }),
      activity: async (projectId, page) => {
        // A existência é checada antes de listar: sem isso, o diário de um
        // Project inexistente seria uma página vazia em vez de 404.
        const project = await findProjectRow(db, { userId, projectId });
        if (project === null) return null;

        return await listProjectActivity(db, { userId, projectId, ...page });
      },
      taskGraph: (projectId) => getTaskGraph(db, { userId, projectId }),
    },
    tasks: {
      list: (input) =>
        listTasks(db, {
          userId,
          page: input.page,
          pageSize: input.pageSize,
          filters: input.filters,
          sort: input.sort,
          order: input.order,
        }),
      create: (input) => createTask(db, { userId, ...input }),
      get: (taskId) => getTaskDetail(db, { userId, taskId }),
      update: (taskId, patch) => updateTask(db, { userId, taskId, patch }),
      changeStatus: (taskId, to) => changeTaskStatus(db, { userId, taskId, to }),
      addDependency: (taskId, dependsOnTaskId) =>
        addTaskDependency(db, { userId, taskId, dependsOnTaskId }),
      removeDependency: (taskId, dependsOnTaskId) =>
        removeTaskDependency(db, { userId, taskId, dependsOnTaskId }),
      replaceDependencies: (taskId, dependsOn) =>
        replaceTaskDependencies(db, { userId, taskId, dependsOn }),
      reopenings: (filters) => listTaskReopenings(db, { userId, kind: filters.kind }),
    },
    inbox: {
      capture: (text) => captureInboxTask(db, { userId, text }),
      list: (page) => listInboxTasks(db, { userId, ...page }),
      promote: (taskId, input) => promoteInboxTask(db, { userId, taskId, ...input }),
      discard: (taskId) => discardInboxTask(db, { userId, taskId }),
    },
    proposedTasks: {
      list: (input) =>
        listProposedTasks(db, {
          userId,
          page: input.page,
          pageSize: input.pageSize,
          filters: input.filters,
        }),
      get: (proposedTaskId) => getProposedTask(db, { userId, proposedTaskId }),
      approve: (proposedTaskId, input) =>
        approveProposedTask(db, { userId, proposedTaskId, ...input }),
      reject: (proposedTaskId, input) =>
        rejectProposedTask(db, { userId, proposedTaskId, ...input }),
    },
    knowledgeCandidates: {
      list: (input) =>
        listKnowledgeCandidates(db, {
          userId,
          page: input.page,
          pageSize: input.pageSize,
          filters: input.filters,
        }),
    },
    knowledge: {
      listItems: async (projectId, input) => {
        // A existência é checada antes de listar: o Grimório de um Project
        // inexistente é 404, não uma página vazia.
        const project = await findProjectRow(db, { userId, projectId });
        if (project === null) return null;
        return await listKnowledgeItems(db, {
          userId,
          page: input.page,
          pageSize: input.pageSize,
          filters: { ...input.filters, projectId },
        });
      },
      getItem: (knowledgeItemId) => getKnowledgeItem(db, { userId, knowledgeItemId }),
      updateItem: (knowledgeItemId, patch) =>
        updateKnowledgeItem(db, { userId, knowledgeItemId, patch }),
      approveItem: (knowledgeItemId, input) =>
        approveKnowledgeItem(db, { userId, knowledgeItemId, ...input }),
      rejectItem: (knowledgeItemId, input) =>
        rejectKnowledgeItem(db, { userId, knowledgeItemId, ...input }),
      summary: (projectId) => getProjectSummary(db, { userId, projectId }),
      decisions: (projectId, input) =>
        listProjectDecisions(db, {
          userId,
          projectId,
          page: input.page,
          pageSize: input.pageSize,
          status: input.status,
        }),
      distill: async (projectId) => {
        const project = await findProjectRow(db, { userId, projectId });
        if (project === null) return null;
        return await requestDistillation(db, { userId, projectId });
      },
      distillationRuns: (input) =>
        listDistillationRuns(db, {
          userId,
          page: input.page,
          pageSize: input.pageSize,
          filters: input.filters,
        }),
    },
  };
}
