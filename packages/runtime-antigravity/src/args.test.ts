/**
 * O argv do Antigravity.
 *
 * Um argv errado não derruba o Run: ele faz o agente trabalhar no lugar errado
 * ou ser negado no meio e reportar que não conseguiu. É o tipo de defeito que
 * só aparece lendo o comando, e por isso ele é testado peça por peça.
 */

import type { HarnessExecutionRequest } from "@dungeon-master/runtime";
import { describe, expect, it } from "vitest";

import { buildAntigravityArgs } from "./antigravity.js";

function pedido(overrides: Partial<HarnessExecutionRequest> = {}): HarnessExecutionRequest {
  return {
    executionId: "run-1",
    cwd: "/repo/projeto",
    prompt: "Responda apenas OK",
    env: {},
    permission: { mode: "DEFAULT", enforcement: "ADVISORY" },
    ...overrides,
  };
}

/** O valor que segue uma flag, ou `undefined` quando a flag não está lá. */
function valorDe(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe("buildAntigravityArgs", () => {
  it("entra em modo print sem consumir o próximo argumento como prompt", () => {
    // `-p` sozinho faria a CLI tomar `--input-format` como prompt e sair com
    // código 2; `-p=` é o que a 1.1.27 aceita como print com valor vazio.
    const { args } = buildAntigravityArgs(pedido());
    expect(args[0]).toBe("-p=");
    expect(args).not.toContain("-p");
  });

  it("manda o prompt pelo stdin, como uma mensagem NDJSON", () => {
    const { args, stdin } = buildAntigravityArgs(pedido({ prompt: "texto do prompt" }));
    expect(valorDe(args, "--input-format")).toBe("stream-json");
    expect(valorDe(args, "--output-format")).toBe("stream-json");
    expect(stdin).toBeDefined();
    expect(JSON.parse(stdin ?? "").message.content[0].text).toBe("texto do prompt");
    // O prompt nunca vai no argv: no Windows a linha de comando tem teto de
    // 32767 caracteres, e um prompt com contexto de projeto passa disso.
    expect(args.join(" ")).not.toContain("texto do prompt");
  });

  it("declara o diretório de trabalho como workspace", () => {
    // Sem `--add-dir` o agente escreve em `~/.gemini/antigravity-cli/scratch`
    // em vez do repositório. Foi medido no spike.
    const { args } = buildAntigravityArgs(pedido({ cwd: "/repo/projeto" }));
    expect(valorDe(args, "--add-dir")).toBe("/repo/projeto");
  });

  it("passa modelo, agente e esforço quando existem", () => {
    const { args } = buildAntigravityArgs(pedido({ model: { id: "gemini-3.1-pro-high" } }), {
      agent: "revisor",
      effort: "high",
    });
    expect(valorDe(args, "--model")).toBe("gemini-3.1-pro-high");
    expect(valorDe(args, "--agent")).toBe("revisor");
    expect(valorDe(args, "--effort")).toBe("high");
  });

  it("retoma a conversa por id", () => {
    const { args } = buildAntigravityArgs(
      pedido({ resume: { harnessSessionId: "68daf2ab-0953" } }),
    );
    expect(valorDe(args, "--conversation")).toBe("68daf2ab-0953");
  });

  describe("permissões", () => {
    it("o modo padrão não passa flag nenhuma de permissão", () => {
      const { args } = buildAntigravityArgs(pedido());
      expect(args).not.toContain("--dangerously-skip-permissions");
    });

    it("o modo configurado também não, porque a CLI não tem allow-list headless", () => {
      // A tentação é traduzir a concessão para `permissions.allow`. Não dá: a
      // 1.1.27 não consulta regra de comando em modo headless, e escrever no
      // argv uma barreira que não existe seria pior que não ter degrau nenhum.
      const { args } = buildAntigravityArgs(
        pedido({
          permission: {
            mode: "CONFIGURED",
            enforcement: "ADVISORY",
            grant: {
              workspaceWrite: true,
              commandExecution: "ALLOWLIST",
              allowedCommands: ["git", "pnpm"],
              deniedCommands: ["rm"],
            },
          },
        }),
      );
      expect(args).not.toContain("--dangerously-skip-permissions");
      expect(args.join(" ")).not.toContain("git");
    });

    it("só BYPASS liga o interruptor que desliga as checagens", () => {
      const { args } = buildAntigravityArgs(
        pedido({ permission: { mode: "BYPASS", enforcement: "ADVISORY" } }),
      );
      expect(args).toContain("--dangerously-skip-permissions");
    });
  });

  describe("resultado estruturado", () => {
    const schema = { type: "object", properties: { answer: { type: "string" } } };

    it("passa o schema nativo quando a tag é a padrão", () => {
      const { args } = buildAntigravityArgs(
        pedido({ outputSchema: { jsonSchema: schema, tag: "result" } }),
      );
      expect(JSON.parse(valorDe(args, "--json-schema") ?? "null")).toEqual(schema);
    });

    it("não passa o schema nativo quando a tag é outra", () => {
      // O bloco que o parser sintetiza a partir de `structured_output` usa a
      // tag padrão; com outra tag o runtime procuraria onde não está, e o
      // caminho certo passa a ser a instrução no prompt, comum a todos.
      const { args } = buildAntigravityArgs(
        pedido({ outputSchema: { jsonSchema: schema, tag: "saida" } }),
      );
      expect(args).not.toContain("--json-schema");
    });

    it("sem outputSchema não passa schema nenhum", () => {
      expect(buildAntigravityArgs(pedido()).args).not.toContain("--json-schema");
    });
  });

  it("acrescenta os argumentos extras do adapter e do Loadout, nessa ordem", () => {
    const { args } = buildAntigravityArgs(pedido({ extraArgs: ["--do-loadout"] }), {
      extraArgs: ["--do-adapter"],
    });
    expect(args.indexOf("--do-adapter")).toBeLessThan(args.indexOf("--do-loadout"));
  });
});
