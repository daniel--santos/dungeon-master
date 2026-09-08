/**
 * Os adapters em Docker: as mesmas CLIs, dentro de um container por Run.
 *
 * Cada um destes é a definição de host (`claudeCodeDefinition`, `piDefinition`)
 * embrulhada por `createDockerAdapter`. O `buildArgs`, o `parseLine`, o
 * `describeExit` e as capabilities **são os mesmos objetos**; o que muda é o
 * spawn, os mounts e o cancelamento. Escrever um argv diferente por modo seria a
 * forma mais rápida de fazer o Diário de uma Expedição em Masmorra selada
 * divergir do de uma em Campo aberto sem ninguém perceber.
 *
 * Quem está aqui e quem não está é decisão do ADR
 * `docs/adr/0001-autenticacao-em-docker.md`, não de conveniência:
 *
 * - **Claude Code** e **Pi** têm caminho de credencial provado e ficam
 *   `dockerExecution: true`.
 * - **Codex** ficou experimental: o único caminho provado nele é montar
 *   `~/.codex/auth.json`, cujo conteúdo o sanitizador de credenciais não sabe
 *   redigir se o agente resolver dar `cat` no arquivo. Ele **não** aparece aqui,
 *   e a capability continua `false`.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import {
  createDockerAdapter,
  type DockerAdapterOptions,
  type DockerHarnessDefinition,
  type DockerMount,
  type HarnessAdapter,
} from "@dungeon-master/runtime";

import { claudeCodeDefinition, type ClaudeCodeOptions } from "./claude-code.js";
import { piDefinition, type PiOptions } from "./pi.js";

/** O `HOME` de dentro da imagem. Contrato de `docker/agent.Dockerfile`. */
const CONTAINER_HOME = "/home/agent";

/**
 * O que o Claude Code precisa enxergar **dentro** do container.
 *
 * Bem menor que a lista do host: `HOME` e `APPDATA` ficam de fora porque
 * apontariam para caminhos do Windows, e a imagem já define `HOME=/home/agent`.
 * O que sobra é só credencial e configuração de provedor.
 */
const CLAUDE_CONTAINER_ENV_KEYS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_CUSTOM_HEADERS",
];

const PI_CONTAINER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  "CEREBRAS_API_KEY",
  "ZAI_API_KEY",
  "PI_OFFLINE",
];

/**
 * O arquivo de credencial do Claude Code no host.
 *
 * É a **segunda** forma de entrega, e só entra quando não há
 * `CLAUDE_CODE_OAUTH_TOKEN` no ambiente. Montado read-only e sozinho: nada mais
 * de `~/.claude` viaja, o que é exatamente o que a seção 31 do documento técnico
 * pede ("não devemos resolver isso montando indiscriminadamente o home").
 *
 * O risco residual está no ADR 0001: o conteúdo deste arquivo não é redigível
 * pelo sanitizador de credenciais, que procura o **valor** de variáveis
 * conhecidas no ambiente do worker. Por isso o token continua sendo o caminho
 * recomendado.
 */
export function claudeCredentialMounts(
  env: Readonly<Record<string, string>>,
  options: { readonly home?: string } = {},
): readonly DockerMount[] {
  if ((env["CLAUDE_CODE_OAUTH_TOKEN"] ?? "").length > 0) return [];
  if ((env["ANTHROPIC_API_KEY"] ?? "").length > 0) return [];
  const home = options.home ?? homedir();
  return [
    {
      hostPath: join(home, ".claude", ".credentials.json"),
      containerPath: `${CONTAINER_HOME}/.claude/.credentials.json`,
      readOnly: true,
    },
  ];
}

/** Adapter do Claude Code rodando dentro de um container. */
export function claudeCodeDocker(
  options: ClaudeCodeOptions & DockerAdapterOptions = {},
): HarnessAdapter {
  const base = claudeCodeDefinition(options);
  const definition: DockerHarnessDefinition = {
    ...base,
    id: "claude-code@docker",
    // Dentro da imagem a CLI está no PATH do root; nada de resolver caminho de
    // host aqui.
    binary: "claude",
    containerEnvKeys: CLAUDE_CONTAINER_ENV_KEYS,
    credentialMounts: (env) => claudeCredentialMounts(env),
    authCheck: {
      args: ["auth", "status"],
      interpret: ({ code, stdout }) => {
        if (code !== 0) return false;
        try {
          return (JSON.parse(stdout) as { loggedIn?: unknown }).loggedIn === true;
        } catch {
          // Saída que não é JSON não é prova de nada. `undefined` é a resposta
          // honesta, e o contrato de `PreflightResult` a prevê.
          return undefined;
        }
      },
    },
  };
  return createDockerAdapter(definition, options);
}

/** Adapter do Pi rodando dentro de um container. */
export function piDocker(options: PiOptions & DockerAdapterOptions = {}): HarnessAdapter {
  const base = piDefinition(options);
  const definition: DockerHarnessDefinition = {
    ...base,
    id: "pi@docker",
    binary: "pi",
    containerEnvKeys: PI_CONTAINER_ENV_KEYS,
    authCheck: {
      args: ["auth", "check", "--provider", options.provider ?? "google", "--json"],
      interpret: ({ code, stdout }) => {
        if (code === 0) return true;
        return /credentials_not_configured|not_ready/.test(stdout) ? false : undefined;
      },
    },
  };
  return createDockerAdapter(definition, options);
}

/**
 * Os adapters liberados para o modo `DOCKER`.
 *
 * O Codex não está aqui de propósito. Registrar um adapter que só autentica por
 * arquivo montado seria prometer, no cadastro de harnesses, uma coisa que o ADR
 * 0001 classificou como experimental.
 */
export function dockerAdapters(options: DockerAdapterOptions = {}): readonly HarnessAdapter[] {
  return [claudeCodeDocker(options), piDocker(options)];
}
