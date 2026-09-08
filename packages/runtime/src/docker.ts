// Adapted from Sandcastle — src/mountUtils.ts@e99f832 (`PARENT_GIT_SANDBOX_DIR`,
// `parseGitdirPath` e `patchGitMountsForWindows`).
// Copyright (c) 2026 Matt Pocock. Licensed under the MIT License.
// Changes: o `Effect.gen`/`Effect.tryPromise` da origem virou `async`/`await` com
// `try`/`catch`, e o `WorktreeError` virou o campo `warning` do resultado — aqui um
// `.git` estranho não pode derrubar o Run. O remapeamento deixou de ser condicional a
// `win32`: no original, fora do Windows o `.git` pai é montado no mesmo caminho do host
// e o `gitdir:` resolve por acaso, o que faz o caminho do host vazar para dentro do
// container e cria dois comportamentos para testar em vez de um. `parseGitdirPath`
// devolve `undefined` em vez de confiar na forma do caminho (a entrada vem de um arquivo
// no disco do usuário). A função deixou de reescrever uma lista de mounts pré-existente e
// passou a produzir os mounts do zero, porque aqui não há `resolveGitMounts` antes dela.
// Os parâmetros injetáveis de I/O da origem foram preservados: são o que torna o
// comportamento de Windows testável na nossa matriz de CI. Nenhum import de `effect`
// sobrou. Testes: `docker.test.ts` cobre os casos de `mountUtils.test.ts` que se aplicam
// (clone comum, worktree do Windows, worktree POSIX, `.git` sem `gitdir:`, `.git`
// ilegível). Veja `THIRD_PARTY_NOTICES.md`.

/**
 * A estratégia de ambiente `DOCKER`: um container por Run.
 *
 * O que muda em relação ao modo `HOST` é **só o spawn**. O argv da CLI, o
 * parser do NDJSON, a cauda limitada, a tradução para `ExecutionEvent` e o
 * resultado estruturado continuam sendo os mesmos objetos; o que este arquivo
 * faz é embrulhar aquele argv num `docker run` e trocar o kill de árvore de
 * processos por `docker rm -f` com confirmação.
 *
 * Três decisões que valem ser lidas antes do código:
 *
 * 1. **Um `docker run --rm` por Run, e não um container longevo com `exec`.**
 *    O Sandcastle usa `docker run -d` + `docker exec` sobre uma imagem com
 *    `ENTRYPOINT ["sleep","infinity"]`, e paga por isso com um defeito
 *    documentado: o `env` do provider de agente não chega a container longevo,
 *    porque ele é fixado no `docker run` e o `docker exec` de lá não aceita
 *    `-e` (documento técnico, seção 18.1). Com um container por execução o
 *    problema não existe, o `--rm` já é metade da limpeza, e o custo medido é de
 *    cerca de um segundo por Run.
 * 2. **O caminho do `.git` pai é remapeado nos dois sistemas, e não só no
 *    Windows.** Veja {@link resolveWorkspaceMounts}.
 * 3. **O ambiente do container é montado do zero.** O `env` que o `AgentRuntime`
 *    entrega ao adapter é o ambiente do **host** — `PATH` do Windows,
 *    `HOME=C:\Users\…`, `APPDATA` — e passá-lo adiante quebraria o container em
 *    vez de configurá-lo. Só passam as chaves que sobram depois de tirar o piso
 *    do sistema operacional e os caminhos que só fazem sentido no host.
 */

import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { essentialEnvKeys } from "@dungeon-master/platform";

import type { HarnessCancelResult } from "./harness.js";
import { collectProcess } from "./process.js";
import type { PreflightProblem } from "./harness.js";

/** Onde o worktree do Run é montado. Combina com o `WORKDIR` da imagem. */
export const CONTAINER_WORKSPACE_DIR = "/home/agent/workspace";

/**
 * Ponto de montagem determinístico do `.git` do repositório pai.
 *
 * Adaptado de Sandcastle — `src/mountUtils.ts@e99f832` (`PARENT_GIT_SANDBOX_DIR`
 * e `patchGitMountsForWindows`), MIT, © 2026 Matt Pocock.
 * Changes: o remapeamento deixou de ser condicional a `win32`. No Sandcastle,
 * fora do Windows o `.git` pai é montado no **mesmo caminho do host**, e o
 * `gitdir:` original resolve por acaso; isso faz o caminho do host vazar para
 * dentro do container e produz dois comportamentos para testar em vez de um.
 * Aqui o remapeamento é sempre o mesmo, o `.git` de sobreposição é sempre
 * escrito, e o container nunca vê onde o repositório mora no host.
 */
export const CONTAINER_PARENT_GIT_DIR = "/.dungeon-master-parent-git";

/** Imagem de referência construída por `docker/agent.Dockerfile`. */
export const DEFAULT_AGENT_IMAGE = "dungeon-master-agent:0.2.0";

/**
 * Chaves que **nunca** atravessam para o container.
 *
 * Ou porque a imagem já as define melhor (`PATH`, `HOME`), ou porque apontam
 * para um caminho do host que dentro do container não existe. `CLAUDE_CONFIG_DIR`
 * está aqui de propósito: mandá-lo faria a CLI procurar credencial num diretório
 * do Windows.
 */
export const HOST_ONLY_ENV_KEYS: readonly string[] = [
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "PI_HOME",
  "SHELL",
  "USER",
  "LOGNAME",
];

/** Um bind mount do host para dentro do container. */
export interface DockerMount {
  readonly hostPath: string;
  readonly containerPath: string;
  readonly readOnly?: boolean;
}

/** Limites de recurso do container, quando o ExecutionProfile os trouxer. */
export interface DockerResourceLimits {
  /** Fração de CPUs (`--cpus`). `2` são dois núcleos inteiros. */
  readonly cpus?: number;
  /** Memória com sufixo do Docker (`--memory`): `2g`, `512m`. */
  readonly memory?: string;
  /** Teto de processos (`--pids-limit`). Trava fork bomb. */
  readonly pidsLimit?: number;
}

export interface DockerRunOptions {
  readonly image: string;
  readonly containerName: string;
  readonly workdir: string;
  /** `UID:GID` numérico. Precisa bater com o `USER` da imagem. */
  readonly user?: string;
  readonly mounts: readonly DockerMount[];
  /**
   * **Nomes** das variáveis que atravessam para o container, sem os valores.
   *
   * Cada uma vira um `-e NOME` sem `=`, que é a forma do Docker de dizer
   * "repasse o valor que o **cliente** tem". O valor nunca entra no argv, e é
   * essa a diferença que importa: o argv de um processo é legível por qualquer
   * processo da máquina (`ps -ef` no Linux, o Gerenciador de Tarefas no
   * Windows), e o `CLAUDE_CODE_OAUTH_TOKEN` de um Run ficaria visível para
   * qualquer coisa rodando no host durante toda a execução. O valor viaja pelo
   * ambiente do processo cliente do Docker — veja `DockerCli` e
   * `HostCommand.env`.
   */
  readonly envKeys: readonly string[];
  /**
   * Variáveis com valor **fixo**, definidas pela definição do harness e não
   * lidas do ambiente do worker.
   *
   * Estas viram `-e NOME=VALOR` e portanto **entram no argv**, que é legível por
   * qualquer processo da máquina. Por isso valem uma regra sem exceção:
   *
   * > **Nada aqui pode ser segredo.** Um segredo vai por {@link envKeys}, que
   * > manda só o nome, ou por arquivo montado read-only.
   *
   * Existem porque algumas CLIs precisam ser **configuradas** para dentro do
   * container com um valor que só faz sentido lá: um interruptor de modo de
   * autenticação, ou um caminho do sistema de arquivos do container. O caso que
   * criou este campo é o Antigravity (`docs/adr/0002-antigravity-em-docker.md`):
   * ele quer `AGY_ADC_AUTH=1`, que é um interruptor, e
   * `GOOGLE_APPLICATION_CREDENTIALS` apontando para o **caminho de montagem**
   * do arquivo dentro do container. Nenhum dos dois é o segredo: o segredo é o
   * conteúdo do arquivo, que chega pelo mount e nunca pelo argv.
   */
  readonly fixedEnv?: Readonly<Record<string, string>>;
  /**
   * Valor de `--network`. `none` é uma masmorra selada de verdade, e também um
   * container que não consegue falar com a API do modelo: quem escolhe é a
   * `networkPolicy` do perfil.
   */
  readonly network?: string;
  readonly limits?: DockerResourceLimits;
  /**
   * Entradas de `--add-host`, no formato `nome:endereço`.
   *
   * `host.docker.internal:host-gateway` é o que faz um processo de dentro do
   * container alcançar um serviço do host — o PostgreSQL do servidor MCP do
   * Grimório. O Docker Desktop já resolve o nome sem isso; o Docker do Linux
   * não, e a entrada é inofensiva onde é redundante.
   */
  readonly extraHosts?: readonly string[];
}

/**
 * Converte um caminho do host para a forma que o cliente Docker aceita.
 *
 * `D:\Dev\repo` vira `D:/Dev/repo`. Não é `/d/Dev/repo` nem `//d/Dev/repo`: o
 * cliente Docker no Windows entende a letra de unidade, e é o MSYS de um shell
 * bash que às vezes reescreve o caminho — por isso o argv nunca passa por shell
 * (CLAUDE.md, seção 8).
 */
export function toDockerHostPath(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Nome do container derivado do `runId`.
 *
 * Determinístico de propósito: é o que permite `docker rm -f` sem guardar
 * estado, inclusive depois de um restart do worker.
 */
export function containerNameFor(runId: string): string {
  const limpo = runId.replace(/[^A-Za-z0-9_.-]/g, "-");
  return `dm-run-${limpo}`;
}

/** Monta o argv completo do `docker run`. O comando do agente vem por último. */
export function buildDockerRunArgs(
  options: DockerRunOptions,
  command: readonly string[],
): string[] {
  const args = ["run", "--rm", "--name", options.containerName];

  // `-i` porque o prompt viaja pelo stdin. Sem TTY: a saída precisa ser NDJSON
  // limpo, e um TTY traria códigos de controle no meio do JSON.
  args.push("-i");

  if (options.user !== undefined) args.push("--user", options.user);

  for (const mount of options.mounts) {
    const alvo = `${toDockerHostPath(mount.hostPath)}:${mount.containerPath}`;
    args.push("-v", mount.readOnly === true ? `${alvo}:ro` : alvo);
  }

  // Ordenado para o argv ser estável entre execuções, o que torna o teste
  // unitário legível e o log comparável. `-e NOME` sem `=`: o valor fica no
  // ambiente do cliente e não no argv. Veja `DockerRunOptions.envKeys`.
  const nomesDoAmbiente = [...new Set(options.envKeys)].sort();
  const nomesFixos = Object.keys(options.fixedEnv ?? {}).sort();

  // O mesmo nome nos dois lugares é ambiguidade, e a resolução silenciosa seria
  // a pior possível: quem vence é o último `-e` do argv, ou seja o valor fixo
  // sobrescreveria a credencial vinda do ambiente do cliente sem nada dizer.
  const colisao = nomesFixos.find((nome) => nomesDoAmbiente.includes(nome));
  if (colisao !== undefined) {
    throw new Error(
      `A variável ${colisao} foi declarada em envKeys e em fixedEnv ao mesmo tempo. ` +
        "Uma manda só o nome e resolve o valor no ambiente do cliente; a outra escreve o " +
        "valor no argv. Escolha uma.",
    );
  }

  for (const key of nomesDoAmbiente) {
    args.push("-e", key);
  }
  for (const key of nomesFixos) {
    args.push("-e", `${key}=${options.fixedEnv?.[key] ?? ""}`);
  }

  args.push("-w", options.workdir);

  if (options.network !== undefined) args.push("--network", options.network);
  for (const host of options.extraHosts ?? []) args.push("--add-host", host);
  if (options.limits?.cpus !== undefined) args.push("--cpus", String(options.limits.cpus));
  if (options.limits?.memory !== undefined) args.push("--memory", options.limits.memory);
  if (options.limits?.pidsLimit !== undefined) {
    args.push("--pids-limit", String(options.limits.pidsLimit));
  }

  args.push(options.image, ...command);
  return args;
}

/**
 * O ambiente que atravessa para dentro do container.
 *
 * Parte do ambiente que o `AgentRuntime` montou para o host e tira o que não
 * faz sentido lá dentro. O que sobra é exatamente o que alguém pediu de
 * propósito: credencial de harness e variável declarada na `environmentPolicy`.
 */
export function buildContainerEnv(
  hostEnv: Readonly<Record<string, string>>,
  options: { readonly platform?: NodeJS.Platform; readonly extra?: Record<string, string> } = {},
): Record<string, string> {
  const bloqueadas = new Set<string>([
    ...essentialEnvKeys(options.platform ?? process.platform),
    ...essentialEnvKeys("win32"),
    ...essentialEnvKeys("linux"),
    ...HOST_ONLY_ENV_KEYS,
  ]);

  const resultado: Record<string, string> = {};
  for (const [key, value] of Object.entries(hostEnv)) {
    if (bloqueadas.has(key)) continue;
    resultado[key] = value;
  }
  return { ...resultado, ...(options.extra ?? {}) };
}

/** Um `.git` que é arquivo (worktree) e para onde ele aponta. */
export interface ParsedGitdir {
  readonly parentGitDir: string;
  readonly worktreeName: string;
}

/**
 * Quebra um caminho de `gitdir:` no `.git` do repositório pai e no nome do
 * worktree.
 *
 * Adaptado de Sandcastle — `src/mountUtils.ts@e99f832` (`parseGitdirPath`), MIT,
 * © 2026 Matt Pocock. Changes: devolve `undefined` em vez de confiar que o
 * caminho tem a forma esperada, porque aqui a entrada vem de um arquivo do disco
 * do usuário e um `.git` estranho não pode derrubar o Run.
 */
export function parseGitdirPath(gitdirPath: string): ParsedGitdir | undefined {
  const normalizado = gitdirPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const partes = normalizado.split("/");
  const worktreeName = partes.pop();
  const marcador = partes.pop();
  if (worktreeName === undefined || marcador !== "worktrees" || partes.length === 0) {
    return undefined;
  }
  return { worktreeName, parentGitDir: partes.join("/") };
}

export interface WorkspaceMountsResult {
  readonly mounts: readonly DockerMount[];
  /** Diretório temporário criado para o `.git` de sobreposição, se houver. */
  readonly tempDir?: string;
  /** Vira `Diagnostic` quando o layout do checkout não foi reconhecido. */
  readonly warning?: string;
}

/**
 * Os mounts do workspace de um Run.
 *
 * O caso simples é um `.git` diretório: o checkout é o repositório inteiro e um
 * mount basta. O caso do projeto é o outro: a estratégia padrão é
 * `GIT_WORKTREE`, e o worktree do Run mora **fora** do repositório
 * (`<pai>/<repo>.dm-worktrees/<runId>`), com um `.git` que é um arquivo de uma
 * linha apontando para `<repo>/.git/worktrees/<runId>`.
 *
 * Montar só o worktree entregaria ao container um diretório onde `git status`
 * falha. São necessários três ajustes, e são os do ADR 0006 do Sandcastle:
 *
 * 1. montar o `.git` do repositório pai, em {@link CONTAINER_PARENT_GIT_DIR};
 * 2. escrever um `.git` novo com o caminho já em POSIX;
 * 3. sobrepor esse arquivo ao `.git` do worktree dentro do container.
 *
 * O `commondir` não precisa de conserto: ele é relativo (`../..`) e resolve
 * sozinho quando o `.git` pai inteiro está montado.
 */
export async function resolveWorkspaceMounts(input: {
  readonly checkoutPath: string;
  readonly containerWorkspaceDir?: string;
  /** Injetáveis para teste. */
  readonly deps?: {
    readonly statPath: (p: string) => Promise<"file" | "directory" | "missing">;
    readonly readTextFile: (p: string) => Promise<string>;
    readonly writeOverride: (content: string) => Promise<{ dir: string; file: string }>;
  };
}): Promise<WorkspaceMountsResult> {
  const destino = input.containerWorkspaceDir ?? CONTAINER_WORKSPACE_DIR;
  const deps = input.deps ?? defaultMountDeps;
  const base: DockerMount = { hostPath: input.checkoutPath, containerPath: destino };

  const gitEntry = join(input.checkoutPath, ".git");
  const tipo = await deps.statPath(gitEntry);

  // Sem `.git`: um diretório qualquer. Vale montar e deixar o agente reclamar.
  if (tipo === "missing") return { mounts: [base] };
  // `.git` diretório: clone comum, o mount do checkout já leva tudo junto.
  if (tipo === "directory") return { mounts: [base] };

  let conteudo: string;
  try {
    conteudo = (await deps.readTextFile(gitEntry)).trim();
  } catch (error) {
    return {
      mounts: [base],
      warning: `Não consegui ler ${gitEntry}: ${describe(error)}. O container vai receber o checkout sem o .git do repositório pai, e comandos git podem falhar lá dentro.`,
    };
  }

  const match = /^gitdir:\s*(.+)$/m.exec(conteudo);
  if (match === null) {
    return {
      mounts: [base],
      warning: `O arquivo ${gitEntry} não tem a linha \`gitdir:\` esperada de um worktree. O container vai receber o checkout sem o .git do repositório pai.`,
    };
  }

  const parsed = parseGitdirPath(match[1] ?? "");
  if (parsed === undefined) {
    return {
      mounts: [base],
      warning: `Não reconheci o caminho de \`gitdir:\` em ${gitEntry}. O container vai receber o checkout sem o .git do repositório pai.`,
    };
  }

  const corrigido = `${CONTAINER_PARENT_GIT_DIR}/worktrees/${parsed.worktreeName}`;
  const override = await deps.writeOverride(`gitdir: ${corrigido}\n`);

  return {
    mounts: [
      base,
      // O `.git` pai é montado read-write: é para lá que o `git commit` de
      // dentro do container escreve os objetos, e é o que faz o commit aparecer
      // no host sem nenhum passo de sincronização.
      { hostPath: parsed.parentGitDir, containerPath: CONTAINER_PARENT_GIT_DIR },
      { hostPath: override.file, containerPath: `${destino}/.git`, readOnly: true },
    ],
    tempDir: override.dir,
  };
}

const defaultMountDeps = {
  statPath: async (p: string): Promise<"file" | "directory" | "missing"> => {
    try {
      const s = await stat(p);
      return s.isDirectory() ? "directory" : "file";
    } catch {
      return "missing";
    }
  },
  readTextFile: (p: string): Promise<string> => readFile(p, "utf8"),
  writeOverride: async (content: string): Promise<{ dir: string; file: string }> => {
    const dir = await mkdtemp(join(tmpdir(), "dm-docker-git-"));
    const file = join(dir, "git-override");
    await writeFile(file, content, "utf8");
    return { dir, file };
  },
};

/**
 * Executa um comando do cliente Docker. Injetável para teste.
 *
 * `options.env` são variáveis somadas ao ambiente do **cliente**, e é por elas
 * que um segredo chega ao container sem passar pelo argv: o argv diz `-e NOME`
 * e o cliente resolve o valor no próprio ambiente.
 */
export type DockerCli = (
  args: readonly string[],
  options?: {
    readonly timeoutMs?: number;
    readonly env?: Readonly<Record<string, string>>;
  },
) => Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }>;

/** O `DockerCli` de verdade, sobre `collectProcess`. */
export function createDockerCli(binary = "docker"): DockerCli {
  return async (args, options) => {
    const resultado = await collectProcess(binary, args, {
      cwd: process.cwd(),
      env: { ...dockerClientEnv(), ...(options?.env ?? {}) },
      timeoutMs: options?.timeoutMs ?? 30_000,
    });
    if (resultado.error !== undefined) {
      return { code: null, stdout: "", stderr: resultado.error.message };
    }
    return { code: resultado.code, stdout: resultado.stdout, stderr: resultado.stderr };
  };
}

/**
 * O ambiente do **cliente** Docker, que não é o do agente.
 *
 * O cliente precisa achar o socket ou o pipe do daemon, e no macOS o contexto
 * do Docker Desktop mora em `~/.docker`. É por isso que `HOME` e `DOCKER_*`
 * passam aqui e não passam para dentro do container.
 */
function dockerClientEnv(): Record<string, string> {
  const chaves = [
    ...essentialEnvKeys(),
    "HOME",
    "USERPROFILE",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
    "DOCKER_CERT_PATH",
    "DOCKER_TLS_VERIFY",
  ];
  const env: Record<string, string> = {};
  for (const chave of chaves) {
    const valor = process.env[chave];
    if (valor !== undefined) env[chave] = valor;
  }
  return env;
}

export interface DockerPreflightResult {
  readonly daemonReachable: boolean;
  readonly serverVersion?: string;
  readonly imagePresent: boolean;
  /** `USER` da imagem, que precisa bater com o UID do worker. */
  readonly imageUser?: string;
  readonly problems: readonly PreflightProblem[];
}

/**
 * Preflight do modo: daemon acessível, imagem presente, dono compatível.
 *
 * Cada problema explica **o que falta e como resolver**. Um "Docker não está
 * disponível" sem o comando que constrói a imagem obriga quem lê a adivinhar, e
 * é justamente nessa hora que alguém desiste do modo isolado.
 */
export async function dockerPreflight(input: {
  readonly docker: DockerCli;
  readonly image: string;
  /** UID esperado; `undefined` no Windows, onde `process.getuid` não existe. */
  readonly expectedUid?: number;
}): Promise<DockerPreflightResult> {
  const problems: PreflightProblem[] = [];

  const version = await input.docker(["version", "--format", "{{.Server.Version}}"]);
  if (version.code !== 0) {
    return {
      daemonReachable: false,
      imagePresent: false,
      problems: [
        {
          code: "UNSUPPORTED_MODE",
          message:
            "O daemon do Docker não respondeu. Abra o Docker Desktop (ou suba o serviço) e " +
            `tente de novo. Saída do cliente: ${(version.stderr || version.stdout).trim().slice(0, 300)}`,
          fatal: true,
        },
      ],
    };
  }
  const serverVersion = version.stdout.trim();

  const inspect = await input.docker([
    "image",
    "inspect",
    input.image,
    "--format",
    "{{.Config.User}}",
  ]);
  if (inspect.code !== 0) {
    problems.push({
      code: "UNSUPPORTED_MODE",
      message:
        `A imagem ${input.image} não está nesta máquina. Construa com \`pnpm docker:build\` ` +
        "antes de rodar uma Expedição em Masmorra selada.",
      fatal: true,
    });
    return { daemonReachable: true, serverVersion, imagePresent: false, problems };
  }

  const imageUser = inspect.stdout.trim();

  // O contrato de UID/GID da imagem: arquivo escrito no bind mount sai com o
  // dono do container. Se a imagem foi construída para outro UID, o agente
  // escreve no worktree do host com dono errado — e no Linux nem escreve.
  if (input.expectedUid !== undefined && imageUser.length > 0) {
    const uidDaImagem = Number.parseInt(imageUser.split(":")[0] ?? "", 10);
    if (Number.isInteger(uidDaImagem) && uidDaImagem !== input.expectedUid) {
      problems.push({
        code: "UNSUPPORTED_MODE",
        message:
          `A imagem ${input.image} foi construída para o UID ${String(uidDaImagem)}, e este ` +
          `worker roda como UID ${String(input.expectedUid)}. Os arquivos que o agente ` +
          "escrever no worktree sairiam com o dono errado. Reconstrua com `pnpm docker:build`.",
        fatal: false,
      });
    }
  }

  return {
    daemonReachable: true,
    serverVersion,
    imagePresent: true,
    ...(imageUser.length === 0 ? {} : { imageUser }),
    problems,
  };
}

/**
 * O `terminateProcessTree` deste modo.
 *
 * Matar o cliente `docker run` no host **não** encosta no container: o processo
 * do agente é filho do daemon, não do worker. O encerramento é `docker rm -f`, e
 * o desaparecimento é confirmado por consulta — o Sandcastle engole o erro de
 * remoção e nunca confere, e é assim que um container órfão fica de pé enquanto
 * a interface diz que o Run foi cancelado (documento técnico, seção 13).
 */
export async function removeContainer(input: {
  readonly docker: DockerCli;
  readonly containerName: string;
  readonly confirmMs?: number;
  readonly pollMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}): Promise<HarnessCancelResult> {
  const now = input.now ?? (() => Date.now());
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const confirmMs = input.confirmMs ?? 10_000;
  const pollMs = input.pollMs ?? 200;
  const inicio = now();

  const remocao = await input.docker(["rm", "--force", "--volumes", input.containerName]);

  // "No such container" é sucesso: o `--rm` já tinha levado o container embora
  // quando o processo do agente saiu sozinho.
  const inexistente = /no such container/i.test(remocao.stderr);
  if (remocao.code !== 0 && inexistente) {
    return { terminated: true, method: "docker-rm", elapsedMs: now() - inicio, notRunning: true };
  }

  for (;;) {
    const existe = await containerExists(input.docker, input.containerName);
    if (!existe) {
      return { terminated: true, method: "docker-rm", elapsedMs: now() - inicio };
    }
    if (now() - inicio >= confirmMs) {
      return { terminated: false, method: "docker-rm", elapsedMs: now() - inicio };
    }
    await sleep(pollMs);
  }
}

/** O container ainda existe (rodando ou parado)? */
export async function containerExists(docker: DockerCli, name: string): Promise<boolean> {
  const resultado = await docker([
    "ps",
    "--all",
    "--filter",
    `name=^${name}$`,
    "--format",
    "{{.Names}}",
  ]);
  if (resultado.code !== 0) {
    // Não conseguir perguntar não é prova de ausência. Dizer que existe leva a
    // `terminated: false`, que é o resultado honesto (CLAUDE.md, seção 8).
    return true;
  }
  return resultado.stdout
    .split("\n")
    .map((linha) => linha.trim())
    .includes(name);
}

function describe(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
