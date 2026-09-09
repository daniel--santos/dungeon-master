import type {
  HarnessCapabilities as ContractCapabilities,
  HarnessKey,
} from "@dungeon-master/contracts";
import {
  findHarnessRowByKey,
  recordHarnessPreflight,
  type Database,
} from "@dungeon-master/database";
import type { HarnessAdapter, HarnessCapabilities, PreflightResult } from "@dungeon-master/runtime";

import type { Logger } from "./logger.js";

/**
 * O preflight de partida: quais CLIs existem nesta máquina, em qual versão.
 *
 * Roda uma vez, no boot, e não a cada Run: descobrir versão custa um processo
 * por harness, e a resposta não muda entre dois Runs do mesmo minuto. O
 * `AgentRuntime` faz o preflight dele antes de cada execução — aquele é a
 * garantia de correção, este é o que preenche a tela de Guildas com
 * `installedVersion` e `checkedAt`, que ficaram pendentes na Fase 2A.
 *
 * **Nenhum problema aqui derruba o Worker.** Uma CLI ausente é estado normal:
 * quem só usa o Claude Code não tem o Codex instalado, e o Run que pedisse o
 * Codex falharia com uma mensagem de instalação, não com um Worker que se
 * recusa a subir.
 */

/**
 * A matriz do runtime e a do contrato têm os mesmos treze campos desde a Fase
 * 8A: `forkSession` e `mcpServers` entraram no contrato, e o que era um
 * descarte virou identidade. A função fica como o ponto único de conversão.
 */
function toContractCapabilities(capabilities: HarnessCapabilities): ContractCapabilities {
  return capabilities;
}

export interface PreflightOutcome {
  readonly harnessKey: HarnessKey;
  readonly adapterId: string;
  readonly installed: boolean;
  readonly version: string | null;
  readonly executablePath: string | undefined;
  readonly problems: PreflightResult["problems"];
  /** `false` quando o Harness não está no cadastro (banco sem `db:seed`). */
  readonly recorded: boolean;
}

export interface RunBootPreflightInput {
  readonly db: Database;
  readonly userId: string;
  readonly adapters: readonly HarnessAdapter[];
  readonly logger?: Logger;
  /** Teto por adapter. O padrão do adapter é 15 s. */
  readonly timeoutMs?: number;
}

export async function runBootPreflight(
  input: RunBootPreflightInput,
): Promise<readonly PreflightOutcome[]> {
  const { db, userId, adapters, logger } = input;
  const outcomes: PreflightOutcome[] = [];

  // Só os adapters de host. A linha do Harness no banco guarda **uma**
  // `installedVersion`, e ela descreve a CLI desta máquina; deixar o adapter de
  // container escrever ali faria a tela de Guildas mostrar a versão de dentro da
  // imagem em cima da versão do host, alternando conforme a ordem do registro.
  // O preflight do modo `DOCKER` acontece por Run, dentro do `AgentRuntime`, que
  // é onde a imagem e o daemon importam — e onde subir um container é aceitável.
  // A matriz de capabilities é a mesma nos dois adapters de propósito, então
  // `dockerExecution` continua sendo gravado corretamente a partir do host.
  const doHost = adapters.filter((adapter) => (adapter.executionMode ?? "HOST") === "HOST");

  for (const adapter of doHost) {
    let result: PreflightResult;
    try {
      result = await adapter.preflight({
        mode: "HOST",
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      });
    } catch (error) {
      // Um adapter cujo preflight estoura é um defeito nosso, não um harness
      // ausente. Ele vira uma linha `installed: false` para a matriz continuar
      // completa, e o erro aparece no log com o nome do adapter.
      logger?.error({ err: error, adapter: adapter.id }, "preflight_adapter_error");
      result = {
        installed: false,
        problems: [
          {
            code: "NOT_INSTALLED",
            message: error instanceof Error ? error.message : String(error),
            fatal: true,
          },
        ],
      };
    }

    const harness = await findHarnessRowByKey(db, { userId, key: adapter.key });
    if (harness !== null) {
      await recordHarnessPreflight(db, {
        userId,
        harnessId: harness.id,
        installedVersion: result.version ?? null,
        // A matriz gravada é a do **adapter**, não a da semente: o que o código
        // realmente sabe fazer ganha do que o `db:seed` declarou.
        capabilities: toContractCapabilities(adapter.capabilities),
      });
    }

    outcomes.push({
      harnessKey: adapter.key,
      adapterId: adapter.id,
      installed: result.installed,
      version: result.version ?? null,
      executablePath: result.executablePath,
      problems: result.problems,
      recorded: harness !== null,
    });
  }

  logger?.info(
    {
      harnesses: outcomes.map((outcome) => ({
        key: outcome.harnessKey,
        adapter: outcome.adapterId,
        installed: outcome.installed,
        version: outcome.version,
        problems: outcome.problems.map((problem) => problem.code),
      })),
    },
    "preflight de harnesses concluído",
  );

  for (const outcome of outcomes) {
    if (!outcome.recorded) {
      logger?.warn(
        { key: outcome.harnessKey },
        "harness fora do cadastro: rode `pnpm db:seed` para o preflight ter onde gravar",
      );
    }
  }

  return outcomes;
}
