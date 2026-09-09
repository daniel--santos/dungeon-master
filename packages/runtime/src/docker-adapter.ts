/**
 * O adapter de harness que roda a CLI dentro de um container.
 *
 * A regra desta camada é uma só: **o que muda é o spawn**. `buildArgs`,
 * `parseLine`, `describeExit` e a matriz de capabilities são os mesmos objetos
 * que o adapter de host usa; o que este arquivo acrescenta é o `docker run` em
 * volta, a tradução da política de rede, os mounts do workspace e um
 * cancelamento que confirma que o container sumiu.
 *
 * Manter os dois modos sobre o mesmo `createHostAdapter` não é economia de
 * linhas: é o que garante que um `ToolCall` no modo `DOCKER` chega à interface
 * exatamente igual ao do modo `HOST`, que é a exigência da seção 17 do
 * documento técnico ("a UI e o domínio não devem precisar saber detalhes de
 * container lifecycle").
 */

import { rm } from "node:fs/promises";

import type { HarnessKey } from "@dungeon-master/contracts";

import type { HarnessCapabilities } from "./capabilities.js";
import {
  buildContainerEnv,
  buildDockerRunArgs,
  containerNameFor,
  CONTAINER_WORKSPACE_DIR,
  createDockerCli,
  DEFAULT_AGENT_IMAGE,
  dockerPreflight,
  removeContainer,
  resolveWorkspaceMounts,
  toDockerHostPath,
  type DockerCli,
  type DockerMount,
  type DockerResourceLimits,
} from "./docker.js";
import type {
  HarnessAdapter,
  HarnessCancelOptions,
  HarnessCancelResult,
  HarnessContext,
  HarnessEvent,
  HarnessExecutionRequest,
  PreflightProblem,
  PreflightResult,
  ResolvedNetwork,
} from "./harness.js";
import { createHostAdapter, type HarnessSignal, type HostCommand } from "./host-adapter.js";
import {
  mcpServersForContainer,
  mcpServersWithoutContainerLaunch,
  type McpServerSpec,
} from "./mcp.js";
import type { RuntimeResourceLimits } from "./types.js";

/** Quanto tempo um preflight aprovado vale. Igual ao do adapter de host. */
const PREFLIGHT_TTL_MS = 300_000;

/** Teto do `--version` **dentro** do container: sobe um container inteiro. */
const VERSION_TIMEOUT_MS = 60_000;

/** O nome pelo qual o container alcança o host, ligado por `--add-host`. */
export const CONTAINER_HOST_GATEWAY = "host.docker.internal:host-gateway";

/** Checagem de autenticação não interativa, rodada dentro do container. */
export interface ContainerAuthCheck {
  readonly args: readonly string[];
  /**
   * Traduz a saída em veredito. `undefined` é resposta legítima: dizer `false`
   * sem prova travaria execuções que funcionariam (contrato de `PreflightResult`).
   */
  interpret(result: {
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
  }): boolean | undefined;
}

export interface DockerHarnessDefinition {
  readonly id: string;
  readonly key: HarnessKey;
  readonly capabilities: HarnessCapabilities;
  /** Executável **dentro da imagem**. Não passa pelo PATH do host. */
  readonly binary: string;
  readonly versionArgs: readonly string[];
  parseVersion(stdout: string, stderr: string): string | undefined;
  buildArgs(request: HarnessExecutionRequest): {
    readonly args: readonly string[];
    readonly stdin?: string;
  };
  parseLine(line: string): readonly HarnessSignal[];
  describeExit?(
    exitCode: number | null,
    stderrTail: string,
  ): { readonly message: string; readonly retryable: boolean } | undefined;
  /**
   * Chaves do ambiente do worker que atravessam para dentro do container.
   *
   * É por aqui que a credencial entra, e é a forma preferida pelo ADR 0001: o
   * sanitizador de credenciais procura o **valor** das variáveis conhecidas no
   * ambiente do worker, então um segredo entregue por variável é redigível no
   * log e um segredo que só existe dentro de um arquivo montado não é.
   */
  readonly containerEnvKeys: readonly string[];
  /**
   * Arquivos de credencial do host montados read-only, quando não houver
   * variável.
   *
   * Sempre um arquivo específico, nunca um diretório de home (documento
   * técnico, seção 31). Devolver lista vazia é o caminho normal.
   */
  credentialMounts?(env: Readonly<Record<string, string>>): readonly DockerMount[];
  readonly authCheck?: ContainerAuthCheck;
  readonly maxTailChars?: number;
}

export interface DockerAdapterOptions {
  /** Imagem de referência. Padrão: {@link DEFAULT_AGENT_IMAGE}. */
  readonly image?: string;
  /** Cliente Docker. Injetável para teste com um Docker falso. */
  readonly docker?: DockerCli;
  /** `UID:GID` do container. Padrão: o do worker no POSIX, `1000:1000` no Windows. */
  readonly user?: string;
  /** Limites padrão, quando o perfil não trouxer os dele. */
  readonly limits?: RuntimeResourceLimits;
  /** Onde o worktree é montado. Padrão: {@link CONTAINER_WORKSPACE_DIR}. */
  readonly workspaceDir?: string;
  /** Teto do `docker rm -f` até desistir de confirmar. Padrão: 10 s. */
  readonly cancelConfirmMs?: number;
  /**
   * UID do processo do worker, comparado com o UID da imagem no preflight.
   * Padrão: `process.getuid()` no POSIX; ausente no Windows, onde não há UID.
   * Injetável para que o teste não dependa do usuário da máquina: o runner do
   * macOS roda como 501 e a imagem de referência é construída para 1000.
   */
  readonly hostUid?: number;
}

/** Traduz a política de rede resolvida no valor de `--network`. */
export function dockerNetworkFor(network: ResolvedNetwork | undefined): string {
  if (network === undefined) return "bridge";
  // `ALLOWLIST` cai em `bridge` de propósito: o Docker liga ou desliga a rede do
  // container, e filtrar por host exigiria um proxy no meio. O rebaixamento é
  // anunciado pelo `AgentRuntime` como `Diagnostic`, e `enforced: false` é o que
  // impede a interface de prometer o que não existe.
  return network.access === "NONE" ? "none" : "bridge";
}

/** O `UID:GID` do container. No Windows não há UID, e o contrato é 1000:1000. */
export function defaultContainerUser(): string {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid === undefined || gid === undefined) return "1000:1000";
  return `${String(uid)}:${String(gid)}`;
}

function toDockerLimits(limits: RuntimeResourceLimits | undefined): DockerResourceLimits {
  if (limits === undefined) return {};
  return {
    ...(limits.cpus === undefined ? {} : { cpus: limits.cpus }),
    ...(limits.memoryMb === undefined ? {} : { memory: `${String(limits.memoryMb)}m` }),
    ...(limits.pidsLimit === undefined ? {} : { pidsLimit: limits.pidsLimit }),
  };
}

export interface DockerRunCommandInput {
  readonly definition: DockerHarnessDefinition;
  readonly request: HarnessExecutionRequest;
  readonly image: string;
  readonly containerName: string;
  readonly workspaceDir: string;
  readonly user: string;
  /** Os mounts do checkout, já resolvidos (worktree e `.git` pai). */
  readonly workspaceMounts: readonly DockerMount[];
  readonly limits?: RuntimeResourceLimits | undefined;
}

/**
 * O `docker run` de um Run, como `HostCommand`: argv, ambiente do cliente e
 * stdin.
 *
 * Pura de propósito — sem `docker rm`, sem sistema de arquivos —, porque é o
 * argv que guarda os erros caros deste backend: um segredo que vaza para a
 * linha de comando, um mount que não é read-only, um `--network` que não
 * chega. O teste monta um pedido e lê o comando, sem subir container nenhum.
 */
export function buildDockerRunCommand(input: DockerRunCommandInput): {
  readonly command: HostCommand;
  readonly warnings: readonly string[];
} {
  const { definition, request } = input;

  const credenciais = definition.credentialMounts?.(request.env) ?? [];
  const mcp = prepareContainerMcp(request.mcpServers);

  // O ambiente inteiro que o runtime montou, e **não** só as chaves de
  // credencial. `request.env` já é uma allow-list: o `AgentRuntime` a montou
  // com o piso do sistema operacional, as chaves que o adapter declarou e as
  // variáveis que a `environmentPolicy` do perfil pediu. Filtrar de novo por
  // `containerEnvKeys` aqui jogaria fora justamente as da política — um Run em
  // Campo aberto enxergaria `MY_VAR` e o mesmo Run em Masmorra selada não,
  // sem nada no diário explicando a diferença.
  //
  // `buildContainerEnv` tira o que não faz sentido lá dentro: o piso do SO,
  // que a imagem define melhor, e os caminhos que só existem no host.
  //
  // As variáveis reescritas para o container (o endereço do banco do servidor
  // MCP) entram por cima com o valor de lá: o argv continua levando só o
  // nome, e o valor viaja pelo ambiente do cliente como qualquer segredo.
  const env = { ...buildContainerEnv(request.env), ...mcp.env };
  const { args, stdin } = definition.buildArgs({
    ...request,
    ...(mcp.servers === undefined ? {} : { mcpServers: mcp.servers }),
  });

  const dockerArgs = buildDockerRunArgs(
    {
      image: input.image,
      containerName: input.containerName,
      workdir: input.workspaceDir,
      user: input.user,
      mounts: [...input.workspaceMounts, ...credenciais, ...mcp.mounts],
      envKeys: Object.keys(env),
      network: dockerNetworkFor(request.network),
      limits: toDockerLimits(input.limits),
      ...(mcp.reachHost ? { extraHosts: [CONTAINER_HOST_GATEWAY] } : {}),
    },
    [definition.binary, ...args],
  );

  return {
    command: {
      command: "docker",
      args: dockerArgs,
      // Os valores vão pelo ambiente do processo cliente do Docker, que é o que
      // o `-e NOME` do argv manda repassar. É o que mantém o segredo fora da
      // linha de comando visível na tabela de processos do host.
      env,
      ...(stdin === undefined ? {} : { stdin }),
    },
    warnings: mcp.warnings,
  };
}

export function createDockerAdapter(
  definition: DockerHarnessDefinition,
  options: DockerAdapterOptions = {},
): HarnessAdapter {
  const docker = options.docker ?? createDockerCli();
  const image = options.image ?? DEFAULT_AGENT_IMAGE;
  const workspaceDir = options.workspaceDir ?? CONTAINER_WORKSPACE_DIR;
  const user = options.user ?? defaultContainerUser();

  /** Diretórios temporários do `.git` de sobreposição, por execução. */
  const tempDirs = new Map<string, string>();
  /**
   * Avisos do preparo do container, por execução.
   *
   * Um checkout cujo `.git` o runtime não reconheceu ainda roda — o container
   * recebe os arquivos —, mas `git status` falha lá dentro e o agente não
   * consegue commitar. Engolir isso produziria um Run que termina "com sucesso"
   * sem espólio nenhum e sem ninguém saber por quê. Um servidor MCP do Loadout
   * sem comando para dentro da imagem é o outro caso: ele sobe se o comando
   * existir lá, e o aviso diz o que aconteceu se não subir.
   */
  const avisos = new Map<string, string[]>();
  const avisar = (executionId: string, aviso: string): void => {
    avisos.set(executionId, [...(avisos.get(executionId) ?? []), aviso]);
  };
  let cached: { result: PreflightResult; at: number } | undefined;

  /** Roda um comando curto dentro de um container descartável. */
  const runInContainer = async (
    args: readonly string[],
    timeoutMs: number,
  ): Promise<{ code: number | null; stdout: string; stderr: string }> =>
    docker(
      ["run", "--rm", "--user", user, "--network", "bridge", image, definition.binary, ...args],
      { timeoutMs },
    );

  const preflight = async (context: HarnessContext): Promise<PreflightResult> => {
    if (cached !== undefined && Date.now() - cached.at < PREFLIGHT_TTL_MS) return cached.result;

    const uid = options.hostUid ?? process.getuid?.();
    const ambiente = await dockerPreflight({
      docker,
      image,
      ...(uid === undefined ? {} : { expectedUid: uid }),
    });

    if (!ambiente.daemonReachable || !ambiente.imagePresent) {
      // Sem daemon ou sem imagem não há o que perguntar à CLI. O resultado não é
      // cacheado: subir o Docker Desktop precisa valer no Run seguinte, sem
      // reiniciar o worker.
      return { installed: false, problems: ambiente.problems };
    }

    const problems: PreflightProblem[] = [...ambiente.problems];

    const versao = await runInContainer(
      definition.versionArgs,
      context.timeoutMs ?? VERSION_TIMEOUT_MS,
    );
    const version = definition.parseVersion(versao.stdout, versao.stderr);
    if (version === undefined) {
      problems.push({
        code: "VERSION_UNREADABLE",
        message:
          `Não consegui ler a versão de ${definition.binary} dentro de ${image} ` +
          `(código ${String(versao.code)}). Resultados deixam de ser comparáveis por versão.`,
        fatal: false,
      });
    }

    let authenticated: boolean | undefined;
    if (definition.authCheck !== undefined) {
      const hostEnv = context.env ?? {};
      const credenciais = definition.credentialMounts?.(hostEnv) ?? [];
      const mounts = credenciais.flatMap((mount) => [
        "-v",
        `${toDockerHostPath(mount.hostPath)}:${mount.containerPath}${mount.readOnly === true ? ":ro" : ""}`,
      ]);
      // Mesma regra do Run: `-e NOME` no argv, valor no ambiente do cliente.
      const env = buildContainerEnv(pick(hostEnv, definition.containerEnvKeys));
      const envFlags = Object.keys(env)
        .sort()
        .flatMap((key) => ["-e", key]);
      const check = await docker(
        [
          "run",
          "--rm",
          "--user",
          user,
          "--network",
          "bridge",
          ...mounts,
          ...envFlags,
          image,
          definition.binary,
          ...definition.authCheck.args,
        ],
        // O mesmo teto do `--version`: quem chama com pressa (o preflight sob
        // demanda da API) precisa que a checagem de credencial o respeite também.
        { timeoutMs: context.timeoutMs ?? VERSION_TIMEOUT_MS, env },
      );
      authenticated = definition.authCheck.interpret(check);
      if (authenticated === false) {
        problems.push({
          code: "NOT_AUTHENTICATED",
          message:
            `${definition.binary} não está autenticado dentro do container. Veja ` +
            "`docs/adr/0001-autenticacao-em-docker.md` para as formas de entregar a credencial.",
          // Não fatal por contrato, mas aqui ele evita o pior caso conhecido: sem
          // credencial o Codex repete um 401 em laço até o timeout de ociosidade.
          fatal: false,
        });
      }
    }

    const result: PreflightResult = {
      installed: true,
      ...(version === undefined ? {} : { version }),
      executablePath: `${image}:${definition.binary}`,
      ...(authenticated === undefined ? {} : { authenticated }),
      problems,
    };

    if (problems.length === 0) cached = { result, at: Date.now() };
    return result;
  };

  const buildCommand = async (request: HarnessExecutionRequest): Promise<HostCommand> => {
    const containerName = containerNameFor(request.executionId);

    // Um container do Run anterior com o mesmo nome impediria o `docker run`.
    // Acontece depois de um `kill -9` no worker, e a recuperação é remover.
    await docker(["rm", "--force", "--volumes", containerName]);

    const workspace = await resolveWorkspaceMounts({
      checkoutPath: request.cwd,
      containerWorkspaceDir: workspaceDir,
    });
    if (workspace.tempDir !== undefined) tempDirs.set(request.executionId, workspace.tempDir);
    if (workspace.warning !== undefined) avisar(request.executionId, workspace.warning);

    const { command, warnings } = buildDockerRunCommand({
      definition,
      request,
      image,
      containerName,
      workspaceDir,
      user,
      workspaceMounts: workspace.mounts,
      limits: request.resourceLimits ?? options.limits,
    });
    for (const aviso of warnings) avisar(request.executionId, aviso);
    return command;
  };

  /** O teto de confirmação que vale: o do pedido, senão o do adapter. */
  const confirmarEm = (confirmMs: number | undefined): { confirmMs?: number } => {
    const escolhido = confirmMs ?? options.cancelConfirmMs;
    return escolhido === undefined ? {} : { confirmMs: escolhido };
  };

  const inner = createHostAdapter({
    id: definition.id,
    key: definition.key,
    executionMode: "DOCKER",
    capabilities: definition.capabilities,
    // As chaves que o `AgentRuntime` precisa deixar passar pela allow-list do
    // ambiente do **worker**, para que o `buildCommand` daqui as encontre em
    // `request.env` e as repasse com `-e` para dentro do container.
    environmentKeys: definition.containerEnvKeys,
    preflight,
    buildCommand,
    parseLine: definition.parseLine,
    ...(definition.describeExit === undefined ? {} : { describeExit: definition.describeExit }),
    ...(definition.maxTailChars === undefined ? {} : { maxTailChars: definition.maxTailChars }),
    // O `confirmMs` do pedido ganha do padrão do adapter: quem sabe quanto um
    // container demora a sumir nesta máquina é quem configurou o Run. `graceMs`
    // não tem correspondente aqui — `docker rm --force` não pede licença.
    terminate: async ({ executionId, confirmMs }) =>
      removeContainer({
        docker,
        containerName: containerNameFor(executionId),
        ...confirmarEm(confirmMs),
      }),
  });

  const limparTemp = async (executionId: string): Promise<void> => {
    const dir = tempDirs.get(executionId);
    if (dir === undefined) return;
    tempDirs.delete(executionId);
    // Um temporário que não sai é lixo, não é falha do Run.
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  };

  return {
    ...inner,
    executionMode: "DOCKER",
    environmentKeys: definition.containerEnvKeys,
    execute: async function* (request: HarnessExecutionRequest): AsyncIterable<HarnessEvent> {
      try {
        for await (const event of inner.execute(request)) {
          yield event;
          // Os avisos do preparo do container só existem depois de
          // `buildCommand`, que roda dentro de `inner.execute`. Emiti-los logo
          // após o primeiro evento os coloca no Diário antes de qualquer coisa
          // que o agente tenha feito sem git ou sem o servidor.
          const pendentes = avisos.get(request.executionId);
          if (pendentes !== undefined) {
            avisos.delete(request.executionId);
            for (const aviso of pendentes) {
              yield {
                type: "Diagnostic",
                timestamp: new Date().toISOString(),
                harness: definition.key,
                level: "WARN",
                source: "RUNTIME",
                code: "DOCKER_CONTAINER_PREPARATION",
                message: aviso,
              };
            }
          }
        }
      } finally {
        avisos.delete(request.executionId);
        await limparTemp(request.executionId);
      }
    },
    cancel: async (
      executionId: string,
      cancelOptions?: HarnessCancelOptions,
    ): Promise<HarnessCancelResult> => {
      const resultado = await inner.cancel(executionId, cancelOptions);
      if (resultado.notRunning === true) {
        // Nenhum processo cliente vivo não quer dizer nenhum container vivo: o
        // `docker run` pode ter morrido sem levar o container junto. Confirmar é
        // barato, e é o que a interface mostra como `processTreeTerminated`.
        const confirmado = await removeContainer({
          docker,
          containerName: containerNameFor(executionId),
          ...confirmarEm(cancelOptions?.confirmMs),
        });
        await limparTemp(executionId);
        return confirmado;
      }
      await limparTemp(executionId);
      return resultado;
    },
  };
}

interface ContainerMcp {
  /** A lista reescrita para dentro do container, ou `undefined` sem servidores. */
  readonly servers: readonly McpServerSpec[] | undefined;
  readonly mounts: readonly DockerMount[];
  /** Variáveis reescritas: nome no argv, valor no ambiente do cliente. */
  readonly env: Readonly<Record<string, string>>;
  /** Algum servidor roda dentro do container e precisa alcançar o host. */
  readonly reachHost: boolean;
  readonly warnings: readonly string[];
}

/**
 * O que os servidores MCP pedem ao container.
 *
 * Os que trazem `container` ganham o mount read-only do arquivo, o comando de
 * dentro da imagem e as variáveis reescritas; os `STDIO` sem `container` são
 * repassados como estão, com um aviso — o comando do host raramente existe na
 * imagem, e o diário precisa dizer por que o servidor não subiu.
 */
export function prepareContainerMcp(servers: readonly McpServerSpec[] | undefined): ContainerMcp {
  if (servers === undefined || servers.length === 0) {
    return { servers: undefined, mounts: [], env: {}, reachHost: false, warnings: [] };
  }

  const mounts: DockerMount[] = [];
  const env: Record<string, string> = {};
  let reachHost = false;
  for (const server of servers) {
    if (server.transport !== "STDIO" || server.container === undefined) continue;
    reachHost = true;
    for (const mount of server.container.mounts ?? []) {
      mounts.push({ ...mount, readOnly: mount.readOnly ?? true });
    }
    Object.assign(env, server.container.env ?? {});
  }

  const warnings = mcpServersWithoutContainerLaunch(servers).map(
    (server) =>
      `O servidor MCP ${server.name} do Loadout foi repassado ao container com o comando ` +
      `do host (${server.command}); ele só sobe se o comando existir na imagem do agente.`,
  );

  return { servers: mcpServersForContainer(servers), mounts, env, reachHost, warnings };
}

/** As chaves pedidas que existem no ambiente. */
function pick(
  env: Readonly<Record<string, string>>,
  keys: readonly string[],
): Record<string, string> {
  const resultado: Record<string, string> = {};
  for (const key of keys) {
    const valor = env[key];
    if (valor !== undefined) resultado[key] = valor;
  }
  return resultado;
}
