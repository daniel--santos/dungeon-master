import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { WEB_VERSION } from "./vite.config.ts";

/**
 * Testes de componente e de hook da web.
 *
 * Sem o plugin do TanStack Router de propósito: ele reescreveria
 * `src/routeTree.gen.ts` a cada rodada, e o CI falha com a árvore de trabalho
 * suja. Os testes montam componentes, não a aplicação inteira.
 *
 * Os testes de ponta a ponta ficam em `e2e/` e são do Playwright.
 */
export default defineConfig({
  plugins: [react()],
  define: {
    __WEB_VERSION__: JSON.stringify(WEB_VERSION),
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    globals: false,
    restoreMocks: true,
    setupFiles: ["src/test-setup.ts"],
    // Ver src/test-setup.ts: runners do CI são lentos para jsdom + Radix.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
