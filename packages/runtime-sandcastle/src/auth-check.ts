/**
 * A checagem barata de autenticação de cada CLI (planejamento v0.4, Fase 8B;
 * ADR 0001, decisão 5; ADR 0002, decisão 5).
 *
 * Cada harness tem um comando local, não interativo e sem chamada de modelo,
 * que responde se há credencial: `claude auth status` (JSON com `loggedIn`),
 * `codex login status` (código de saída), `pi auth check --provider <p> --json`
 * (JSON com `status`) e `agy models` (código de saída; o único que toca a rede,
 * em um ou dois segundos, e ainda assim sem gastar token). Medidos nesta
 * máquina em 09/09/2026: entre 200 ms e 2,6 s.
 *
 * O que sai daqui é um veredito e **um motivo sem segredo**. As funções de
 * interpretação são puras e testadas linha a linha; quem sobe o processo é o
 * `cli-adapter`, dentro do preflight, com o mesmo ambiente por allow-list do
 * Run. A saída bruta nunca entra no motivo: `claude auth status` imprime o
 * e-mail e a organização do usuário, e o motivo vai para o log e para a tela.
 *
 * `undefined` é a resposta honesta quando a CLI não respondeu, respondeu algo
 * que não dá para ler ou o comando não existe nesta versão: um `false` sem
 * prova travaria Runs que funcionariam, e é por isso que o contrato de
 * `PreflightResult` o prevê.
 */

export interface AuthDetection {
  /** `true` autenticado, `false` não, `undefined` não deu para saber. */
  readonly authenticated: boolean | undefined;
  /** Uma frase, sem segredo, dizendo o comando e o que ele respondeu. */
  readonly reason: string;
}

/** O que um comando de checagem devolveu. */
export interface AuthProbeResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** O processo foi morto pelo teto de tempo. */
  readonly timedOut?: boolean;
}

/** A porta pela qual a definição roda o comando local, já com o ambiente do Run. */
export interface AuthDetectionInput {
  readonly env: Readonly<Record<string, string>>;
  /** Roda a CLI do harness com estes argumentos. Nunca lança por código de saída. */
  run(args: readonly string[]): Promise<AuthProbeResult>;
}

export type PiAuthStatus = "ready" | "not_ready" | "unknown";

function describeExit(command: string, probe: AuthProbeResult): string {
  if (probe.timedOut === true) return `\`${command}\` não respondeu dentro do teto`;
  return `\`${command}\` saiu com código ${String(probe.code)}`;
}

function parseJsonRecord(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `claude auth status`: JSON com `loggedIn`, `authMethod` e `apiProvider`.
 *
 * Só esses três campos são lidos; o resto do JSON (e-mail, organização) é
 * descartado. A CLI responde `loggedIn: true` também quando a credencial vem
 * de `ANTHROPIC_API_KEY`, o que é exatamente o que o preflight quer saber.
 */
export function interpretClaudeAuthStatus(probe: AuthProbeResult): AuthDetection {
  const command = "claude auth status";
  if (probe.timedOut === true) {
    return { authenticated: undefined, reason: describeExit(command, probe) };
  }

  const objeto = parseJsonRecord(probe.stdout);
  if (objeto === undefined) {
    return {
      authenticated: undefined,
      reason:
        `${describeExit(command, probe)} sem JSON legível; a versão da CLI pode não ter ` +
        "o subcomando",
    };
  }
  const loggedIn = objeto["loggedIn"];
  if (typeof loggedIn !== "boolean") {
    return {
      authenticated: undefined,
      reason: `${describeExit(command, probe)} sem o campo loggedIn`,
    };
  }

  const detalhes: string[] = [];
  const metodo = objeto["authMethod"];
  if (typeof metodo === "string") detalhes.push(`authMethod=${metodo}`);
  const provedor = objeto["apiProvider"];
  if (typeof provedor === "string") detalhes.push(`apiProvider=${provedor}`);

  return {
    authenticated: loggedIn,
    reason:
      `\`${command}\` respondeu loggedIn=${String(loggedIn)}` +
      (detalhes.length === 0 ? "" : ` (${detalhes.join(", ")})`),
  };
}

/**
 * `codex login status`: sai `0` autenticado e `1` com "Not logged in" (ADR
 * 0001, seção 2). A primeira linha da saída diz o método ("Logged in using
 * ChatGPT") e não carrega segredo, mas o veredito é o código de saída.
 */
export function interpretCodexLoginStatus(probe: AuthProbeResult): AuthDetection {
  const command = "codex login status";
  if (probe.timedOut === true) {
    return { authenticated: undefined, reason: describeExit(command, probe) };
  }
  if (probe.code === 0) {
    return { authenticated: true, reason: `${describeExit(command, probe)} (autenticado)` };
  }
  if (probe.code === 1 && /not logged in/i.test(`${probe.stdout}\n${probe.stderr}`)) {
    return { authenticated: false, reason: `${describeExit(command, probe)}: "Not logged in"` };
  }
  return {
    authenticated: undefined,
    reason:
      `${describeExit(command, probe)} sem a resposta esperada; a versão da CLI pode não ` +
      "ter o subcomando",
  };
}

/**
 * `pi auth check --provider <p> --json`: `{"status":"ready"}` com código `0`,
 * ou `{"status":"not_ready","reason":"credentials_not_configured"}` com `1`
 * (ADR 0001, seção 3). A checagem é por provedor, e o Pi exige um: sem
 * `--provider` a CLI responde erro de uso (código 2, medido na 0.85.1).
 */
export function interpretPiAuthCheck(
  provider: string,
  probe: AuthProbeResult,
): AuthDetection & { readonly status: PiAuthStatus } {
  const command = `pi auth check --provider ${provider} --json`;
  if (probe.timedOut === true) {
    return { authenticated: undefined, status: "unknown", reason: describeExit(command, probe) };
  }

  const objeto = parseJsonRecord(probe.stdout);
  const status = objeto?.["status"];
  const motivo = objeto?.["reason"];

  if (probe.code === 0 && status === "ready") {
    return {
      authenticated: true,
      status: "ready",
      reason: `${describeExit(command, probe)}: ready`,
    };
  }
  if (status === "not_ready") {
    const porque = typeof motivo === "string" ? `: not_ready (${motivo})` : ": not_ready";
    return {
      authenticated: false,
      status: "not_ready",
      reason: `${describeExit(command, probe)}${porque}`,
    };
  }
  return {
    authenticated: undefined,
    status: "unknown",
    reason: `${describeExit(command, probe)} sem a resposta esperada`,
  };
}

/**
 * Junta as checagens do Pi por provedor num veredito só.
 *
 * Quando o adapter fixa o provedor (`--provider` vai no argv do Run), é uma
 * checagem só, e `not_ready` nela é prova de ausência: é esse provedor que o
 * Run vai usar. Sem provedor fixado a checagem é feita contra
 * {@link PI_AUTH_PROBE_PROVIDERS}, e aí `ready` em qualquer um prova presença,
 * mas `not_ready` em todos **não** prova ausência: o Pi usa o provedor padrão
 * que o usuário configurou, que pode ser outro — medido em 09/09/2026, sem
 * `GEMINI_API_KEY` no ambiente os três respondiam `not_ready` e a CLI rodava
 * por `opencode-go`. Um `false` sem prova viraria `Diagnostic` em todo Run que
 * funciona; a resposta honesta é "não sei".
 */
export function combinePiAuthChecks(
  checks: ReadonlyArray<{ readonly provider: string; readonly status: PiAuthStatus }>,
  options: { readonly fixedProvider?: boolean } = {},
): AuthDetection {
  const resumo = checks.map((check) => `${check.provider}=${check.status}`).join(", ");
  const reason = `\`pi auth check --json\` por provedor: ${resumo}`;
  if (checks.some((check) => check.status === "ready")) return { authenticated: true, reason };
  const todosNotReady = checks.length > 0 && checks.every((check) => check.status === "not_ready");
  if (todosNotReady && options.fixedProvider === true) return { authenticated: false, reason };
  return {
    authenticated: undefined,
    reason: todosNotReady
      ? `${reason}; o provedor padrão do Pi pode ser outro, e a checagem não o conhece`
      : reason,
  };
}

/** Os provedores sondados quando o adapter do Pi não fixa um. */
export const PI_AUTH_PROBE_PROVIDERS: readonly string[] = ["google", "anthropic", "openai"];

/**
 * `agy models`: lista os modelos com código `0` quando há sessão, e responde
 * "Please sign in to view available models" com `1` quando não há (ADR 0002,
 * seção 5). Um ou dois segundos, com rede, sem chamada de modelo.
 *
 * A armadilha do ADR: com `AGY_ADC_AUTH=1` no ambiente o host autenticado
 * também responde "Please sign in". A variável fica fora da allow-list do
 * adapter de host de propósito, e é o ambiente por allow-list que chega aqui.
 */
export function interpretAgyModels(probe: AuthProbeResult): AuthDetection {
  const command = "agy models";
  if (probe.timedOut === true) {
    return { authenticated: undefined, reason: describeExit(command, probe) };
  }
  if (probe.code === 0) {
    return { authenticated: true, reason: `${describeExit(command, probe)} (listou os modelos)` };
  }
  if (
    /sign in|not (?:logged in|authenticated|signed in)/i.test(`${probe.stdout}\n${probe.stderr}`)
  ) {
    return { authenticated: false, reason: `${describeExit(command, probe)}: "Please sign in"` };
  }
  return {
    authenticated: undefined,
    reason: `${describeExit(command, probe)} sem a resposta esperada (rede ou cota?)`,
  };
}
