// @ts-check
/**
 * Agente falso: um CLI de mentira que fala NDJSON de verdade.
 *
 * Existe para que a suíte de contrato de harness rode em qualquer máquina, sem
 * CLI instalada, sem rede e sem gastar token — e para que ela consiga produzir
 * os cenários que uma CLI real não produz sob demanda: travar sem emitir nada
 * (timeout ocioso), ignorar `SIGTERM` (escalada do kill) e deixar um neto vivo
 * (prova de que o kill é de árvore, e não de processo).
 *
 * O roteiro chega pelo **prompt**, no stdin, exatamente como o prompt de um
 * agente de verdade. Cada linha que começa com `@@fake:` é uma diretiva; o
 * resto do texto é ignorado. Sem nenhuma diretiva, o agente responde `OK`.
 *
 * Diretivas:
 *
 *   @@fake:session <id>       emite a linha de sessão com este id
 *   @@fake:no-session         não emite linha de sessão
 *   @@fake:text <texto>       emite um delta de texto
 *   @@fake:tool <nome> <args> emite tool_call e tool_result
 *   @@fake:tool-fail <nome>   emite tool_call e tool_result com ok=false
 *   @@fake:usage <in> <out>   emite consumo de tokens
 *   @@fake:stderr <texto>     escreve no stderr
 *   @@fake:block <json>       emite <result>json</result> como texto
 *   @@fake:result <texto>     emite a linha de resultado final
 *   @@fake:denied <ferramenta>  o harness nega a ferramenta por permissão
 *   @@fake:write <caminho> <texto>  escreve um arquivo no diretório de trabalho
 *   @@fake:delete <caminho>   apaga um arquivo do diretório de trabalho
 *   @@fake:git <args>         roda `git` no diretório de trabalho (para commitar)
 *   @@fake:sleep <ms>         espera
 *   @@fake:hang               nunca mais emite nada e nunca sai
 *   @@fake:ignore-signals     passa a ignorar SIGTERM, SIGINT e SIGBREAK
 *   @@fake:spawn-child        sobe um neto que também ignora sinais
 *   @@fake:exit <code>        sai com este código
 *   @@fake:error <mensagem>   emite uma linha de erro e sai com código 1
 *   @@fake:mcp <servidor> <ferramenta> [<argumentos JSON>]
 *                             sobe o servidor MCP de `--mcp-config`, chama a
 *                             ferramenta com os argumentos (objeto JSON; vazio
 *                             sem eles) e emite tool_call/tool_result com o
 *                             nome `mcp__<servidor>__<ferramenta>`
 *
 * `--mcp-config <json>` chega no argv com a mesma forma do Claude Code
 * (`{"mcpServers":{"nome":{"command","args"}}}`): é o que o adapter falso
 * monta a partir do `ExecutionRequest.mcpServers`, e a diretiva `mcp` prova
 * que a configuração chegou inteira — comando, argumentos e ambiente —
 * falando o protocolo de verdade com o servidor.
 */

import { spawn, spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CHILD_MARKER = "--fake-child";

if (process.argv.includes(CHILD_MARKER)) {
  // O neto: existe só para provar que o kill alcança a descendência. Ignora
  // sinais e fica de pé até alguém matar o grupo (POSIX) ou a árvore (Windows).
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
  const sessionFromArgv = readArgvValue("--session");
  readStdin()
    .then((prompt) => run(prompt, sessionFromArgv))
    .catch((error) => {
      process.stderr.write(`fake-agent falhou: ${String(error)}\n`);
      process.exit(70);
    });
}

/** @param {string} flag */
function readArgvValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

/** @returns {Promise<string>} */
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data);
    });
    process.stdin.on("error", reject);
  });
}

/** @param {unknown} line */
function emit(line) {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

/** @param {number} ms */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} prompt
 * @param {string | undefined} sessionFromArgv
 */
async function run(prompt, sessionFromArgv) {
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

  const wantsSession = !directives.some((d) => d.name === "no-session");
  const explicitSession = directives.find((d) => d.name === "session");
  if (wantsSession) {
    const id = explicitSession?.arg ?? sessionFromArgv ?? "fake-session-0001";
    emit({ type: "session", id });
  }

  if (directives.length === 0) {
    emit({ type: "text", text: "OK" });
    emit({ type: "usage", inputTokens: 10, outputTokens: 1 });
    emit({ type: "result", text: "OK" });
    return;
  }

  let toolSeq = 0;
  let emittedResult = false;
  const texts = [];

  for (const directive of directives) {
    switch (directive.name) {
      case "session":
      case "no-session":
        break;
      case "text":
        texts.push(directive.arg);
        emit({ type: "text", text: directive.arg });
        break;
      case "block": {
        const text = `<result>${directive.arg}</result>`;
        texts.push(text);
        emit({ type: "text", text });
        break;
      }
      case "tool":
      case "tool-fail": {
        toolSeq += 1;
        const id = `tool-${String(toolSeq)}`;
        const spaceIdx = directive.arg.indexOf(" ");
        const name = spaceIdx === -1 ? directive.arg : directive.arg.slice(0, spaceIdx);
        const args = spaceIdx === -1 ? "" : directive.arg.slice(spaceIdx + 1);
        emit({ type: "tool_call", id, name, args });
        emit({
          type: "tool_result",
          id,
          name,
          ok: directive.name === "tool",
          output: directive.name === "tool" ? "ok" : "falhou",
        });
        break;
      }
      case "usage": {
        const [input = "0", output = "0"] = directive.arg.split(/\s+/);
        emit({ type: "usage", inputTokens: Number(input), outputTokens: Number(output) });
        break;
      }
      case "stderr":
        process.stderr.write(`${directive.arg}\n`);
        break;
      case "denied":
        emit({ type: "permission_denied", tool: directive.arg });
        break;
      case "write": {
        // O agente falso escrevendo arquivo de verdade é o que prova o caminho
        // inteiro dos espólios: o worker lê o diff do worktree, não o stream.
        const espaco = directive.arg.indexOf(" ");
        const caminho = espaco === -1 ? directive.arg : directive.arg.slice(0, espaco);
        const conteudo = espaco === -1 ? "" : directive.arg.slice(espaco + 1);
        writeFileSync(resolve(process.cwd(), caminho), conteudo + "\n");
        break;
      }
      case "delete":
        rmSync(resolve(process.cwd(), directive.arg), { force: true });
        break;
      case "git": {
        // `stdio: "ignore"` engolia o erro do git, e um `git commit` que falha
        // por falta de identidade virava um Run bem-sucedido sem commit
        // nenhum — foi assim que o CI do Windows quebrou sem deixar pista. Um
        // agente de verdade também reporta quando um comando falha, então
        // reportar aqui é mais fiel, e não só mais fácil de depurar.
        const r = spawnSync("git", directive.arg.split(" ").filter(Boolean), {
          cwd: process.cwd(),
          encoding: "utf8",
        });
        if (r.status !== 0) {
          const detalhe = `${r.stderr ?? ""}${r.stdout ?? ""}`.trim() || String(r.error ?? "");
          process.stderr.write(`git ${directive.arg} falhou (${String(r.status)}): ${detalhe}\n`);
          emit({
            type: "tool_result",
            name: "git",
            ok: false,
            output: `git ${directive.arg} falhou (${String(r.status)}): ${detalhe}`,
          });
        }
        break;
      }
      case "sleep":
        await delay(Number(directive.arg) || 0);
        break;
      case "hang":
        // O timer é o que segura o event loop: uma promessa que nunca resolve
        // não impede o Node de sair, e o processo terminaria sozinho com
        // código 0 — o oposto do cenário. O runtime precisa ser quem termina.
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
        const child = spawn(process.execPath, [self, CHILD_MARKER], {
          stdio: "ignore",
          detached: false,
        });
        child.unref();
        emit({ type: "text", text: `neto ${String(child.pid)}` });
        break;
      }
      case "exit":
        process.exit(Number(directive.arg) || 0);
        break;
      case "error":
        emit({ type: "error", message: directive.arg });
        process.exit(1);
        break;
      case "result":
        emittedResult = true;
        emit({ type: "result", text: directive.arg });
        break;
      case "mcp": {
        toolSeq += 1;
        const id = `tool-${String(toolSeq)}`;
        const match = /^(\S+)\s+(\S+)(?:\s+([\s\S]+))?$/.exec(directive.arg.trim());
        const serverName = match?.[1] ?? "";
        const toolName = match?.[2] ?? "";
        const rawArgs = match?.[3]?.trim() ?? "";
        const name = `mcp__${serverName}__${toolName}`;
        emit({ type: "tool_call", id, name, args: rawArgs.length === 0 ? "{}" : rawArgs });
        try {
          const text = await callMcpTool(
            serverName,
            toolName,
            rawArgs.length === 0 ? {} : JSON.parse(rawArgs),
          );
          texts.push(text);
          emit({ type: "tool_result", id, name, ok: true, output: text });
          emit({ type: "text", text });
        } catch (error) {
          emit({ type: "tool_result", id, name, ok: false, output: String(error) });
        }
        break;
      }
      default:
        process.stderr.write(`diretiva desconhecida: ${directive.name}\n`);
        break;
    }
  }

  if (!emittedResult) {
    emit({ type: "result", text: texts.join("") });
  }
}

/**
 * Um cliente MCP mínimo: sobe o servidor configurado, faz o `initialize`, o
 * `tools/call`, e devolve o texto do primeiro bloco. Sem SDK de propósito — o
 * que se prova é que a configuração chegou, não a biblioteca.
 *
 * @param {string} serverName
 * @param {string} toolName
 * @param {Record<string, unknown>} toolArgs
 * @returns {Promise<string>}
 */
function callMcpTool(serverName, toolName, toolArgs) {
  const raw = readArgvValue("--mcp-config");
  if (raw === undefined) return Promise.reject(new Error("sem --mcp-config no argv"));
  /** @type {{ mcpServers?: Record<string, { command?: string; args?: string[] }> }} */
  const config = JSON.parse(raw);
  const server = config.mcpServers?.[serverName];
  if (server === undefined || server.command === undefined) {
    return Promise.reject(new Error(`servidor ${serverName} ausente em --mcp-config`));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(server.command, server.args ?? [], {
      stdio: ["pipe", "pipe", "inherit"],
      env: process.env,
    });
    let buffer = "";
    let nextId = 1;
    /** @type {Map<number, (message: any) => void>} */
    const pending = new Map();

    /** @param {string} method @param {unknown} params @returns {Promise<any>} */
    const request = (method, params) =>
      new Promise((resolveRequest) => {
        const id = nextId++;
        pending.set(id, resolveRequest);
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });

    child.on("error", reject);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line.length === 0) continue;
        try {
          const message = JSON.parse(line);
          const handler = typeof message.id === "number" ? pending.get(message.id) : undefined;
          if (handler !== undefined) {
            pending.delete(message.id);
            handler(message);
          }
        } catch {
          // Linha que não é JSON-RPC: ruído do servidor.
        }
      }
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("o servidor MCP não respondeu em 10 s"));
    }, 10_000);

    (async () => {
      await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "fake-agent", version: "0.0.0" },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );
      const response = await request("tools/call", { name: toolName, arguments: toolArgs });
      clearTimeout(timer);
      child.stdin.end();
      if (response.error !== undefined) {
        reject(new Error(response.error.message ?? "erro do servidor MCP"));
        return;
      }
      const block = response.result?.content?.[0];
      resolve(typeof block?.text === "string" ? block.text : JSON.stringify(response.result));
    })().catch((error) => {
      clearTimeout(timer);
      child.kill();
      reject(error);
    });
  });
}
