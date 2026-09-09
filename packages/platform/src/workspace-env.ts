/**
 * Descoberta da raiz do monorepo e da ordem dos arquivos `.env`.
 *
 * O pacote continua importando só builtins do Node: o `dotenv` **entra por
 * injeção** (`loadWorkspaceEnv` recebe a função de carga), como o resto da
 * infraestrutura neste repositório. Quem chama é o módulo de bootstrap de cada
 * ponto de entrada, que é quem já depende do `dotenv`.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * O arquivo que marca a raiz do monorepo. É o único que existe na raiz e em
 * lugar nenhum abaixo dela, e o pnpm falha sem ele — não dá para o repositório
 * existir sem esse marcador.
 */
export const WORKSPACE_ROOT_MARKER = "pnpm-workspace.yaml";

/** O nome do arquivo de ambiente procurado em cada nível. */
export const ENV_FILE_NAME = ".env";

/** Assinatura mínima do `config` do `dotenv`, para injetá-lo sem importá-lo. */
export type DotenvConfig = (options: { path: string[]; processEnv?: NodeJS.ProcessEnv }) => unknown;

export interface LoadWorkspaceEnvOptions {
  /** De onde começar a subir. Padrão: `process.cwd()`. */
  cwd?: string;
  /** Onde escrever as variáveis. Padrão: `process.env`. */
  processEnv?: NodeJS.ProcessEnv;
}

/**
 * Sobe a partir de `startDir` até achar o diretório com `pnpm-workspace.yaml`.
 *
 * Devolve `undefined` quando o marcador não aparece até a raiz do sistema de
 * arquivos — o binário instalado fora do repositório, por exemplo.
 */
export function findWorkspaceRoot(startDir: string): string | undefined {
  let current = resolve(startDir);

  for (;;) {
    if (existsSync(join(current, WORKSPACE_ROOT_MARKER))) {
      return current;
    }

    const parent = dirname(current);

    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
}

/**
 * Os arquivos `.env` que um ponto de entrada rodando em `startDir` deve ler,
 * **na ordem de precedência**: o do próprio pacote primeiro, o da raiz do
 * monorepo depois.
 *
 * A ordem importa porque o `dotenv` não sobrescreve o que já foi definido: com
 * uma lista de caminhos, o primeiro arquivo que define uma variável vence. O
 * `.env` do pacote é o mais específico, então vem antes.
 *
 * Caminho que não existe não é filtrado: o `dotenv` ignora arquivo ausente, e
 * devolver a lista completa deixa o log de boot dizer onde ele procurou.
 *
 * post-mortem #2 (08/09/2026): o README e os dois `.env.example` mandavam
 * copiar as variáveis para um `.env` **na raiz do monorepo**, e todos os pontos
 * de entrada faziam `import "dotenv/config"`, que resolve apenas
 * `path.resolve(process.cwd(), ".env")` e nunca sobe diretório. Como todo
 * comando documentado roda por `pnpm --filter`, o `cwd` é sempre o diretório do
 * pacote, e o `.env` da raiz era ignorado em silêncio — inclusive o
 * `DATABASE_URL`, que é o pior caso: `pnpm db:migrate` aplicava a migração no
 * banco padrão de desenvolvimento enquanto o operador achava que estava
 * apontando para um banco de sondagem, que é o incidente irrecuperável descrito
 * na seção 4 do CLAUDE.md. Agora a lista de caminhos é explícita e inclui a
 * raiz. Não troque por `import "dotenv/config"` de novo.
 */
export function resolveEnvFilePaths(startDir: string): string[] {
  const start = resolve(startDir);
  const paths = [join(start, ENV_FILE_NAME)];
  const root = findWorkspaceRoot(start);

  if (root !== undefined && root !== start) {
    paths.push(join(root, ENV_FILE_NAME));
  }

  return paths;
}

/**
 * Carrega o `.env` do pacote e o `.env` da raiz do monorepo, nessa ordem de
 * precedência, com a função de carga do `dotenv` recebida por parâmetro.
 *
 * Devolve os caminhos consultados, para quem quiser registrá-los.
 */
export function loadWorkspaceEnv(
  dotenvConfig: DotenvConfig,
  options: LoadWorkspaceEnvOptions = {},
): string[] {
  const paths = resolveEnvFilePaths(options.cwd ?? process.cwd());

  dotenvConfig(
    options.processEnv === undefined
      ? { path: paths }
      : { path: paths, processEnv: options.processEnv },
  );

  return paths;
}
