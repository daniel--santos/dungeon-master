import type {
  DockerHarnessPreflight,
  DockerPreflight,
  PreflightProblem,
} from "@dungeon-master/contracts";
import {
  createDockerCli,
  DEFAULT_AGENT_IMAGE,
  dockerPreflight,
  type DockerCli,
  type HarnessAdapter,
  type PreflightResult,
} from "@dungeon-master/runtime";

import type { DockerPreflightPort } from "./ports.js";

/**
 * O preflight do backend Docker, medido na chamada (pendência da Fase 2.5D).
 *
 * Usa as mesmas peças do Worker — `dockerPreflight` para daemon e imagem, e o
 * `preflight` de cada adapter de container para versão e credencial —, para
 * a tela dizer exatamente o que o Run diria. O que muda é o teto: aqui tudo
 * corre dentro de uma requisição HTTP, então todo comando do cliente Docker e
 * toda checagem por harness recebem o mesmo limite curto, e um harness que
 * não responde sai marcado como `timedOut` em vez de segurar a resposta.
 *
 * Nunca roda sozinho: não há chamada no boot da API. Quem quer saber, pede.
 */

/** Teto por comando do cliente Docker e por harness. */
export const DOCKER_PREFLIGHT_TIMEOUT_MS = 15_000;

export interface DockerPreflightPortOptions {
  /** Todos os adapters registrados; só os de `executionMode: "DOCKER"` contam. */
  readonly adapters: readonly HarnessAdapter[];
  /** Imagem de referência. Padrão: {@link DEFAULT_AGENT_IMAGE}. */
  readonly image?: string;
  /** Cliente Docker. Injetável para teste com um Docker falso. */
  readonly docker?: DockerCli;
  /** Teto por comando e por harness. Padrão: {@link DOCKER_PREFLIGHT_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Ambiente de onde a credencial é lida. Padrão: o do processo da API. */
  readonly env?: Readonly<Record<string, string>>;
  /** UID do processo, comparado com o da imagem. Padrão: `process.getuid()`, ausente no Windows. */
  readonly hostUid?: number;
  /** Relógio. Injetável para o teste fixar `checkedAt`. */
  readonly now?: () => Date;
}

function processEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function notChecked(adapter: HarnessAdapter): DockerHarnessPreflight {
  return {
    harnessKey: adapter.key,
    adapterId: adapter.id,
    installed: false,
    version: null,
    authenticated: null,
    timedOut: false,
    problems: [],
  };
}

function fromResult(adapter: HarnessAdapter, result: PreflightResult): DockerHarnessPreflight {
  return {
    harnessKey: adapter.key,
    adapterId: adapter.id,
    installed: result.installed,
    version: result.version ?? null,
    authenticated: result.authenticated ?? null,
    timedOut: false,
    problems: result.problems.map((problem) => ({
      code: problem.code,
      message: problem.message,
      fatal: problem.fatal,
    })),
  };
}

/** Corre o preflight de um adapter contra o relógio. */
async function checkAdapter(
  adapter: HarnessAdapter,
  input: { readonly env: Readonly<Record<string, string>>; readonly timeoutMs: number },
): Promise<DockerHarnessPreflight> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      resolve("timeout");
    }, input.timeoutMs);
  });

  try {
    const outcome = await Promise.race([
      adapter.preflight({ mode: "DOCKER", env: input.env, timeoutMs: input.timeoutMs }),
      deadline,
    ]);
    if (outcome === "timeout") return { ...notChecked(adapter), timedOut: true };
    return fromResult(adapter, outcome);
  } catch (error) {
    // Um adapter cujo preflight estoura é defeito nosso, não um harness
    // ausente; a linha continua na lista, com a mensagem, como no Worker.
    const problem: PreflightProblem = {
      code: "UNSUPPORTED_MODE",
      message: error instanceof Error ? error.message : String(error),
      fatal: true,
    };
    return { ...notChecked(adapter), problems: [problem] };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createDockerPreflightPort(
  options: DockerPreflightPortOptions,
): DockerPreflightPort {
  const timeoutMs = options.timeoutMs ?? DOCKER_PREFLIGHT_TIMEOUT_MS;
  const image = options.image ?? DEFAULT_AGENT_IMAGE;
  const base = options.docker ?? createDockerCli();
  // O teto vale para todo comando do cliente, inclusive o `docker version`
  // que `dockerPreflight` roda com o padrão de 30 s do cliente.
  const docker: DockerCli = (args, commandOptions) =>
    base(args, {
      ...commandOptions,
      timeoutMs: Math.min(commandOptions?.timeoutMs ?? timeoutMs, timeoutMs),
    });
  const adapters = options.adapters.filter((adapter) => adapter.executionMode === "DOCKER");
  const now = options.now ?? (() => new Date());
  const hostUid = options.hostUid ?? process.getuid?.();

  return {
    async check(): Promise<DockerPreflight> {
      const startedAt = now();
      const startedMs = Date.now();
      const env = options.env ?? processEnv();

      const ambiente = await dockerPreflight({
        docker,
        image,
        ...(hostUid === undefined ? {} : { expectedUid: hostUid }),
      });

      const ready = ambiente.daemonReachable && ambiente.imagePresent;
      const harnesses = ready
        ? await Promise.all(adapters.map((adapter) => checkAdapter(adapter, { env, timeoutMs })))
        : adapters.map(notChecked);

      return {
        checkedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedMs,
        timeoutMs,
        daemon: {
          reachable: ambiente.daemonReachable,
          serverVersion: ambiente.serverVersion ?? null,
        },
        image: {
          name: image,
          present: ambiente.imagePresent,
          user: ambiente.imageUser ?? null,
        },
        problems: ambiente.problems.map((problem) => ({
          code: problem.code,
          message: problem.message,
          fatal: problem.fatal,
        })),
        harnesses,
      };
    },
  };
}
