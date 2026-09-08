import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * Testes de ponta a ponta da web.
 *
 * O banco não é o do `docker-compose`: quem sobe o PostgreSQL é
 * `e2e/run-e2e.mjs`, com `startTestPostgres`, e ele passa a `DATABASE_URL`
 * para os dois servidores daqui pelo ambiente. O `globalSetup` do Playwright
 * não serve para isso: ele roda **depois** dos `webServer`, então a API já
 * teria subido sem a variável.
 *
 * Portas próprias, longe das de desenvolvimento, para o e2e nunca falar com a
 * API ou com o banco da máquina de quem está trabalhando.
 */
const ROOT = resolve(import.meta.dirname, "../..");

const API_PORT = process.env["E2E_API_PORT"] ?? "3399";
const WEB_PORT = process.env["E2E_WEB_PORT"] ?? "5273";
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const IS_CI = process.env["CI"] === "true" || process.env["CI"] === "1";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  // Um banco só para a suíte inteira; paralelismo disputaria as mesmas linhas.
  fullyParallel: false,
  workers: 1,
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      // `tsx` e não `node dist/`: o build da API não é pré-requisito do e2e, e
      // os pacotes de que ela depende já foram construídos pelo script `e2e`.
      command: "pnpm --filter @dungeon-master/api exec tsx src/server.ts",
      cwd: ROOT,
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      env: {
        API_HOST: "127.0.0.1",
        API_PORT: API_PORT,
        NODE_ENV: "test",
        LOG_LEVEL: "warn",
      },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // `vite preview` da build feita pelo script `e2e`: sem otimizador de
      // dependências nem watcher, o servidor não morre no meio da suíte.
      command: `pnpm exec vite preview --port ${WEB_PORT} --strictPort`,
      cwd: import.meta.dirname,
      url: WEB_URL,
      env: { VITE_API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
