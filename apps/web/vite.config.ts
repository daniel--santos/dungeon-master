import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/** Alvo do proxy quando nada é configurado. Precisa casar com API_HOST e API_PORT. */
const DEFAULT_API_TARGET = "http://127.0.0.1:3333";

/** A versão que o rodapé da barra lateral mostra, lida do próprio `package.json`. */
export const WEB_VERSION = (
  JSON.parse(readFileSync(resolve(import.meta.dirname, "./package.json"), "utf8")) as {
    version: string;
  }
).version;

/**
 * O config é uma função por causa do `.env`.
 *
 * O Vite injeta as variáveis de um `.env` em `import.meta.env` do bundle, e
 * nunca em `process.env` do processo que carrega este arquivo. Lendo
 * `process.env` direto, o `VITE_API_PROXY_TARGET` que o `.env.example`
 * documenta não funcionava de arquivo nenhum — só exportado à mão no shell. O
 * `loadEnv` é a leitura oficial, e o diretório é o do pacote, que é onde o
 * `.env.example` mora.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname);
  const API_TARGET = env["VITE_API_PROXY_TARGET"] ?? DEFAULT_API_TARGET;

  return {
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
    // O e2e serve a build de produção por `vite preview`, com o mesmo proxy: o
    // servidor de desenvolvimento reotimiza dependências no meio da suíte e o
    // empacotador nativo do Vite 8 morria com 0xC0000409 nesta máquina.
    preview: {
      host: "127.0.0.1",
      strictPort: true,
      proxy: {
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
  };
});
