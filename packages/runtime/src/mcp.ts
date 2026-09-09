/**
 * Servidores MCP oferecidos ao agente (planejamento v0.4, Fase 7).
 *
 * O `ExecutionRequest` chega com uma lista de servidores já resolvida pelo
 * Worker — o do Grimório e os do Loadout — e cada adapter a traduz para o que
 * a CLI dele aceita: `--mcp-config` no Claude Code, `-c mcp_servers.*` no
 * Codex. Um adapter cuja CLI não sabe subir servidor MCP em modo headless
 * declara `mcpServers: false` na matriz, e o runtime avisa e segue sem as
 * ferramentas — nunca falha o Run por isso.
 *
 * Três regras valem para toda tradução:
 *
 * 1. **Segredo nunca no argv.** Um servidor declara em `envKeys` os **nomes**
 *    das variáveis que precisa; o runtime as põe na allow-list do ambiente do
 *    harness, e é o harness quem as repassa ao processo do servidor (o Claude
 *    Code herda o ambiente inteiro; o Codex recebe a lista em `env_vars`).
 *    O valor nunca aparece em linha de comando nem em arquivo. A URL de um
 *    servidor `HTTP` é a exceção que precisa de guarda, porque ela **é** argv:
 *    veja {@link mcpUrlExposure} e {@link McpHttpServerSpec.url}.
 * 2. **Comando em array, nunca string de shell.** `command` e `args` viajam
 *    separados e chegam à CLI como JSON ou TOML, sem concatenação.
 * 3. **O container tem o seu próprio comando.** Um servidor que roda no host
 *    com `process.execPath` e um caminho do Windows não existe dentro da
 *    imagem; `container` diz como subi-lo lá dentro, com o arquivo montado
 *    read-only e as variáveis reescritas para o endereço que o container
 *    alcança.
 */

import type { DockerMount } from "./docker.js";

/** Nome de servidor aceito pelas quatro CLIs e pelos nomes `mcp__<servidor>__<tool>`. */
const SERVER_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export function isValidMcpServerName(name: string): boolean {
  return SERVER_NAME_PATTERN.test(name);
}

/** Como subir o mesmo servidor dentro do container do modo `DOCKER`. */
export interface McpContainerLaunch {
  /** Executável de dentro da imagem (`node`). */
  readonly command: string;
  readonly args: readonly string[];
  /** Arquivos do host que o servidor precisa lá dentro. Read-only por padrão. */
  readonly mounts?: readonly DockerMount[];
  /**
   * Variáveis reescritas para o container, pelo **nome**: o valor entra no
   * ambiente do processo cliente do Docker, e o argv leva só `-e NOME`.
   *
   * Existe para o endereço do banco: `127.0.0.1` no host é
   * `host.docker.internal` de dentro do container, e o valor continua sendo
   * segredo — por isso não é `fixedEnv`, que escreve o valor no argv.
   */
  readonly env?: Readonly<Record<string, string>>;
}

export interface McpStdioServerSpec {
  readonly name: string;
  readonly transport: "STDIO";
  readonly command: string;
  readonly args: readonly string[];
  /**
   * Nomes de variáveis do ambiente do worker que o servidor precisa enxergar.
   *
   * Entram na allow-list do ambiente do harness e, nas CLIs que não herdam o
   * ambiente para servidores MCP (Codex), na lista de nomes a repassar. As
   * chaves de {@link env} contam como declaradas aqui também.
   */
  readonly envKeys?: readonly string[];
  /**
   * Variáveis que o **runtime** injeta no ambiente do processo do harness,
   * com valor — nunca no argv, nunca na configuração que vai para a CLI.
   *
   * Existe para o Worker entregar `DATABASE_URL` mesmo quando ele mesmo a
   * resolveu por padrão e ela não está em `process.env`: a URL do banco é
   * dado do Worker, e não do ambiente de quem o subiu.
   */
  readonly env?: Readonly<Record<string, string>>;
  readonly container?: McpContainerLaunch;
  /**
   * As ferramentas que o servidor expõe, quando conhecidas.
   *
   * Um adapter com allow-list por ferramenta (Claude Code) libera exatamente
   * estas; sem a lista, libera o servidor inteiro.
   */
  readonly tools?: readonly string[];
  /** Uma linha acrescentada ao prompt dizendo o que o servidor oferece. */
  readonly instruction?: string;
}

export interface McpHttpServerSpec {
  readonly name: string;
  readonly transport: "HTTP";
  /**
   * Endereço do servidor. **Vai inteiro para a linha de comando do harness**
   * (`--mcp-config` no Claude Code, `-c mcp_servers.<nome>.url` no Codex), e a
   * linha de comando de um processo é legível por qualquer processo da máquina.
   * Uma URL com `usuário:senha@` é recusada pelo runtime; um token na query
   * segue, com aviso, porque não há como distingui-lo de um parâmetro comum.
   */
  readonly url: string;
  readonly tools?: readonly string[];
  readonly instruction?: string;
}

/** O que a URL de um servidor `HTTP` deixaria visível na linha de comando. */
export type McpUrlExposure =
  /** Credencial embutida (`https://token@host/`). O runtime recusa o servidor. */
  | "USERINFO"
  /** Query, que pode ou não carregar token. O runtime avisa e segue. */
  | "QUERY";

/**
 * Olha a URL de um servidor `HTTP` procurando o que não deveria virar argv.
 *
 * A regra 1 do cabeçalho deste arquivo — segredo nunca no argv — valia para o
 * `STDIO`, que separa nomes de variáveis do valor, e não valia para o `HTTP`,
 * cuja forma usual de autenticar sem cabeçalho é justamente pôr o token na URL.
 * Uma URL ilegível devolve `undefined`: quem recusa URL malformada é o Worker,
 * na hora de montar a lista.
 */
export function mcpUrlExposure(url: string): McpUrlExposure | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.username !== "" || parsed.password !== "") return "USERINFO";
  if (parsed.search !== "") return "QUERY";
  return undefined;
}

export type McpServerSpec = McpStdioServerSpec | McpHttpServerSpec;

/** As chaves de ambiente que os servidores pedem, sem repetição. */
export function mcpEnvKeys(servers: readonly McpServerSpec[] | undefined): readonly string[] {
  const keys = new Set<string>();
  for (const server of servers ?? []) {
    if (server.transport !== "STDIO") continue;
    for (const key of server.envKeys ?? []) keys.add(key);
    for (const key of Object.keys(server.env ?? {})) keys.add(key);
  }
  return [...keys];
}

/** As variáveis com valor que o runtime injeta no ambiente do harness. */
export function mcpEnv(servers: readonly McpServerSpec[] | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const server of servers ?? []) {
    if (server.transport !== "STDIO") continue;
    Object.assign(env, server.env ?? {});
  }
  return env;
}

/**
 * Acrescenta ao prompt as linhas de instrução dos servidores.
 *
 * Depois de tudo o que o Worker montou e antes da instrução de resultado
 * estruturado, que o runtime põe por último. Texto fixo por Run, para o
 * prefixo do prompt continuar cacheável entre execuções (documento técnico,
 * seção 20.1).
 */
export function applyMcpInstruction(
  prompt: string,
  servers: readonly McpServerSpec[] | undefined,
): string {
  const linhas = (servers ?? [])
    .map((server) => server.instruction?.trim() ?? "")
    .filter((linha) => linha.length > 0);
  if (linhas.length === 0) return prompt;
  return `${prompt}\n\n${linhas.join("\n")}`;
}

/**
 * Reescreve a lista para o que vale dentro do container.
 *
 * Um servidor `STDIO` com `container` troca comando e argumentos pelos de lá;
 * um sem `container` é repassado como está — o comando precisa existir na
 * imagem, e o adapter avisa. Os de `HTTP` não mudam: uma URL é a mesma dos
 * dois lados, exceto `localhost`, que é problema de quem a escreveu.
 */
export function mcpServersForContainer(
  servers: readonly McpServerSpec[],
): readonly McpServerSpec[] {
  return servers.map((server) => {
    if (server.transport !== "STDIO" || server.container === undefined) return server;
    const { container: _container, ...rest } = server;
    return { ...rest, command: server.container.command, args: server.container.args };
  });
}

/** Os servidores `STDIO` que, no modo `DOCKER`, dependem do comando existir na imagem. */
export function mcpServersWithoutContainerLaunch(
  servers: readonly McpServerSpec[],
): readonly McpStdioServerSpec[] {
  return servers.filter(
    (server): server is McpStdioServerSpec =>
      server.transport === "STDIO" && server.container === undefined,
  );
}
