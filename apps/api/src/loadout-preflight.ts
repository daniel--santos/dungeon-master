import type {
  CliPreflight,
  ExecutionMode,
  LoadoutPreflight,
  PreflightProblem,
  ProviderAuth,
  ProviderAuthStatus,
} from "@dungeon-master/contracts";
import {
  buildLoadoutSnapshot,
  type Database,
  findAgentRow,
  findExecutionProfileRow,
  findHarnessRow,
  findLoadoutRow,
  findModelRow,
  findProviderForHarness,
  findProviderRow,
  isKnowledgeScribeLoadout,
  type ProviderRow,
  type Result,
  type RunWriteFailure,
  toHarness,
} from "@dungeon-master/database";
import { matchCapabilities } from "@dungeon-master/domain";
import type { HarnessAdapter, PreflightResult } from "@dungeon-master/runtime";

import type { DockerPreflightPort, LoadoutPreflightPort } from "./ports.js";

/**
 * O preflight de um Loadout (planejamento v0.4, Fase 8A): tudo o que dá para
 * saber antes de partir, sem chamar modelo nenhum.
 *
 * Três fontes, juntas numa resposta:
 *
 * 1. **Capability matching**: o snapshot resolvido do Loadout contra a matriz
 *    do Harness, pela função pura do domínio. É o mesmo relatório que
 *    `POST /runs` usa para recusar com `409`.
 * 2. **A CLI, no modo do perfil**: no host, o `preflight` do adapter — o
 *    `--version` e, quando ele sabe, a checagem de credencial —; em `DOCKER`,
 *    o preflight do backend que já existe (daemon, imagem, CLI no container).
 *    Medido na chamada, com teto curto, como o de Docker: um resultado guardado
 *    diria "instalado" sobre uma CLI que foi desinstalada ontem.
 * 3. **O Provider**: o do Model efetivo ou, na falta, o primeiro que declara o
 *    Harness; o estado da credencial é a variável nomeada existindo no ambiente
 *    da API, ou o que a CLI respondeu. Só nomes; o valor nunca sai daqui.
 */

/** Teto por adapter. O mesmo do preflight de Docker. */
export const LOADOUT_PREFLIGHT_TIMEOUT_MS = 15_000;

export interface LoadoutPreflightOptions {
  readonly db: Database;
  readonly userId: string;
  /** Todos os adapters registrados; o par `(key, modo)` escolhe um. */
  readonly adapters: readonly HarnessAdapter[];
  /** O preflight do Docker, para perfis `DOCKER`. Sem ele, `docker` e `cli` saem nulos. */
  readonly dockerPreflight?: DockerPreflightPort;
  /** Ambiente de onde as variáveis do Provider são lidas. Padrão: o do processo. */
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

function processEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function fromResult(input: {
  adapter: HarnessAdapter;
  mode: ExecutionMode;
  result: PreflightResult;
}): CliPreflight {
  return {
    mode: input.mode,
    adapterId: input.adapter.id,
    installed: input.result.installed,
    version: input.result.version ?? null,
    authenticated: input.result.authenticated ?? null,
    timedOut: false,
    problems: input.result.problems.map((problem) => ({
      code: problem.code,
      message: problem.message,
      fatal: problem.fatal,
    })),
  };
}

/** Corre o preflight de host de um adapter contra o relógio, como o de Docker. */
async function checkHostAdapter(
  adapter: HarnessAdapter,
  input: { readonly env: Readonly<Record<string, string>>; readonly timeoutMs: number },
): Promise<CliPreflight> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      resolve("timeout");
    }, input.timeoutMs);
  });
  const naoVerificado: CliPreflight = {
    mode: "HOST",
    adapterId: adapter.id,
    installed: false,
    version: null,
    authenticated: null,
    timedOut: false,
    problems: [],
  };

  try {
    const outcome = await Promise.race([
      adapter.preflight({ mode: "HOST", env: input.env, timeoutMs: input.timeoutMs }),
      deadline,
    ]);
    if (outcome === "timeout") return { ...naoVerificado, timedOut: true };
    return fromResult({ adapter, mode: "HOST", result: outcome });
  } catch (error) {
    // Um adapter cujo preflight estoura é defeito nosso, não um harness
    // ausente; a linha continua, com a mensagem, como no Worker.
    const problem: PreflightProblem = {
      code: "UNSUPPORTED_MODE",
      message: error instanceof Error ? error.message : String(error),
      fatal: true,
    };
    return { ...naoVerificado, problems: [problem] };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function providerAuth(input: {
  provider: ProviderRow;
  env: Readonly<Record<string, string>>;
  cli: CliPreflight | null;
}): ProviderAuth {
  const { provider, env, cli } = input;
  const presentEnvKeys = provider.authEnvKeys.filter((key) => {
    const value = env[key];
    return value !== undefined && value.trim() !== "";
  });

  let status: ProviderAuthStatus;
  if (provider.kind === "LOCAL") status = "NOT_REQUIRED";
  else if (presentEnvKeys.length > 0) status = "ENV_KEY_PRESENT";
  else if (cli?.authenticated === true) status = "CLI_AUTHENTICATED";
  else if (cli?.authenticated === false) status = "CLI_NOT_AUTHENTICATED";
  else status = "UNKNOWN";

  return {
    providerId: provider.id,
    name: provider.name,
    kind: provider.kind,
    authEnvKeys: [...provider.authEnvKeys],
    presentEnvKeys,
    status,
    docsUrl: provider.docsUrl,
  };
}

export function createLoadoutPreflight(options: LoadoutPreflightOptions): LoadoutPreflightPort {
  const { db, userId } = options;
  const timeoutMs = options.timeoutMs ?? LOADOUT_PREFLIGHT_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());

  return {
    async check(input): Promise<Result<LoadoutPreflight, RunWriteFailure> | null> {
      const startedAt = now();
      const startedMs = Date.now();
      const env = options.env ?? processEnv();

      const loadout = await findLoadoutRow(db, { userId, loadoutId: input.loadoutId });
      if (loadout === null) return null;

      const agent = await findAgentRow(db, { userId, agentId: loadout.agentId });
      if (agent === null) {
        return {
          ok: false,
          failure: { code: "LOADOUT_BROKEN", loadoutId: loadout.id, missing: "agent" },
        };
      }
      const harness = await findHarnessRow(db, { userId, harnessId: loadout.harnessId });
      if (harness === null) {
        return {
          ok: false,
          failure: { code: "LOADOUT_BROKEN", loadoutId: loadout.id, missing: "harness" },
        };
      }

      const executionProfileId = input.executionProfileId ?? loadout.executionProfileId;
      const profile = await findExecutionProfileRow(db, { userId, executionProfileId });
      if (profile === null) {
        return { ok: false, failure: { code: "EXECUTION_PROFILE_NOT_FOUND", executionProfileId } };
      }

      const snapshot = await buildLoadoutSnapshot(db, { loadout, agent, harness });

      const capabilities = matchCapabilities({
        snapshot,
        harnessCapabilities: harness.capabilities,
        executionProfile: { mode: profile.mode },
        intent: {
          resume: input.resume,
          requiresStructuredOutput: await isKnowledgeScribeLoadout(db, { userId, loadout }),
        },
      });

      // ------------------------------------------------------------ a CLI
      let cli: CliPreflight | null = null;
      let docker: LoadoutPreflight["docker"] = null;

      if (profile.mode === "HOST") {
        const adapter = options.adapters.find(
          (candidate) =>
            candidate.key === harness.key && (candidate.executionMode ?? "HOST") === "HOST",
        );
        if (adapter !== undefined) cli = await checkHostAdapter(adapter, { env, timeoutMs });
      } else if (options.dockerPreflight !== undefined) {
        const medido = await options.dockerPreflight.check();
        docker = {
          daemonReachable: medido.daemon.reachable,
          serverVersion: medido.daemon.serverVersion,
          imageName: medido.image.name,
          imagePresent: medido.image.present,
          problems: medido.problems,
        };
        const linha = medido.harnesses.find((entry) => entry.harnessKey === harness.key);
        if (linha !== undefined) {
          cli = {
            mode: "DOCKER",
            adapterId: linha.adapterId,
            installed: linha.installed,
            version: linha.version,
            authenticated: linha.authenticated,
            timedOut: linha.timedOut,
            problems: linha.problems,
          };
        }
      }

      // ------------------------------------------------------- o Provider
      let providerRow: ProviderRow | null = null;
      if (snapshot.model !== null) {
        const model = await findModelRow(db, { userId, modelId: snapshot.model.id });
        if (model?.providerId != null) {
          providerRow = await findProviderRow(db, { userId, providerId: model.providerId });
        }
      }
      if (providerRow === null) {
        providerRow = await findProviderForHarness(db, { userId, harnessKey: harness.key });
      }
      const provider =
        providerRow === null ? null : providerAuth({ provider: providerRow, env, cli });

      const cliOk =
        cli === null || (!cli.timedOut && !cli.problems.some((problem) => problem.fatal));
      const ready =
        capabilities.blockers.length === 0 && harness.enabled && profile.enabled && cliOk;

      const harnessView = toHarness(harness);

      return {
        ok: true,
        value: {
          loadoutId: loadout.id,
          loadoutVersion: loadout.version,
          checkedAt: startedAt.toISOString(),
          durationMs: Date.now() - startedMs,
          harness: {
            id: harnessView.id,
            key: harnessView.key,
            name: harnessView.name,
            enabled: harnessView.enabled,
            capabilities: harnessView.capabilities,
            installedVersion: harnessView.installedVersion,
            checkedAt: harnessView.checkedAt,
          },
          executionProfile: {
            id: profile.id,
            name: profile.name,
            mode: profile.mode,
            enforcement: profile.enforcement,
            enabled: profile.enabled,
          },
          model: snapshot.model,
          provider,
          cli,
          docker,
          capabilities,
          ready,
        },
      };
    },
  };
}
