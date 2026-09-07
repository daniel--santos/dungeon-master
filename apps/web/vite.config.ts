import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Alvo do proxy de desenvolvimento. Precisa casar com API_HOST e API_PORT. */
const API_TARGET = process.env["VITE_API_PROXY_TARGET"] ?? "http://127.0.0.1:3333";

/** A versão que o rodapé da barra lateral mostra, lida do próprio `package.json`. */
export const WEB_VERSION = (
  JSON.parse(readFileSync(resolve(import.meta.dirname, "./package.json"), "utf8")) as {
    version: string;
  }
).version;

export default defineConfig({
  plugins: [
    // Precisa vir antes do plugin do React: ele gera `src/routeTree.gen.ts`.
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  define: {
    __WEB_VERSION__: JSON.stringify(WEB_VERSION),
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      // A web fala com a API por caminho relativo; o proxy evita CORS em dev.
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
