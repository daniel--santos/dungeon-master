import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import viteConfig from "../vite.config";

/**
 * O alvo do proxy de desenvolvimento vem do `.env`.
 *
 * `apps/web/.env.example` documenta `VITE_API_PROXY_TARGET`, e a única forma de
 * o Vite ler um arquivo `.env` dentro do próprio config é `loadEnv`: ele
 * preenche `import.meta.env` do bundle, nunca `process.env` do processo que
 * carrega o config.
 *
 * O arquivo de sondagem é `.env.probe.local` — coberto pelo `.env.*.local` do
 * `.gitignore` e lido só no modo `probe`, que nenhum comando do projeto usa.
 */

const ENV_FILE = resolve(import.meta.dirname, "../.env.probe.local");

interface ProxyTarget {
  readonly server?: { readonly proxy?: Record<string, { readonly target?: string }> };
  readonly preview?: { readonly proxy?: Record<string, { readonly target?: string }> };
}

async function resolveConfig(mode: string): Promise<ProxyTarget> {
  const config = viteConfig as unknown;
  if (typeof config !== "function") return config as ProxyTarget;
  return (await (config as (env: { mode: string; command: string }) => Promise<ProxyTarget>)({
    mode,
    command: "serve",
  })) as ProxyTarget;
}

afterEach(() => {
  rmSync(ENV_FILE, { force: true });
});

describe("proxy de desenvolvimento", () => {
  it("lê o alvo do `.env` do pacote, como o .env.example promete", async () => {
    writeFileSync(ENV_FILE, "VITE_API_PROXY_TARGET=http://127.0.0.1:9999\n", "utf8");

    const config = await resolveConfig("probe");

    expect(config.server?.proxy?.["/api"]?.target).toBe("http://127.0.0.1:9999");
    // O `vite preview`, que é o que o e2e usa, precisa do mesmo alvo.
    expect(config.preview?.proxy?.["/api"]?.target).toBe("http://127.0.0.1:9999");
  });

  it("sem `.env`, cai no alvo padrão da API", async () => {
    const config = await resolveConfig("probe");

    expect(config.server?.proxy?.["/api"]?.target).toBe("http://127.0.0.1:3333");
  });
});
