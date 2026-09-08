import { describe, expect, it } from "vitest";

import { hasWorkspace, looksAbsolutePath } from "@/lib/workspace";

/**
 * A checagem do browser aceita as duas famílias de caminho porque ele não sabe
 * em qual sistema operacional a API está: recusar a forma do outro sistema aqui
 * bloquearia um caminho que o servidor aceitaria sem reclamar.
 */
describe("looksAbsolutePath", () => {
  it("aceita POSIX, unidade do Windows e UNC", () => {
    expect(looksAbsolutePath("/home/voce/forja")).toBe(true);
    expect(looksAbsolutePath("D:\\Dev\\forja")).toBe(true);
    expect(looksAbsolutePath("d:/dev/forja")).toBe(true);
    expect(looksAbsolutePath("\\\\servidor\\compartilhado")).toBe(true);
    expect(looksAbsolutePath("  /home/voce/forja  ")).toBe(true);
  });

  it("recusa relativo e vazio", () => {
    expect(looksAbsolutePath("./repos/forja")).toBe(false);
    expect(looksAbsolutePath("repos/forja")).toBe(false);
    expect(looksAbsolutePath("../forja")).toBe(false);
    expect(looksAbsolutePath("D:forja")).toBe(false);
    expect(looksAbsolutePath("   ")).toBe(false);
    expect(looksAbsolutePath("")).toBe(false);
  });
});

describe("hasWorkspace", () => {
  it("só é verdadeiro com um caminho de verdade", () => {
    expect(hasWorkspace({ workspacePath: "/home/voce/forja" })).toBe(true);
    expect(hasWorkspace({ workspacePath: null })).toBe(false);
    expect(hasWorkspace({ workspacePath: "" })).toBe(false);
  });
});
