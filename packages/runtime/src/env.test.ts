import { describe, expect, it } from "vitest";

import { AGENT_GIT_ENV_KEYS, buildExecutionEnv, buildGitEnv, GIT_ENV_KEYS } from "./env.js";

const SOURCE: NodeJS.ProcessEnv = {
  PATH: "/usr/bin",
  HOME: "/home/dm",
  AWS_SECRET_ACCESS_KEY: "não deveria vazar",
  ANTHROPIC_API_KEY: "chave",
  PROXY_URL: "http://proxy",
};

describe("buildExecutionEnv", () => {
  it("nada passa sem estar na allow-list", () => {
    const env = buildExecutionEnv({
      policy: { inheritEssential: false },
      source: SOURCE,
      platform: "darwin",
    });

    expect(env).toEqual({});
  });

  it("o piso do SO e as chaves do adapter passam por padrão", () => {
    const env = buildExecutionEnv({
      adapterKeys: ["ANTHROPIC_API_KEY"],
      source: SOURCE,
      platform: "darwin",
    });

    expect(env["PATH"]).toBe("/usr/bin");
    expect(env["HOME"]).toBe("/home/dm");
    expect(env["ANTHROPIC_API_KEY"]).toBe("chave");
    // O segredo do worker não é do agente. É a razão de existir da allow-list.
    expect(env["AWS_SECRET_ACCESS_KEY"]).toBeUndefined();
  });

  it("a allow-list da política soma, e as variáveis dela ganham", () => {
    const env = buildExecutionEnv({
      policy: { allowList: ["PROXY_URL"], variables: { PROXY_URL: "http://outro" } },
      source: SOURCE,
      platform: "darwin",
    });

    expect(env["PROXY_URL"]).toBe("http://outro");
  });

  it("as variáveis do runtime entram e a política pode sobrescrevê-las", () => {
    const env = buildExecutionEnv({
      runtimeVariables: { CODEX_HOME: "/padrao" },
      policy: { variables: { CODEX_HOME: "/do-loadout" } },
      source: SOURCE,
      platform: "darwin",
    });

    expect(env["CODEX_HOME"]).toBe("/do-loadout");
  });

  it("desligar o piso descarta também as chaves do adapter", () => {
    const env = buildExecutionEnv({
      policy: { inheritEssential: false, allowList: ["PROXY_URL"] },
      adapterKeys: ["ANTHROPIC_API_KEY"],
      source: SOURCE,
      platform: "darwin",
    });

    expect(env).toEqual({ PROXY_URL: "http://proxy" });
  });
});

describe("buildGitEnv", () => {
  it("passa o gitconfig isolado e desliga o prompt do terminal", () => {
    const env = buildGitEnv({
      PATH: "/usr/bin",
      GIT_CONFIG_GLOBAL: "/tmp/worker/.gitconfig",
      GIT_TERMINAL_PROMPT: "1",
      SEGREDO: "não",
    });

    expect(env["GIT_CONFIG_GLOBAL"]).toBe("/tmp/worker/.gitconfig");
    // Um `git` que abre prompt num worker sem terminal trava para sempre em
    // vez de falhar.
    expect(env["GIT_TERMINAL_PROMPT"]).toBe("0");
    expect(env["SEGREDO"]).toBeUndefined();
  });

  it("a lista de chaves de git inclui o isolamento usado nos testes", () => {
    expect(GIT_ENV_KEYS).toContain("GIT_CONFIG_GLOBAL");
  });
});

describe("AGENT_GIT_ENV_KEYS", () => {
  it("leva ao agente como achar o gitconfig, no Windows inclusive", () => {
    const env = buildExecutionEnv({
      adapterKeys: [...AGENT_GIT_ENV_KEYS],
      source: {
        PATH: "C:\\bin",
        USERPROFILE: "C:\\Users\\dm",
        GIT_CONFIG_GLOBAL: "C:\\tmp\\.gitconfig",
      },
      platform: "win32",
    });

    // No Windows o piso do SO não tem `HOME`, e sem uma destas o `git commit`
    // do agente falha com "Author identity unknown".
    expect(env["USERPROFILE"]).toBe("C:\\Users\\dm");
    expect(env["GIT_CONFIG_GLOBAL"]).toBe("C:\\tmp\\.gitconfig");
  });

  it("não leva junto a credencial de acesso a remoto", () => {
    // A lista de comandos confiáveis não inclui `git push`. Entregar a chave
    // do agente SSH pelo ambiente concederia por outra porta o que a política
    // nega por comando.
    for (const chave of ["SSH_AUTH_SOCK", "GIT_ASKPASS", "GIT_SSH_COMMAND", "GIT_SSH"]) {
      expect(AGENT_GIT_ENV_KEYS).not.toContain(chave);
    }
  });
});
