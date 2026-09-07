/**
 * Os parsers contra linhas reais.
 *
 * Cada linha aqui foi capturada da CLI correspondente em 07/09/2026 e colada
 * sem edição. É a defesa contra mudança de formato: quando uma versão nova da
 * CLI mudar o dialeto, o teste fica vermelho aqui, e não num Run de produção
 * que perdeu o id de sessão em silêncio.
 */

import { describe, expect, it } from "vitest";

import { parseClaudeLine } from "./claude-code.js";
import { parseCodexLine } from "./codex.js";
import { describeToolInput, flattenContent, parseJsonObject } from "./parse-utils.js";
import { parsePiLine } from "./pi.js";

describe("parseClaudeLine (CLI 2.1.263)", () => {
  it("captura o id de sessão da linha de init", () => {
    const signals = parseClaudeLine(
      '{"type":"system","subtype":"init","cwd":"C:\\\\tmp","session_id":"03acba0c-3b36-4f13-a4fa-8f39ea57da52","model":"claude-sonnet-5","permissionMode":"default"}',
    );

    expect(signals).toEqual([{ kind: "session", id: "03acba0c-3b36-4f13-a4fa-8f39ea57da52" }]);
  });

  it("traduz texto do assistente", () => {
    const signals = parseClaudeLine(
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"OK"}]}}',
    );

    expect(signals).toEqual([{ kind: "text", text: "OK" }]);
  });

  it("traduz tool_use com o campo em destaque", () => {
    const signals = parseClaudeLine(
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_01","name":"Bash","input":{"command":"git --version","description":"Check installed git version"}}]}}',
    );

    expect(signals).toEqual([
      { kind: "tool_call", id: "toolu_01", name: "Bash", args: "git --version" },
    ]);
  });

  it("traduz tool_result com erro", () => {
    const signals = parseClaudeLine(
      '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"This command requires approval","is_error":true,"tool_use_id":"toolu_01"}]}}',
    );

    expect(signals).toEqual([
      {
        kind: "tool_result",
        id: "toolu_01",
        ok: false,
        output: "This command requires approval",
      },
    ]);
  });

  it("permissão negada vira diagnóstico, não falha", () => {
    const signals = parseClaudeLine(
      '{"type":"system","subtype":"permission_denied","tool_name":"Bash","tool_use_id":"toolu_01","decision_reason":"This command requires approval"}',
    );

    expect(signals[0]).toMatchObject({ kind: "diagnostic", level: "WARN" });
    expect(signals[0]).toHaveProperty("message", expect.stringContaining("Bash"));
  });

  it("a linha de resultado traz texto, tokens e custo", () => {
    const signals = parseClaudeLine(
      '{"type":"result","subtype":"success","is_error":false,"result":"OK","total_cost_usd":0.0486044,"usage":{"input_tokens":2,"cache_creation_input_tokens":10929,"cache_read_input_tokens":24222,"output_tokens":4}}',
    );

    expect(signals).toEqual([
      {
        kind: "usage",
        usage: {
          inputTokens: 2,
          outputTokens: 4,
          cacheReadInputTokens: 24222,
          cacheCreationInputTokens: 10929,
          costUsd: 0.0486044,
        },
      },
      { kind: "result", text: "OK" },
    ]);
  });

  it("resultado com erro vira erro retentável", () => {
    const signals = parseClaudeLine(
      '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"API Error"}',
    );

    expect(signals).toEqual([{ kind: "error", message: "API Error", retryable: true }]);
  });

  it("limite de taxa permitido não vira evento", () => {
    expect(
      parseClaudeLine(
        '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","rateLimitType":"five_hour"}}',
      ),
    ).toEqual([]);
  });

  it("linha desconhecida e linha não-JSON são ignoradas", () => {
    expect(parseClaudeLine('{"type":"stream_event","event":{}}')).toEqual([]);
    expect(parseClaudeLine("Bem-vindo ao Claude Code!")).toEqual([]);
    expect(parseClaudeLine("{quebrado")).toEqual([]);
  });
});

describe("parseCodexLine (CLI 0.147.0)", () => {
  it("captura a sessão da thread", () => {
    expect(
      parseCodexLine(
        '{"type":"thread.started","thread_id":"01a07dc8-a36e-7dd2-97ba-173b9e538df2"}',
      ),
    ).toEqual([{ kind: "session", id: "01a07dc8-a36e-7dd2-97ba-173b9e538df2" }]);
  });

  it("a mensagem do agente é texto e resultado ao mesmo tempo", () => {
    // O Codex não tem evento de resultado separado: a última mensagem é o
    // resultado, e o host adapter deixa a última sobrescrever as anteriores.
    expect(
      parseCodexLine(
        '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"OK"}}',
      ),
    ).toEqual([
      { kind: "text", text: "OK" },
      { kind: "result", text: "OK" },
    ]);
  });

  it("comando vira par de ToolCall e ToolResult", () => {
    const started = parseCodexLine(
      '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"git --version","aggregated_output":"","exit_code":null,"status":"in_progress"}}',
    );
    expect(started).toEqual([
      { kind: "tool_call", id: "item_1", name: "Bash", args: "git --version" },
    ]);

    const completed = parseCodexLine(
      '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"git --version","aggregated_output":"git version 2.45.1\\n","exit_code":0,"status":"completed"}}',
    );
    expect(completed).toEqual([
      {
        kind: "tool_result",
        id: "item_1",
        name: "Bash",
        ok: true,
        output: "git version 2.45.1\n",
      },
    ]);
  });

  it("comando que falhou traz ok=false", () => {
    const [signal] = parseCodexLine(
      '{"type":"item.completed","item":{"id":"i","type":"command_execution","command":"x","aggregated_output":"nope","exit_code":1,"status":"failed"}}',
    );

    expect(signal).toMatchObject({ kind: "tool_result", ok: false });
  });

  it("alteração de arquivo vira artefato", () => {
    const signals = parseCodexLine(
      '{"type":"item.completed","item":{"id":"i","type":"file_change","changes":[{"path":"OLA.md","kind":"add"}]}}',
    );

    expect(signals[0]).toEqual({ kind: "artifact", path: "OLA.md", artifactKind: "add" });
  });

  it("o cache não é contado duas vezes no usage", () => {
    // `input_tokens` do Codex é o total, e `cached_input_tokens` é um
    // subconjunto dele; somar os dois inflaria a janela de contexto.
    const signals = parseCodexLine(
      '{"type":"turn.completed","usage":{"input_tokens":16119,"cached_input_tokens":6000,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}',
    );

    expect(signals).toEqual([
      {
        kind: "usage",
        usage: {
          inputTokens: 10119,
          outputTokens: 5,
          cacheReadInputTokens: 6000,
          cacheCreationInputTokens: 0,
        },
      },
    ]);
  });

  it("turn.failed vira erro", () => {
    expect(
      parseCodexLine('{"type":"turn.failed","error":{"message":"stream disconnected"}}'),
    ).toEqual([{ kind: "error", message: "stream disconnected", retryable: true }]);
  });
});

describe("parsePiLine (CLI 0.85.1)", () => {
  it("a linha de cabeçalho é a única fonte do id de sessão", () => {
    expect(
      parsePiLine(
        '{"type":"session","version":3,"id":"01a07dc9-1889-7473-8cee-d5374504bf90","timestamp":"2026-09-07T21:32:06.154Z","cwd":"C:\\\\tmp"}',
      ),
    ).toEqual([{ kind: "session", id: "01a07dc9-1889-7473-8cee-d5374504bf90" }]);
  });

  it("traduz o delta de texto", () => {
    expect(
      parsePiLine(
        '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"OK"}}',
      ),
    ).toEqual([{ kind: "text", text: "OK" }]);
  });

  it("traduz ferramenta em minúsculas, que o parser do Sandcastle descarta", () => {
    // O parser de origem casa contra uma tabela em maiúsculas (`Bash`) e o Pi
    // emite `bash`, então nenhuma chamada de ferramenta chegava aos eventos.
    const signals = parsePiLine(
      '{"type":"tool_execution_start","toolCallId":"call_00_Fw","toolName":"bash","args":{"command":"git --version"}}',
    );

    expect(signals).toEqual([
      { kind: "tool_call", id: "call_00_Fw", name: "bash", args: "git --version" },
    ]);
  });

  it("traduz o fim da ferramenta com o texto do resultado", () => {
    const signals = parsePiLine(
      '{"type":"tool_execution_end","toolCallId":"call_00_Fw","toolName":"bash","result":{"content":[{"type":"text","text":"git version 2.45.1\\n"}]},"isError":false}',
    );

    expect(signals).toEqual([
      {
        kind: "tool_result",
        id: "call_00_Fw",
        name: "bash",
        ok: true,
        output: "git version 2.45.1\n",
      },
    ]);
  });

  it("lê o consumo de tokens do fim da mensagem do assistente", () => {
    const signals = parsePiLine(
      '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"OK."}],"usage":{"input":6791,"output":3,"cacheRead":0,"cacheWrite":0,"totalTokens":6794,"cost":{"total":0.004488}}}}',
    );

    expect(signals).toEqual([
      {
        kind: "usage",
        usage: {
          inputTokens: 6791,
          outputTokens: 3,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUsd: 0.004488,
        },
      },
    ]);
  });

  it("agent_end devolve o texto da última mensagem do assistente", () => {
    expect(
      parsePiLine(
        '{"type":"agent_end","messages":[{"role":"user","content":[{"type":"text","text":"oi"}]},{"role":"assistant","content":[{"type":"text","text":"OK."}]}],"willRetry":false}',
      ),
    ).toEqual([{ kind: "result", text: "OK." }]);
  });

  it("erro no stdout vira erro, e não saída vazia", () => {
    // O Pi manda erro de autenticação pelo stdout; sem esta tradução a falha
    // chegaria como código diferente de zero sem explicação nenhuma.
    expect(parsePiLine('{"type":"agent_error","message":"no api key for provider"}')).toEqual([
      { kind: "error", message: "no api key for provider", retryable: true },
    ]);
  });

  it("ruído de stream não vira evento", () => {
    expect(parsePiLine('{"type":"tool_execution_update","toolCallId":"x"}')).toEqual([]);
    expect(parsePiLine('{"type":"agent_settled"}')).toEqual([]);
    expect(parsePiLine("nem json")).toEqual([]);
  });
});

describe("parse-utils", () => {
  it("`parseJsonObject` recusa array e texto solto", () => {
    expect(parseJsonObject("[1,2]")).toBeUndefined();
    expect(parseJsonObject("oi")).toBeUndefined();
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("`describeToolInput` cai no JSON quando a ferramenta é desconhecida", () => {
    expect(describeToolInput("MinhaFerramenta", { x: 1 })).toBe('{"x":1}');
    expect(describeToolInput("Read", { file_path: "src/a.ts" })).toBe("src/a.ts");
    expect(describeToolInput("read", { path: "src/a.ts" })).toBe("src/a.ts");
  });

  it("`flattenContent` aceita string, lista de blocos e objeto", () => {
    expect(flattenContent("texto")).toBe("texto");
    expect(
      flattenContent([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ]),
    ).toBe("a\nb");
    expect(flattenContent({ content: [{ type: "text", text: "c" }] })).toBe("c");
    expect(flattenContent(42)).toBe("");
  });
});
