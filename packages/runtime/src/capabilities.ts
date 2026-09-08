/**
 * Matriz de capabilities (documento técnico, seção 32).
 *
 * Existe para que a aplicação nunca escreva `if (harness === "codex")`. A UI
 * habilita ou desabilita recurso lendo daqui, e o runtime recusa cedo um
 * pedido que o adapter não sustenta — com mensagem, em vez de silêncio.
 *
 * A regra de honestidade: uma capability é `true` só quando o adapter a
 * exercita de fato na suíte de contrato. `resume` do Sandcastle é derivado da
 * presença de storage de sessão no provider; aqui é derivado do adapter saber
 * montar o argv de retomada **e** capturar o id de sessão do stream. Prometer
 * o que não se cumpre é pior que dizer não.
 */

import type { HarnessCapabilities as HarnessCapabilitiesContract } from "@dungeon-master/contracts";
/**
 * A matriz do runtime é a de `@dungeon-master/contracts` mais um campo.
 *
 * Estender em vez de redeclarar: os onze campos do contrato são o que a API
 * expõe e o banco guarda, e uma segunda lista deles divergiria no primeiro
 * campo novo. `forkSession` ainda não está no contrato — o Claude Code tem
 * `--fork-session`, e retomar mutando a sessão é diferente de retomar criando
 * uma nova. Quando o contrato ganhar o campo, esta extensão some.
 */
export interface HarnessCapabilities extends HarnessCapabilitiesContract {
  /** Retoma criando uma sessão nova em vez de mutar a original (fork). */
  readonly forkSession: boolean;
  /**
   * Sobe servidores MCP declarados por Run, em modo headless (Fase 7).
   *
   * `true` só quando o adapter traduz `ExecutionRequest.mcpServers` para a
   * configuração da CLI **e** a suíte de contrato viu um `ToolCall` chegar ao
   * servidor. `false` faz o runtime avisar e seguir sem as ferramentas; nunca
   * falha o Run. Como `forkSession`, ainda não está no contrato da API — a
   * promoção é assunto da 7C, quando a tela de Equipamento quiser mostrá-la.
   */
  readonly mcpServers: boolean;
}

/**
 * Todas em `false`.
 *
 * Um adapter novo parte daqui e liga só o que provar na suíte de contrato, em
 * vez de partir de um objeto otimista e esquecer de desligar um campo.
 */
export const NO_CAPABILITIES: HarnessCapabilities = {
  streaming: false,
  structuredOutput: false,
  resume: false,
  forkSession: false,
  multiTurnProcess: false,
  toolEvents: false,
  tokenUsage: false,
  modelSelection: false,
  agentSelection: false,
  nativePermissions: false,
  hostExecution: false,
  dockerExecution: false,
  mcpServers: false,
};

/** Monta uma matriz a partir de {@link NO_CAPABILITIES}. */
export function capabilities(overrides: Partial<HarnessCapabilities>): HarnessCapabilities {
  return { ...NO_CAPABILITIES, ...overrides };
}
