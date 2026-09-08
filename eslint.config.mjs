// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Fronteiras entre pacotes (planejamento v0.4, seção 5).
 *
 * - `apps/web` importa somente `@dungeon-master/api-client`, `@dungeon-master/glossary`
 *   e tipos de `@dungeon-master/contracts`. Nenhum pacote interno de backend.
 *   O glossário é a exceção declarada e não abre precedente: é um pacote puro
 *   de labels da interface, sem banco, rede nem Node, e a seção 47.1 do
 *   documento técnico manda que a UI o consuma direto — é de lá que sai todo
 *   label de entidade que a web renderiza.
 * - `packages/domain` não importa infraestrutura: banco, ORM, HTTP, logger,
 *   runtime de agente ou builtins do Node.
 * - `packages/glossary` e `packages/achievements` são puros: só `zod` e
 *   `node:*` (para ler os próprios arquivos de catálogo). Sem banco, sem rede,
 *   sem outro pacote do workspace.
 * - `packages/platform` importa somente builtins do Node e módulos do próprio
 *   pacote. É a casa do código que depende do sistema operacional.
 *
 * A regra é `@typescript-eslint/no-restricted-imports` porque só ela distingue
 * `import type` de import de valor (`allowTypeImports`).
 */

const WEB_BOUNDARY_MESSAGE =
  "Fronteira: apps/web importa somente @dungeon-master/api-client, @dungeon-master/glossary e tipos de @dungeon-master/contracts.";

const DOMAIN_BOUNDARY_MESSAGE =
  "Fronteira: packages/domain não importa infraestrutura (banco, ORM, HTTP, logger, runtime, builtins do Node).";

const PURE_BOUNDARY_MESSAGE =
  "Fronteira: glossary e achievements são puros e só importam zod e node:*.";

const PLATFORM_BOUNDARY_MESSAGE =
  "Fronteira: packages/platform importa somente builtins do Node (node:*) e módulos do próprio pacote.";

const RUNTIME_BOUNDARY_MESSAGE =
  "Fronteira: os pacotes de runtime não importam banco, ORM, HTTP nem logger; o store entra por injeção de contrato.";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/.vite/**",
      "packages/api-client/src/schema.d.ts",
      "packages/database/drizzle/**",
      "apps/web/src/routeTree.gen.ts",
      "docs/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },

  // Os scripts de linha de comando podem escrever no stdout.
  {
    files: ["**/scripts/**/*.{ts,mts,mjs,js}", "**/*.config.{ts,mts,mjs,js}", "eslint.config.mjs"],
    rules: {
      "no-console": "off",
    },
  },

  // ---------------------------------------------------------------- apps/web
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@dungeon-master/*",
                "!@dungeon-master/api-client",
                "!@dungeon-master/api-client/*",
                "!@dungeon-master/contracts",
                "!@dungeon-master/glossary",
              ],
              message: WEB_BOUNDARY_MESSAGE,
            },
            {
              group: ["@dungeon-master/contracts"],
              allowTypeImports: true,
              message: `${WEB_BOUNDARY_MESSAGE} De contracts, apenas 'import type'.`,
            },
            {
              group: ["**/packages/**", "**/apps/api/**", "**/apps/worker/**", "../../../*"],
              message: WEB_BOUNDARY_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  // ----------------------------------------------------------- packages/domain
  {
    files: ["packages/domain/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@dungeon-master/database",
                "@dungeon-master/database/*",
                "@dungeon-master/platform",
                "@dungeon-master/platform/*",
                "@dungeon-master/api-client",
                "@dungeon-master/api-client/*",
                "drizzle-orm",
                "drizzle-orm/*",
                "drizzle-kit",
                "pg",
                "pg-*",
                "postgres",
                "embedded-postgres",
                "hono",
                "hono/*",
                "@hono/*",
                "pino",
                "pino/*",
                "sandcastle",
                "sandcastle/*",
                "node:*",
                "**/packages/database/**",
                "**/packages/platform/**",
                "**/apps/**",
              ],
              message: DOMAIN_BOUNDARY_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  // ------------------------------- packages/glossary e packages/achievements
  // Lista de permissão, não de bloqueio: de pacote externo, só `zod` e
  // `node:*`. Os dois pacotes são dados e funções puras, e o único I/O é ler os
  // próprios arquivos de catálogo. A primeira regra recusa todo especificador
  // que não seja relativo, `node:*` ou `zod`; a segunda impede que um import
  // relativo escape do pacote.
  {
    files: ["packages/glossary/src/**/*.ts", "packages/achievements/src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!\\.\\.?/|node:|zod$)",
              message: PURE_BOUNDARY_MESSAGE,
            },
            {
              group: ["../../*", "**/packages/**", "**/apps/**"],
              message: PURE_BOUNDARY_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  // --------------------------------------------------------- packages/platform
  //
  // O pacote é a casa de todo código que depende do sistema operacional, e a
  // única forma de ele continuar sendo isso é não podendo importar mais nada:
  // só builtins do Node e módulos do próprio pacote. Sem dependência de
  // terceiro, sem pacote do workspace, sem atravessar para `apps/`.
  //
  // `regex` e não `group`: a sintaxe de `group` é a do gitignore, onde `*` e
  // `**` já pegam o caminho relativo inteiro e as negações não conseguem
  // devolvê-lo. Com regex a regra fica literal: passa `node:` e passa `./`.
  {
    files: ["packages/platform/src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!node:|\\./)",
              message: PLATFORM_BOUNDARY_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  // ------------------------------- packages/runtime, sandcastle e antigravity
  //
  // O runtime executa e garante término; ele não persiste nada. O store, o
  // writer de evento e o relógio entram por injeção de contrato (planejamento
  // v0.4, seção 5). Sem a regra, a primeira necessidade de "só gravar um
  // eventinho aqui" amarraria o runtime ao Drizzle e a suíte de contrato
  // passaria a precisar de banco para rodar.
  //
  // `regex` e não `group`: a sintaxe de `group` é a do gitignore, onde `**`
  // casa o caminho relativo inteiro e as negações não o devolvem.
  {
    files: [
      "packages/runtime/src/**/*.ts",
      "packages/runtime-sandcastle/src/**/*.ts",
      "packages/runtime-antigravity/src/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex:
                "^(@dungeon-master/(database|api-client|events)|drizzle-orm|drizzle-kit|pg|postgres|embedded-postgres|hono|@hono/.*|pino)($|/)",
              message: RUNTIME_BOUNDARY_MESSAGE,
            },
            {
              group: ["**/packages/database/**", "**/apps/**"],
              message: RUNTIME_BOUNDARY_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  // Testes podem usar utilitários que a fronteira proíbe no código de produção.
  // `e2e/` entra na lista porque o Playwright sobe o PostgreSQL de teste por
  // `@dungeon-master/database/testing`, que é código de teste, não da web.
  {
    files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "**/test/**/*.ts", "**/e2e/**/*.{ts,mjs}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": "off",
      "no-console": "off",
    },
  },
);
