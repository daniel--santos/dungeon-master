// @ts-check
/**
 * `agy` de mentira falando o NDJSON de verdade.
 *
 * Existe para que a suíte de contrato do Antigravity rode no CI, onde não há
 * CLI instalada nem rede — e para produzir o que a CLI real não produz sob
 * encomenda: silêncio absoluto (timeout ocioso), recusa a `SIGTERM` (escalada
 * do kill) e um neto vivo (prova de que o kill é de árvore).
 *
 * O que ele emite é o formato medido na 1.1.27, campo por campo: `init` com
 * `conversation_id`, `step_update` com `step_type`/`state`/`tool_info`, e
 * `result` com `status`, `response`, `usage`, `structured_output` e
 * `denied_actions`. É essa fidelidade que faz dele um teste do `parseLine` de
 * verdade, e não de um dialeto inventado.
 *
 * O prompt chega pelo stdin no formato `--input-format stream-json`, como no
 * adapter real: uma linha `{"event":"user","message":{...}}`. As diretivas
 * `@@fake:` vêm dentro do texto dessa mensagem.
 *
 * Diretivas:
 *
 *   @@fake:session <id>        usa este id de conversa
 *   @@fake:no-session          emite `init` sem `conversation_id`
 *   @@fake:text <texto>        um `agent_response` com `text_delta`
 *   @@fake:tool <nome> <args>  um passo de ferramenta que termina DONE
 *   @@fake:tool-fail <nome>    um passo de ferramenta que termina ERROR
 *   @@fake:denied <nome>       ferramenta negada por permissão (ERROR + denied_actions)
 *   @@fake:usage <in> <out>    consumo de tokens no passo
 *   @@fake:stderr <texto>      escreve no stderr
 *   @@fake:block <json>        emite <result>json</result> como texto
 *   @@fake:structured <json>   devolve `structured_output` na linha final
 *   @@fake:result <texto>      texto da `response` final
 *   @@fake:status <STATUS>     status final (SUCCESS, ERROR, CANCELED)
 *   @@fake:error <mensagem>    `status: ERROR` com esta mensagem, e saída 1
 *   @@fake:write <caminho> <texto>   escreve um arquivo no diretório de trabalho
 *   @@fake:git <args>          roda `git` no diretório de trabalho
 *   @@fake:sleep <ms>          espera
 *   @@fake:hang                nunca mais emite nada e nunca sai
 *   @@fake:ignore-signals      passa a ignorar SIGTERM, SIGINT e SIGBREAK
 *   @@fake:spawn-child         sobe um neto que também ignora sinais
 *   @@fake:exit <code>         sai com este código
 */

import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CHILD_MARKER = "--fake-child";

if (process.argv.includes(CHILD_MARKER)) {
  for (const signal of ["SIGTERM", "SIGINT", "SIGBREAK"]) {
    try {
      process.on(signal, () => {});
    } catch {
      // Sinal não existe nesta plataforma.
    }
  }
  setInterval(() => {}, 1_000);
} else {
  main();
}

function main() {
  readStdin()
    .then((raw) => run(extractPrompt(raw)))
    .catch((error) => {
      process.stderr.write(`fake-agy falhou: ${String(error)}\n`);
      process.exit(70);
    });
}

/** @returns {Promise<string>} */
function readStdin() {
  return new Promise((done, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      done(data);
    });
    process.stdin.on("error", reject);
  });
}

/**
 * O texto do prompt dentro da mensagem NDJSON do stdin.
 *
 * Se o stdin não for a mensagem esperada, o falso reclama no stderr e sai com
 * código 2 — que é o que a CLI real faz quando o `-p` é usado errado. Sem isso,
 * um erro no `buildArgs` viraria um teste verde.
 *
 * @param {string} raw
 * @returns {string}
 */
function extractPrompt(raw) {
  const line = raw.split(/\r?\n/).find((entry) => entry.trim().length > 0);
  if (line === undefined) {
    process.stderr.write("fake-agy: nada chegou pelo stdin\n");
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    process.stderr.write("fake-agy: o stdin não é NDJSON\n");
    return process.exit(2);
  }
  if (parsed?.event !== "user") {
    process.stderr.write(`fake-agy: evento de entrada inesperado ${String(parsed?.event)}\n`);
    return process.exit(2);
  }
  const content = parsed?.message?.content;
  if (!Array.isArray(content)) {
    process.stderr.write('fake-agy: stream input "user" message has no content\n');
    return process.exit(2);
  }
  return content.map((block) => (typeof block?.text === "string" ? block.text : "")).join("");
}

/** @param {unknown} line */
function emit(line) {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

/** @param {number} ms */
function delay(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/** @param {string} prompt */
async function run(prompt) {
  const directives = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("@@fake:"))
    .map((line) => {
      const rest = line.slice("@@fake:".length);
      const spaceIdx = rest.indexOf(" ");
      return spaceIdx === -1
        ? { name: rest, arg: "" }
        : { name: rest.slice(0, spaceIdx), arg: rest.slice(spaceIdx + 1) };
    });

  const explicit = directives.find((d) => d.name === "session");
  const conversationId = directives.some((d) => d.name === "no-session")
    ? ""
    : (explicit?.arg ?? "fake-agy-0001");

  emit({
    event: "init",
    conversation_id: conversationId,
    init: {
      cwd: process.cwd(),
      tools: ["run_command", "write_to_file"],
      permission_mode: "request-review",
    },
  });

  let step = 0;
  const nextStep = () => {
    step += 1;
    return step;
  };
  emit({
    event: "step_update",
    step_update: {
      conversation_id: conversationId,
      step_index: 0,
      state: "DONE",
      step_type: "user_input",
    },
  });

  const texts = [];
  const denied = [];
  let response;
  let structured;
  let status = "SUCCESS";
  let usage = {
    input_tokens: 10,
    output_tokens: 1,
    thinking_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 11,
  };

  if (directives.length === 0) {
    emitText(conversationId, nextStep(), "OK", usage);
    emitResult(conversationId, "SUCCESS", "OK", usage, undefined, []);
    return;
  }

  for (const directive of directives) {
    switch (directive.name) {
      case "session":
      case "no-session":
        break;
      case "text":
        texts.push(directive.arg);
        emitText(conversationId, nextStep(), directive.arg, usage);
        break;
      case "block": {
        const text = `<result>${directive.arg}</result>`;
        texts.push(text);
        emitText(conversationId, nextStep(), text, usage);
        break;
      }
      case "tool":
      case "tool-fail":
      case "denied": {
        const spaceIdx = directive.arg.indexOf(" ");
        const name = spaceIdx === -1 ? directive.arg : directive.arg.slice(0, spaceIdx);
        const args = spaceIdx === -1 ? "" : directive.arg.slice(spaceIdx + 1);
        const index = nextStep();
        const parameters = args.length === 0 ? {} : { CommandLine: args };
        emit({
          event: "step_update",
          step_update: {
            conversation_id: conversationId,
            step_index: index,
            state: "ACTIVE",
            step_type: "tool",
            tool_name: name,
            tool_info: { name, parameters },
          },
        });
        if (directive.name === "tool") {
          emit({
            event: "step_update",
            step_update: {
              conversation_id: conversationId,
              step_index: index,
              state: "DONE",
              step_type: "tool",
              tool_name: name,
              duration_seconds: 0.01,
              tool_info: { name, parameters, output: "ok" },
            },
          });
          break;
        }
        const message =
          directive.name === "denied"
            ? `permission check failed for command "${args}": user denied permission to run command:\n${args}`
            : "a ferramenta falhou";
        if (directive.name === "denied")
          denied.push({ action: "command", display_name: "RunCommand" });
        emit({
          event: "step_update",
          step_update: {
            conversation_id: conversationId,
            step_index: index,
            state: "ERROR",
            step_type: "tool",
            tool_name: name,
            duration_seconds: 0.01,
            tool_info: { name, parameters, error: { type: "TOOL_ERROR", message } },
          },
        });
        break;
      }
      case "usage": {
        const [input = "0", output = "0"] = directive.arg.split(/\s+/);
        usage = {
          input_tokens: Number(input),
          output_tokens: Number(output),
          thinking_tokens: 0,
          cache_read_tokens: 0,
          total_tokens: Number(input) + Number(output),
        };
        break;
      }
      case "stderr":
        process.stderr.write(`${directive.arg}\n`);
        break;
      case "structured":
        structured = JSON.parse(directive.arg);
        break;
      case "result":
        response = directive.arg;
        break;
      case "status":
        status = directive.arg;
        break;
      case "error":
        emitResult(conversationId, "ERROR", "", usage, undefined, [], directive.arg);
        process.exit(1);
        break;
      case "write": {
        const espaco = directive.arg.indexOf(" ");
        const caminho = espaco === -1 ? directive.arg : directive.arg.slice(0, espaco);
        const conteudo = espaco === -1 ? "" : directive.arg.slice(espaco + 1);
        writeFileSync(resolve(process.cwd(), caminho), `${conteudo}\n`);
        break;
      }
      case "git": {
        const r = spawnSync("git", directive.arg.split(" ").filter(Boolean), {
          cwd: process.cwd(),
          encoding: "utf8",
        });
        if (r.status !== 0) {
          const detalhe = `${r.stderr ?? ""}${r.stdout ?? ""}`.trim() || String(r.error ?? "");
          process.stderr.write(`git ${directive.arg} falhou (${String(r.status)}): ${detalhe}\n`);
        }
        break;
      }
      case "sleep":
        await delay(Number(directive.arg) || 0);
        break;
      case "hang":
        // O timer é o que segura o event loop: sem ele o Node sairia com código
        // 0, que é o oposto do cenário. Quem termina precisa ser o runtime.
        setInterval(() => {}, 1_000);
        await new Promise(() => {});
        break;
      case "ignore-signals":
        for (const signal of ["SIGTERM", "SIGINT", "SIGBREAK"]) {
          try {
            process.on(signal, () => {});
          } catch {
            // Sinal não existe nesta plataforma.
          }
        }
        break;
      case "spawn-child": {
        const self = fileURLToPath(import.meta.url);
        const child = spawn(process.execPath, [self, CHILD_MARKER], { stdio: "ignore" });
        child.unref();
        emitText(conversationId, nextStep(), `neto ${String(child.pid)}`, usage);
        break;
      }
      case "exit":
        process.exit(Number(directive.arg) || 0);
        break;
      default:
        process.stderr.write(`diretiva desconhecida: ${directive.name}\n`);
        break;
    }
  }

  emit({
    event: "step_update",
    step_update: {
      conversation_id: conversationId,
      step_index: nextStep(),
      state: "DONE",
      step_type: "finish",
      duration_seconds: 0.01,
    },
  });

  emitResult(conversationId, status, response ?? texts.join(""), usage, structured, denied);
}

/**
 * @param {string} conversationId
 * @param {number} index
 * @param {string} text
 * @param {Record<string, number>} usage
 */
function emitText(conversationId, index, text, usage) {
  emit({
    event: "step_update",
    step_update: {
      conversation_id: conversationId,
      step_index: index,
      state: "DONE",
      step_type: "agent_response",
      text_delta: text,
      duration_seconds: 0.01,
      usage,
    },
  });
}

/**
 * @param {string} conversationId
 * @param {string} status
 * @param {string} response
 * @param {Record<string, number>} usage
 * @param {unknown} structured
 * @param {unknown[]} denied
 * @param {string} [error]
 */
function emitResult(conversationId, status, response, usage, structured, denied, error) {
  emit({
    event: "result",
    result: {
      conversation_id: conversationId,
      status,
      response,
      ...(error === undefined ? {} : { error }),
      duration_seconds: 0.1,
      num_turns: 1,
      ...(structured === undefined ? {} : { structured_output: structured }),
      usage,
      ...(denied.length === 0 ? {} : { denied_actions: denied }),
    },
  });
}
