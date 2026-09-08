/**
 * A suíte de contrato com as CLIs rodando **dentro de um container**.
 *
 * É o teste que prova a equivalência que a Fase 2 exige: "o mesmo fluxo deve
 * funcionar mudando somente `HOST -> DOCKER`" (planejamento v0.4). Os onze casos
 * são exatamente os mesmos de `contract.test.ts`; o que muda é o adapter, e
 * portanto o spawn.
 *
 * Roda só onde houver **as três coisas ao mesmo tempo**: daemon do Docker no ar,
 * a imagem de referência construída (`pnpm docker:build`) e credencial que a CLI
 * aceite lá dentro. Falta qualquer uma e a suíte some — que é o comportamento
 * certo no CI, onde os runners não têm Docker Linux (CLAUDE.md, seção 8), e na
 * máquina de quem só mexe na web.
 *
 * A decisão de quem entra é do ADR `docs/adr/0001-autenticacao-em-docker.md`. O
 * Codex não está aqui porque não existe `codex@docker`.
 */

import type { HarnessAdapter } from "@dungeon-master/runtime";
import { harnessContractSuite } from "@dungeon-master/runtime/testing";

import { claudeCodeDocker, piDocker } from "./docker.js";

/** `DM_HARNESS_CONTRACT=1` força; `CI` desliga. Mesma regra do modo host. */
const forced = process.env["DM_HARNESS_CONTRACT"] === "1";
const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "";

/**
 * O preflight do adapter é o gate inteiro.
 *
 * Ele já pergunta as três coisas: `docker version` responde (daemon), `docker
 * image inspect` acha a imagem, e o `authCheck` roda a checagem não interativa
 * da CLI **dentro** do container. Um problema fatal ou `authenticated: false`
 * desligam a suíte, e é assim que "sem Docker" e "sem credencial" viram o mesmo
 * `skip` sem a suíte precisar saber o que é um token.
 */
async function available(adapter: HarnessAdapter): Promise<boolean> {
  if (inCi && !forced) return false;
  try {
    const preflight = await adapter.preflight({ mode: "DOCKER", env: process.env as never });
    if (!preflight.installed) return false;
    if (preflight.problems.some((problem) => problem.fatal)) return false;
    // `undefined` é "não deu para saber", e aí vale tentar: o contrato de
    // `PreflightResult` diz que ausência de prova não é prova de ausência.
    return preflight.authenticated !== false;
  } catch {
    return false;
  }
}

const claudeAdapter = claudeCodeDocker();
const piAdapter = piDocker();

const [claudeOk, piOk] = await Promise.all([available(claudeAdapter), available(piAdapter)]);

// Os tetos são maiores que os do modo host: cada caso paga a partida de um
// container (entre 0,7 e 1,1 s medidos), e o `canCancel` ainda espera o
// `docker rm -f` confirmar que o container sumiu.
harnessContractSuite({
  name: "claude-code@docker",
  enabled: claudeOk,
  createAdapter: () => claudeAdapter,
  model: { id: "sonnet" },
  caseTimeoutMs: 240_000,
  completionMs: 200_000,
  cancelAfterMs: 5_000,
});

harnessContractSuite({
  name: "pi@docker",
  enabled: piOk,
  createAdapter: () => piAdapter,
  caseTimeoutMs: 240_000,
  completionMs: 200_000,
  cancelAfterMs: 5_000,
});
