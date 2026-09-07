/**
 * A base dos adapters de CLI no host.
 *
 * Junta o que `createHostAdapter` (de `@dungeon-master/runtime`) já resolve —
 * spawn sem shell, stream, cauda limitada, kill por `executionId` — com o que é
 * específico de uma CLI instalada na máquina: achar o executável, descobrir a
 * versão e decidir se dá para executar sem shell.
 *
 * O preflight é cacheado por um tempo curto. Rodar `--version` em cada Run
 * custaria algumas centenas de milissegundos por execução, e o PATH não muda no
 * meio de um Run; um resultado **reprovado** nunca é cacheado, para que instalar
 * a CLI passe a valer no Run seguinte, sem reiniciar o worker.
 */

import { buildExecutionEnv, collectProcess } from "@dungeon-master/runtime";
import type {
  HarnessAdapter,
  HarnessContext,
  HarnessExecutionRequest,
  HarnessSignal,
  HostCommand,
  PreflightProblem,
  PreflightResult,
} from "@dungeon-master/runtime";
import { createHostAdapter } from "@dungeon-master/runtime";
import type { HarnessCapabilities } from "@dungeon-master/runtime";
import type { HarnessKey } from "@dungeon-master/contracts";

import { CliResolutionError, resolveCli, type ResolvedCli } from "./resolve-cli.js";

/** Quanto tempo um preflight aprovado vale. */
const PREFLIGHT_TTL_MS = 300_000;

/** Teto padrão do `--version`. Uma CLI que demora mais está com problema. */
const VERSION_TIMEOUT_MS = 20_000;

export interface CliArgs {
  readonly args: readonly string[];
  readonly stdin?: string;
}

export interface CliHarnessDefinition {
  readonly id: string;
  readonly key: HarnessKey;
  readonly capabilities: HarnessCapabilities;
  readonly environmentKeys: readonly string[];
  /** Nome do executável procurado no PATH. */
  readonly binary: string;
  /** Como perguntar a versão. */
  readonly versionArgs: readonly string[];
  /** Extrai a versão da saída. Devolver `undefined` vira problema não fatal. */
  parseVersion(stdout: string, stderr: string): string | undefined;
  /** Monta os argumentos da CLI, sem o executável. */
  buildArgs(request: HarnessExecutionRequest): CliArgs;
  parseLine(line: string): readonly HarnessSignal[];
  describeExit?(
    exitCode: number | null,
    stderrTail: string,
  ): { readonly message: string; readonly retryable: boolean } | undefined;
  /** Frase mostrada quando a CLI não está instalada. */
  readonly installHint: string;
  /**
   * Checagem barata de autenticação. Só implemente quando existir um comando
   * local que responda sem chamar a API; um `undefined` honesto vale mais que
   * um `false` que trava execuções que funcionariam.
   */
  detectAuthentication?(env: Record<string, string>): Promise<boolean | undefined>;
}

export function createCliHarnessAdapter(definition: CliHarnessDefinition): HarnessAdapter {
  let cached: { result: PreflightResult; resolved: ResolvedCli; at: number } | undefined;

  const envFor = (context: HarnessContext): Record<string, string> =>
    context.env === undefined
      ? buildExecutionEnv({ adapterKeys: definition.environmentKeys })
      : { ...context.env };

  const preflight = async (context: HarnessContext): Promise<PreflightResult> => {
    if (cached !== undefined && Date.now() - cached.at < PREFLIGHT_TTL_MS) {
      return cached.result;
    }

    const env = envFor(context);

    let resolved: ResolvedCli | undefined;
    try {
      resolved = await resolveCli(definition.binary, { env });
    } catch (error) {
      if (error instanceof CliResolutionError) {
        return {
          installed: false,
          executablePath: error.resolvedPath,
          problems: [{ code: "NOT_INSTALLED", message: error.message, fatal: true }],
        };
      }
      throw error;
    }

    if (resolved === undefined) {
      return {
        installed: false,
        problems: [
          {
            code: "NOT_INSTALLED",
            message: `${definition.binary} não foi encontrado no PATH. ${definition.installHint}`,
            fatal: true,
          },
        ],
      };
    }

    const probe = await collectProcess(
      resolved.command,
      [...resolved.argsPrefix, ...definition.versionArgs],
      {
        cwd: context.cwd ?? process.cwd(),
        env,
        timeoutMs: context.timeoutMs ?? VERSION_TIMEOUT_MS,
      },
    );

    const version = definition.parseVersion(probe.stdout, probe.stderr);
    const problems: PreflightProblem[] = [];
    if (version === undefined) {
      problems.push({
        code: "VERSION_UNREADABLE",
        message:
          `Não consegui ler a versão de ${resolved.resolvedPath} ` +
          `(código ${String(probe.code)}). Resultados deixam de ser comparáveis por versão.`,
        // Não é fatal: a CLI está lá e vai rodar. O que se perde é a
        // reprodutibilidade por versão (documento técnico, seção 33).
        fatal: false,
      });
    }

    const authenticated = await definition.detectAuthentication?.(env);
    if (authenticated === false) {
      problems.push({
        code: "NOT_AUTHENTICATED",
        message: `${definition.binary} parece não estar autenticado. A execução vai falhar na primeira chamada.`,
        fatal: false,
      });
    }

    const result: PreflightResult = {
      installed: true,
      ...(version === undefined ? {} : { version }),
      executablePath: resolved.resolvedPath,
      ...(authenticated === undefined ? {} : { authenticated }),
      problems,
    };

    if (problems.length === 0) cached = { result, resolved, at: Date.now() };
    return result;
  };

  return createHostAdapter({
    id: definition.id,
    key: definition.key,
    capabilities: definition.capabilities,
    environmentKeys: definition.environmentKeys,
    preflight,
    parseLine: definition.parseLine,
    ...(definition.describeExit === undefined ? {} : { describeExit: definition.describeExit }),

    buildCommand: async (request): Promise<HostCommand> => {
      const resolved = await resolveCli(definition.binary, { env: request.env });
      if (resolved === undefined) {
        throw new Error(
          `${definition.binary} não foi encontrado no PATH no momento de executar. ${definition.installHint}`,
        );
      }
      const { args, stdin } = definition.buildArgs(request);
      return {
        command: resolved.command,
        args: [...resolved.argsPrefix, ...args],
        ...(stdin === undefined ? {} : { stdin }),
      };
    },
  });
}

/** Primeira sequência que parece uma versão semântica na saída de `--version`. */
export function parseSemverish(...outputs: string[]): string | undefined {
  for (const output of outputs) {
    const match = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/.exec(output);
    if (match !== null) return match[0];
  }
  return undefined;
}
