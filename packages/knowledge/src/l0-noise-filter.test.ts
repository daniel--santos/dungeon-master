import { describe, expect, it } from "vitest";

import { filterHarnessNoise, isHarnessInternalPrompt, tailOf } from "./l0-noise-filter.js";

describe("filterHarnessNoise", () => {
  it("descarta a mensagem inteira quando ela é um prompt interno da CLI", () => {
    expect(isHarnessInternalPrompt("[SUGGESTION MODE: on] faça x")).toBe(true);
    expect(filterHarnessNoise("[SUGGESTION MODE: on] faça x")).toBe("");
    expect(filterHarnessNoise("The user stepped away and is coming back. Recap the session.")).toBe(
      "",
    );
    expect(filterHarnessNoise('Your questions have been answered: "sim"')).toBe("");
    expect(filterHarnessNoise("[2026-09-08T10:00:00Z][user] oi")).toBe("");
  });

  it("remove os wrappers que o harness injeta e mantém o texto do agente", () => {
    const entrada = [
      "<system-reminder>lembrete do sistema</system-reminder>",
      "Descobri que o lint pega o import quebrado.",
      "<persisted-output>saída grande</persisted-output>",
      "<local-command-stdout>ls</local-command-stdout>",
      "<function_results>...</function_results>",
      "Vale registrar isso.",
    ].join("\n");

    expect(filterHarnessNoise(entrada)).toBe(
      "Descobri que o lint pega o import quebrado.\n\n\nVale registrar isso.".replace(
        "\n\n\n",
        "\n\n",
      ),
    );
  });

  it("apaga linha a linha os ecos de ferramenta e o cat -n", () => {
    const entrada = [
      "The file src/a.ts has been updated successfully.",
      "     1\timport x",
      "(Bash completed with no output)",
      "O teste roda com pnpm test.",
    ].join("\n");

    expect(filterHarnessNoise(entrada)).toBe("O teste roda com pnpm test.");
  });

  it("remove o frontmatter de MEMORY.md e preserva um separador comum de Markdown", () => {
    const comFrontmatter = "---\nname: x\ndescription: y\n---\nTexto útil.";
    expect(filterHarnessNoise(comFrontmatter)).toBe("Texto útil.");

    const separador = "Parte um.\n\n---\n\nParte dois.";
    expect(filterHarnessNoise(separador)).toBe(separador);
  });

  it("colapsa linhas em branco a mais e nunca lança", () => {
    expect(filterHarnessNoise("a\n\n\n\n\nb")).toBe("a\n\nb");
    expect(filterHarnessNoise("")).toBe("");
  });
});

describe("tailOf", () => {
  it("devolve a cauda marcada quando passa do teto", () => {
    expect(tailOf("abcdefghij", 5)).toBe("…ghij");
    expect(tailOf("abc", 5)).toBe("abc");
  });
});
