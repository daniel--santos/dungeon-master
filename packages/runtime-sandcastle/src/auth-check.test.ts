import { describe, expect, it } from "vitest";

import {
  combinePiAuthChecks,
  interpretAgyModels,
  interpretClaudeAuthStatus,
  interpretCodexLoginStatus,
  interpretPiAuthCheck,
} from "./auth-check.js";

/**
 * As interpretações são puras: cada uma recebe o que a CLI respondeu — saída
 * medida nesta máquina em 09/09/2026 e nos ADRs 0001 e 0002 — e devolve o
 * veredito com o motivo. O motivo nunca repete a saída bruta: o JSON do
 * `claude auth status` traz o e-mail e a organização do usuário.
 */

const CLAUDE_LOGADO = JSON.stringify({
  loggedIn: true,
  authMethod: "claude.ai",
  apiProvider: "firstParty",
  email: "alguem@example.com",
  orgId: "6057ce0a-0000-0000-0000-000000000000",
  orgName: "Organização de alguém",
  subscriptionType: "max",
});

describe("interpretClaudeAuthStatus", () => {
  it("lê loggedIn e só os campos sem segredo", () => {
    const veredito = interpretClaudeAuthStatus({ code: 0, stdout: CLAUDE_LOGADO, stderr: "" });
    expect(veredito.authenticated).toBe(true);
    expect(veredito.reason).toBe(
      "`claude auth status` respondeu loggedIn=true (authMethod=claude.ai, apiProvider=firstParty)",
    );
    expect(veredito.reason).not.toContain("example.com");
    expect(veredito.reason).not.toContain("Organização");
  });

  it("loggedIn=false é não autenticado", () => {
    const veredito = interpretClaudeAuthStatus({
      code: 1,
      stdout: JSON.stringify({ loggedIn: false }),
      stderr: "",
    });
    expect(veredito).toEqual({
      authenticated: false,
      reason: "`claude auth status` respondeu loggedIn=false",
    });
  });

  it("sem JSON, timeout ou sem o campo, não sabe dizer", () => {
    expect(
      interpretClaudeAuthStatus({ code: 1, stdout: "", stderr: "unknown command" }).authenticated,
    ).toBeUndefined();
    expect(
      interpretClaudeAuthStatus({ code: null, stdout: "", stderr: "", timedOut: true }),
    ).toEqual({
      authenticated: undefined,
      reason: "`claude auth status` não respondeu dentro do teto",
    });
    expect(
      interpretClaudeAuthStatus({ code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" })
        .authenticated,
    ).toBeUndefined();
  });
});

describe("interpretCodexLoginStatus", () => {
  it("código 0 é autenticado; 1 com Not logged in é não autenticado", () => {
    expect(
      interpretCodexLoginStatus({ code: 0, stdout: "Logged in using ChatGPT\n", stderr: "" }),
    ).toEqual({
      authenticated: true,
      reason: "`codex login status` saiu com código 0 (autenticado)",
    });
    expect(interpretCodexLoginStatus({ code: 1, stdout: "", stderr: "Not logged in\n" })).toEqual({
      authenticated: false,
      reason: '`codex login status` saiu com código 1: "Not logged in"',
    });
  });

  it("outro código ou timeout não sabe dizer", () => {
    expect(
      interpretCodexLoginStatus({ code: 2, stdout: "", stderr: "unexpected argument" })
        .authenticated,
    ).toBeUndefined();
    expect(
      interpretCodexLoginStatus({ code: null, stdout: "", stderr: "", timedOut: true })
        .authenticated,
    ).toBeUndefined();
  });
});

describe("interpretPiAuthCheck e combinePiAuthChecks", () => {
  it("ready e not_ready, com o provedor e o motivo do Pi", () => {
    expect(
      interpretPiAuthCheck("google", {
        code: 0,
        stdout: '{"status":"ready","provider":"google","authType":"api_key"}',
        stderr: "",
      }),
    ).toEqual({
      authenticated: true,
      status: "ready",
      reason: "`pi auth check --provider google --json` saiu com código 0: ready",
    });
    expect(
      interpretPiAuthCheck("openai", {
        code: 1,
        stdout: '{"status":"not_ready","provider":"openai","reason":"credentials_not_configured"}',
        stderr: "",
      }),
    ).toEqual({
      authenticated: false,
      status: "not_ready",
      reason:
        "`pi auth check --provider openai --json` saiu com código 1: not_ready (credentials_not_configured)",
    });
    expect(
      interpretPiAuthCheck("google", { code: 2, stdout: "", stderr: "Error: Auth checks require" })
        .status,
    ).toBe("unknown");
  });

  it("um provedor pronto basta; todos not_ready só é não com o provedor fixado; unknown é não sei", () => {
    expect(
      combinePiAuthChecks([
        { provider: "google", status: "not_ready" },
        { provider: "anthropic", status: "ready" },
      ]),
    ).toEqual({
      authenticated: true,
      reason: "`pi auth check --json` por provedor: google=not_ready, anthropic=ready",
    });
    // Sondando a lista curta, `not_ready` em todos não prova ausência: o
    // provedor padrão do Pi pode ser outro (medido: a CLI rodou por
    // `opencode-go` com os três `not_ready`).
    expect(
      combinePiAuthChecks([
        { provider: "google", status: "not_ready" },
        { provider: "openai", status: "not_ready" },
      ]),
    ).toEqual({
      authenticated: undefined,
      reason:
        "`pi auth check --json` por provedor: google=not_ready, openai=not_ready; o provedor " +
        "padrão do Pi pode ser outro, e a checagem não o conhece",
    });
    // Com o provedor fixado no adapter, é esse que o Run usa: `not_ready` é não.
    expect(
      combinePiAuthChecks([{ provider: "google", status: "not_ready" }], { fixedProvider: true })
        .authenticated,
    ).toBe(false);
    expect(
      combinePiAuthChecks([
        { provider: "google", status: "not_ready" },
        { provider: "openai", status: "unknown" },
      ]).authenticated,
    ).toBeUndefined();
    expect(combinePiAuthChecks([]).authenticated).toBeUndefined();
  });
});

describe("interpretAgyModels", () => {
  it("lista com código 0 é autenticado; Please sign in é não", () => {
    expect(
      interpretAgyModels({
        code: 0,
        stdout: "Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\n",
        stderr: "",
      }),
    ).toEqual({
      authenticated: true,
      reason: "`agy models` saiu com código 0 (listou os modelos)",
    });
    expect(
      interpretAgyModels({
        code: 1,
        stdout: "Fetching available models...\n",
        stderr:
          "Error: Please sign in to view available models. Launch the CLI without arguments to sign in.\n",
      }),
    ).toEqual({ authenticated: false, reason: '`agy models` saiu com código 1: "Please sign in"' });
  });

  it("falha de rede ou timeout não sabe dizer", () => {
    expect(
      interpretAgyModels({ code: 1, stdout: "", stderr: "Error: dial tcp: i/o timeout" })
        .authenticated,
    ).toBeUndefined();
    expect(
      interpretAgyModels({ code: null, stdout: "", stderr: "", timedOut: true }).authenticated,
    ).toBeUndefined();
  });
});
