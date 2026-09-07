/**
 * Corpo compartilhado pelos dois arquivos que provam o isolamento de gitconfig.
 *
 * São dois arquivos de teste de propósito: o Vitest roda arquivos em paralelo,
 * e é justamente a concorrência entre eles que produzia a disputa pelo
 * `.gitconfig.lock` que `git-isolation.ts` resolve. Um arquivo só não provaria
 * nada.
 *
 * Não termina em `.test.ts` para o Vitest não tratá-lo como suíte própria.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";

import { expect, it } from "vitest";

const CHAVE = "dungeonMaster.worker";

/**
 * Onde o setup apontou o gitconfig global, com a garantia de que é descartável.
 *
 * A checagem não é decoração: sem ela, um setup que falhasse em silêncio faria
 * estes testes escreverem no `~/.gitconfig` de quem está rodando.
 */
function gitconfigDescartavel(): string {
  const caminho = process.env["GIT_CONFIG_GLOBAL"];
  if (caminho === undefined || caminho.length === 0) {
    throw new Error("GIT_CONFIG_GLOBAL não foi definido: o setup de isolamento não rodou.");
  }
  const pasta = realpathSync(dirname(caminho));
  if (!pasta.startsWith(realpathSync(tmpdir())) || !pasta.includes("test-gitconfig-worker-")) {
    throw new Error(`GIT_CONFIG_GLOBAL aponta para fora do diretório temporário: ${caminho}`);
  }
  return caminho;
}

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], { encoding: "utf8", windowsHide: true }).trim();
}

/** Igual a `git`, mas devolve `undefined` quando a chave não existe (saída 1). */
function gitOpcional(args: readonly string[]): string | undefined {
  try {
    return git(args);
  } catch {
    return undefined;
  }
}

export function provaDeIsolamento(identidade: string, identidadeDoOutroArquivo: string): void {
  it("recebe um gitconfig próprio, dentro do diretório temporário", () => {
    expect(gitconfigDescartavel()).toBeTruthy();
  });

  it("enxerga o gitconfig semeado pelo setup, não o de quem está rodando", () => {
    gitconfigDescartavel();
    expect(git(["config", "--global", "user.name"])).toBe("Test");
    expect(git(["config", "--global", "user.email"])).toBe("test@test.com");
  });

  it("escreve em rajada e lê de volta o próprio valor", () => {
    const caminho = gitconfigDescartavel();

    // Vinte escritas seguidas em um arquivo compartilhado por dois workers é o
    // que fazia aparecer "could not lock config file".
    for (let i = 0; i < 20; i += 1) {
      git(["config", "--global", CHAVE, `${identidade}-${String(i)}`]);
    }

    expect(git(["config", "--global", CHAVE])).toBe(`${identidade}-19`);
    expect(readFileSync(caminho, "utf8")).toContain(`${identidade}-19`);
  });

  it("nunca enxerga o que o outro arquivo de teste escreveu", () => {
    gitconfigDescartavel();
    git(["config", "--global", `dungeonMaster.${identidade}`, "presente"]);

    // Com um gitconfig compartilhado, quem rodasse depois leria a chave do
    // outro arquivo aqui.
    expect(
      gitOpcional(["config", "--global", "--get", `dungeonMaster.${identidadeDoOutroArquivo}`]),
    ).toBeUndefined();
  });
}
