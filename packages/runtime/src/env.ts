/**
 * Montagem do ambiente do agente, por allow-list.
 *
 * Nada de `{ ...process.env }`. O worker roda com as credenciais do usuário —
 * chaves de nuvem, tokens de repositório, segredos de banco — e um agente sem
 * isolamento herda tudo que o processo pai tiver. A allow-list inverte o
 * padrão: nada passa a menos que alguém tenha dito que passa.
 *
 * O ambiente sai de três lugares, nesta ordem de precedência crescente:
 *
 * 1. o piso do sistema operacional (`essentialEnvKeys`), sem o qual quase
 *    nenhum processo sobe;
 * 2. as chaves que o adapter declara precisar (`HOME`, `APPDATA`, `CODEX_HOME`),
 *    que são onde as CLIs guardam credencial;
 * 3. a `environmentPolicy` do ExecutionProfile: a allow-list do usuário e as
 *    variáveis que ele injeta de propósito.
 *
 * O Sandcastle resolve o mesmo problema lendo `<repo>/.sandcastle/.env`
 * (documento técnico, seção 14). Aqui a política vem do Loadout e o arquivo no
 * repositório não participa — um repositório clonado não deve conseguir
 * declarar o que vaza para dentro do agente.
 */

import { buildEnv, essentialEnvKeys } from "@dungeon-master/platform";

import type { RuntimeEnvironmentPolicy } from "./types.js";

export interface BuildExecutionEnvOptions {
  readonly policy?: RuntimeEnvironmentPolicy;
  /** Chaves que o adapter precisa para achar credencial e configuração. */
  readonly adapterKeys?: readonly string[];
  /** Variáveis que o runtime injeta (nunca sobrescritas pela allow-list). */
  readonly runtimeVariables?: Readonly<Record<string, string>>;
  /** Origem das variáveis. Padrão: `process.env`. Existe para teste. */
  readonly source?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
}

/**
 * Monta o ambiente final do processo do agente.
 *
 * A política ganha do adapter na mesma chave, e as variáveis explícitas ganham
 * de tudo — inclusive das do runtime, para que um Loadout consiga, por exemplo,
 * apontar `CODEX_HOME` para outro lugar.
 */
export function buildExecutionEnv(options: BuildExecutionEnvOptions = {}): Record<string, string> {
  const policy = options.policy;
  const inheritEssential = policy?.inheritEssential ?? true;
  const platform = options.platform ?? process.platform;

  const allowList = [
    ...(inheritEssential ? essentialEnvKeys(platform) : []),
    ...(inheritEssential ? (options.adapterKeys ?? []) : []),
    ...(policy?.allowList ?? []),
  ];

  const extra = {
    ...(options.runtimeVariables ?? {}),
    ...(policy?.variables ?? {}),
  };

  return buildEnv(allowList, extra, options.source ?? process.env);
}

/**
 * As chaves de git que precisam atravessar para o `git` do `WorkspaceManager`.
 *
 * `GIT_CONFIG_GLOBAL` está na lista porque é ele que o isolamento de gitconfig
 * dos testes usa; sem passar, cada `git worktree add` de teste voltaria a
 * disputar o `.gitconfig.lock` global da máquina. `GIT_TERMINAL_PROMPT=0` é
 * injetado sempre: um `git` que abre prompt num worker sem terminal trava para
 * sempre em vez de falhar.
 */
export const GIT_ENV_KEYS: readonly string[] = [
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_ASKPASS",
  "SSH_AUTH_SOCK",
  "GIT_EXEC_PATH",
  "GIT_TEMPLATE_DIR",
];

/** Ambiente para os comandos `git` do runtime. */
export function buildGitEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return buildEnv([...essentialEnvKeys(), ...GIT_ENV_KEYS], { GIT_TERMINAL_PROMPT: "0" }, source);
}

/**
 * As chaves sem as quais o `git` **do agente** não acha configuração nem identidade.
 *
 * O runtime entrega ao agente um worktree e uma allow-list que inclui
 * `git commit`. Um `git commit` sem `user.email` não commita: ele falha com
 * "Author identity unknown", e o Run segue sem commit nenhum. A identidade mora
 * no gitconfig global, e achar o gitconfig global depende de `HOME`/
 * `USERPROFILE` ou de `GIT_CONFIG_GLOBAL` — nada disso está no piso do sistema
 * operacional no Windows, onde `essentialEnvKeys` só entrega `PATH`, `TEMP` e
 * companhia.
 *
 * Foi assim que o CI do Windows quebrou e o do macOS não: no macOS `HOME` está
 * no piso, no Windows não está, e a máquina do desenvolvedor escondia a falha
 * porque o Git for Windows encontra `C:\Users\<você>\.gitconfig` pelo perfil do
 * Windows mesmo sem variável nenhuma. O runner não tem esse arquivo.
 *
 * **Chave de credencial não entra aqui.** `SSH_AUTH_SOCK`, `GIT_ASKPASS` e
 * `GIT_SSH_COMMAND` estão em `GIT_ENV_KEYS`, que é o ambiente do git *nosso*,
 * e ficam de fora do ambiente do agente de propósito: elas autenticam contra
 * remoto, e a lista de comandos confiáveis não inclui `git push`. Entregar a
 * chave junto seria conceder por ambiente o que a política nega por comando.
 */
export const AGENT_GIT_ENV_KEYS: readonly string[] = [
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "XDG_CONFIG_HOME",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM",
];
