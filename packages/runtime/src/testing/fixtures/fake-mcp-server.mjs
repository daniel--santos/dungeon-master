// @ts-check
/**
 * Servidor MCP falso: JSON-RPC por linha no stdio, sem dependência nenhuma.
 *
 * Serve à suíte de contrato de harness: um adapter com `mcpServers: true`
 * precisa provar que a configuração que ele monta faz a CLI **subir** este
 * processo e **chamar** a ferramenta. O servidor expõe uma ferramenta só,
 * `echo_marker`, que devolve o marcador recebido no argv — assim o teste sabe
 * que a resposta veio deste processo, e não de uma alucinação do modelo.
 *
 * Roda no host (`node fake-mcp-server.mjs --marker X`) e dentro do container
 * da imagem do agente, montado read-only: é um arquivo só, como o servidor do
 * Grimório de verdade.
 */

const args = process.argv.slice(2);
const markerIndex = args.indexOf("--marker");
const marker = markerIndex === -1 ? "sem-marcador" : (args[markerIndex + 1] ?? "sem-marcador");

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line.length === 0) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    handle(message);
  }
});
process.stdin.on("end", () => process.exit(0));

/** @param {unknown} message */
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/** @param {{ id?: unknown; method?: string; params?: { name?: string; protocolVersion?: string } }} message */
function handle(message) {
  switch (message.method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fake", version: "0.0.0" },
        },
      });
      return;
    case "notifications/initialized":
      return;
    case "ping":
      send({ jsonrpc: "2.0", id: message.id, result: {} });
      return;
    case "tools/list":
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: [
            {
              name: "echo_marker",
              description: "Devolve o marcador desta execução. Use quando pedirem o marcador.",
              inputSchema: { type: "object", properties: {}, additionalProperties: false },
              annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
              },
            },
          ],
        },
      });
      return;
    case "tools/call":
      if (message.params?.name === "echo_marker") {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text: `marcador: ${marker}` }] },
        });
      } else {
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32602,
            message: `ferramenta desconhecida: ${String(message.params?.name)}`,
          },
        });
      }
      return;
    default:
      if (message.id !== undefined) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: `método desconhecido: ${String(message.method)}` },
        });
      }
  }
}
