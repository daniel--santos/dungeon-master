/**
 * O parser do dialeto do Antigravity, linha a linha.
 *
 * Todas as linhas deste arquivo são **capturas reais** da CLI 1.1.27 no
 * Windows, anonimizadas só nos caminhos absolutos e nos ids de conversa. É a
 * diferença entre testar o parser e testar a ideia que se tem do formato: a
 * lista de `tools` do `init`, o `text_delta` que também aparece no passo
 * `DONE`, o `denied_actions` que sobrevive a um `status: SUCCESS` — nada disso
 * seria escrito de cabeça.
 */

import { describe, expect, it } from "vitest";

import { encodeUserMessage, parseAntigravityLine, parseAntigravityUsage } from "./antigravity.js";

/** `init`, com a lista de ferramentas encurtada e o `cwd` trocado. */
const INIT =
  '{"event":"init","conversation_id":"68daf2ab-0953-4a78-bb33-72520efee0e7","init":{"cwd":"C:\\\\repo","tools":["run_command","write_to_file","view_file"],"permission_mode":"request-review"}}';

const USER_INPUT =
  '{"event":"step_update","step_update":{"conversation_id":"68daf2ab-0953-4a78-bb33-72520efee0e7","step_index":0,"state":"DONE","step_type":"user_input"}}';

const TEXT_DELTA =
  '{"event":"step_update","step_update":{"conversation_id":"68daf2ab-0953-4a78-bb33-72520efee0e7","step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"OK\\n","duration_seconds":1.4079779,"usage":{"input_tokens":9344,"output_tokens":34,"thinking_tokens":33,"cache_read_tokens":8143,"total_tokens":9378}}}';

const TOOL_ACTIVE =
  '{"event":"step_update","step_update":{"conversation_id":"7eb21e50","step_index":6,"state":"ACTIVE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"git --version"}}}}';

const TOOL_DONE =
  '{"event":"step_update","step_update":{"conversation_id":"9a4b6b56","step_index":2,"state":"DONE","step_type":"tool","tool_name":"run_command","duration_seconds":0.2773595,"tool_info":{"name":"run_command","parameters":{"CommandLine":"git --version"},"output":"git version 2.45.1.windows.1\\n"}}}';

const TOOL_DENIED =
  '{"event":"step_update","step_update":{"conversation_id":"7eb21e50","step_index":6,"state":"ERROR","step_type":"tool","tool_name":"run_command","duration_seconds":0.0287694,"tool_info":{"name":"run_command","parameters":{"CommandLine":"git --version"},"error":{"type":"TOOL_ERROR","message":"permission check failed for command \\"git --version\\": user denied permission to run command:\\ngit --version"}}}}';

const RESULT_SUCCESS =
  '{"event":"result","result":{"conversation_id":"68daf2ab","status":"SUCCESS","response":"OK\\n","duration_seconds":1.6557813,"num_turns":1,"usage":{"input_tokens":9344,"output_tokens":34,"thinking_tokens":33,"cache_read_tokens":8143,"total_tokens":9378}}}';

const RESULT_DENIED =
  '{"event":"result","result":{"conversation_id":"b4e1f5b3","status":"SUCCESS","response":"","duration_seconds":3.37,"num_turns":1,"usage":{"input_tokens":5525,"output_tokens":1001,"thinking_tokens":730,"cache_read_tokens":8130,"total_tokens":6526},"denied_actions":[{"action":"command","display_name":"RunCommand"}]}}';

const RESULT_MODELO_INVALIDO =
  '{"event":"result","result":{"conversation_id":"","status":"ERROR","response":"","error":"invalid model selection (--model \\"modelo-inexistente-dm-teste\\" --effort \\"\\"): model modelo-inexistente-dm-teste is not recognized as a known model or custom model in settings","duration_seconds":0,"num_turns":0,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":0}}}';

const RESULT_STRUCTURED =
  '{"event":"result","result":{"conversation_id":"8151760e","status":"SUCCESS","response":"{\\"answer\\":\\"ok\\",\\"toolAction\\":\\"Finishing task\\"}\\n","duration_seconds":2.299054,"num_turns":1,"structured_output":{"answer":"ok"},"json_schema":{"type":"object"},"usage":{"input_tokens":5679,"output_tokens":178,"thinking_tokens":147,"cache_read_tokens":8128,"total_tokens":5857}}}';

const RESULT_CANCELED =
  '{"event":"result","result":{"conversation_id":"dc153cac","status":"CANCELED","response":"","duration_seconds":6.43,"num_turns":1,"usage":{"input_tokens":12592,"output_tokens":1783,"thinking_tokens":1539,"cache_read_tokens":16260,"total_tokens":14375},"denied_actions":[{"action":"command","display_name":"RunCommand"}]}}';

describe("parseAntigravityLine", () => {
  it("captura o id de conversa da linha init", () => {
    expect(parseAntigravityLine(INIT)).toEqual([
      { kind: "session", id: "68daf2ab-0953-4a78-bb33-72520efee0e7" },
    ]);
  });

  it("ignora um init sem id, em vez de emitir uma sessão vazia", () => {
    const semId = '{"event":"init","conversation_id":"","init":{"cwd":"C:\\\\repo"}}';
    expect(parseAntigravityLine(semId)).toEqual([]);
  });

  it("ignora o passo de eco da entrada do usuário", () => {
    expect(parseAntigravityLine(USER_INPUT)).toEqual([]);
  });

  it("traduz text_delta e o consumo do mesmo passo", () => {
    expect(parseAntigravityLine(TEXT_DELTA)).toEqual([
      { kind: "text", text: "OK\n" },
      {
        kind: "usage",
        usage: {
          inputTokens: 9344,
          // 34 de saída mais 33 de raciocínio: os dois são cobrados como saída.
          outputTokens: 67,
          cacheReadInputTokens: 8143,
          cacheCreationInputTokens: 0,
        },
      },
    ]);
  });

  it("abre a chamada de ferramenta no estado ACTIVE, com o índice como id", () => {
    const [call] = parseAntigravityLine(TOOL_ACTIVE);
    expect(call).toMatchObject({ kind: "tool_call", id: "step-6", name: "run_command" });
    expect(call?.kind === "tool_call" && call.args).toContain("git --version");
  });

  it("fecha a ferramenta com a saída no estado DONE", () => {
    expect(parseAntigravityLine(TOOL_DONE)).toEqual([
      {
        kind: "tool_result",
        id: "step-2",
        name: "run_command",
        ok: true,
        output: "git version 2.45.1.windows.1\n",
      },
    ]);
  });

  it("uma negação de permissão vira resultado com falha e diagnóstico", () => {
    const signals = parseAntigravityLine(TOOL_DENIED);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toMatchObject({ kind: "tool_result", ok: false });
    expect(signals[1]).toMatchObject({ kind: "diagnostic", code: "PERMISSION_DENIED" });
    // O texto precisa apontar o caminho que funciona nesta CLI, e não mandar o
    // usuário mexer numa allow-list que ela não consulta em modo headless.
    expect(signals[1]?.kind === "diagnostic" && signals[1].detail).toContain("allowUnsafeBypass");
  });

  it("uma falha de ferramenta que não é permissão não vira diagnóstico", () => {
    const falha =
      '{"event":"step_update","step_update":{"conversation_id":"7eb21e50","step_index":6,"state":"ERROR","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"C:\\\\repo\\\\ausente.md"},"error":{"type":"TOOL_ERROR","message":"C:\\\\repo\\\\ausente.md does not exist in the current location."}}}}';
    const signals = parseAntigravityLine(falha);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ kind: "tool_result", ok: false });
  });

  it("entrega o texto final e o consumo total na linha result", () => {
    const signals = parseAntigravityLine(RESULT_SUCCESS);
    expect(signals).toContainEqual({ kind: "result", text: "OK\n" });
    expect(signals.some((signal) => signal.kind === "usage")).toBe(true);
  });

  it("denied_actions vira diagnóstico mesmo com status SUCCESS", () => {
    // Este é o caso que engana: a CLI sai com código 0 e status SUCCESS mesmo
    // tendo negado tudo o que o agente tentou. Sem o diagnóstico, o Run
    // pareceria bem-sucedido sem trabalho feito.
    const signals = parseAntigravityLine(RESULT_DENIED);
    expect(signals).toContainEqual(
      expect.objectContaining({ kind: "diagnostic", code: "PERMISSION_DENIED" }),
    );
    expect(signals.some((signal) => signal.kind === "result")).toBe(false);
  });

  it("modelo inexistente vira erro não retentável", () => {
    const signals = parseAntigravityLine(RESULT_MODELO_INVALIDO);
    const erro = signals.find((signal) => signal.kind === "error");
    expect(erro).toBeDefined();
    expect(erro?.kind === "error" && erro.retryable).toBe(false);
    expect(erro?.kind === "error" && erro.message).toContain("invalid model selection");
  });

  it("status CANCELED vira erro, e não sucesso vazio", () => {
    const signals = parseAntigravityLine(RESULT_CANCELED);
    const erro = signals.find((signal) => signal.kind === "error");
    expect(erro?.kind === "error" && erro.retryable).toBe(false);
  });

  it("structured_output é reembalado no bloco <result>", () => {
    const signals = parseAntigravityLine(RESULT_STRUCTURED);
    expect(signals).toContainEqual({
      kind: "result",
      text: '<result>{"answer":"ok"}</result>',
    });
  });

  it("uma linha desconhecida não derruba o parser", () => {
    expect(parseAntigravityLine('{"event":"algo_novo","payload":{}}')).toEqual([]);
    expect(parseAntigravityLine("nem json")).toEqual([]);
    expect(parseAntigravityLine("")).toEqual([]);
  });
});

describe("parseAntigravityUsage", () => {
  it("soma o raciocínio à saída e ignora o total derivado", () => {
    expect(
      parseAntigravityUsage({
        input_tokens: 100,
        output_tokens: 20,
        thinking_tokens: 5,
        cache_read_tokens: 7,
        total_tokens: 120,
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 25,
      cacheReadInputTokens: 7,
      cacheCreationInputTokens: 0,
    });
  });

  it("devolve undefined quando o objeto não tem os dois campos obrigatórios", () => {
    expect(parseAntigravityUsage({ input_tokens: 1 })).toBeUndefined();
    expect(parseAntigravityUsage(undefined)).toBeUndefined();
  });
});

describe("encodeUserMessage", () => {
  it("produz uma linha NDJSON no formato que --input-format stream-json aceita", () => {
    const linha = encodeUserMessage("Responda apenas OK");
    expect(linha.endsWith("\n")).toBe(true);
    expect(JSON.parse(linha)).toEqual({
      event: "user",
      message: { role: "user", content: [{ type: "text", text: "Responda apenas OK" }] },
    });
  });

  it("escapa quebras de linha e aspas do prompt", () => {
    const linha = encodeUserMessage('linha 1\nlinha "2"');
    expect(linha.split("\n").filter((parte) => parte.length > 0)).toHaveLength(1);
    expect(JSON.parse(linha).message.content[0].text).toBe('linha 1\nlinha "2"');
  });
});
