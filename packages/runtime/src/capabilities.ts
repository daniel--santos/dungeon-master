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
export interface HarnessCapabilities {
  /** Emite eventos incrementais enquanto trabalha, e não só no fim. */
  readonly streaming: boolean;
  /** Consegue produzir o bloco `<result>` validado por schema. */
  readonly structuredOutput: boolean;
  /** Retoma uma sessão anterior pelo `harnessSessionId`. */
  readonly resume: boolean;
  /** Retoma criando uma sessão nova em vez de mutar a original (fork). */
  readonly forkSession: boolean;
  /** Mantém um processo vivo por vários turnos. Nenhum adapter do host faz. */
  readonly multiTurnProcess: boolean;
  /** Traduz chamadas de ferramenta para `ToolCall`/`ToolResult`. */
  readonly toolEvents: boolean;
  /** Reporta consumo de tokens no próprio stream. */
  readonly tokenUsage: boolean;
  /** Aceita escolha de modelo por argumento. */
  readonly modelSelection: boolean;
  /** Aceita escolha de agente/persona por argumento. */
  readonly agentSelection: boolean;
  /** Tem mecanismo próprio de permissão (`HARNESS_NATIVE`). */
  readonly nativePermissions: boolean;
  /** Roda no host. */
  readonly hostExecution: boolean;
  /** Roda em container. Fase 2C; hoje nenhum adapter do host promete. */
  readonly dockerExecution: boolean;
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
};

/** Monta uma matriz a partir de {@link NO_CAPABILITIES}. */
export function capabilities(overrides: Partial<HarnessCapabilities>): HarnessCapabilities {
  return { ...NO_CAPABILITIES, ...overrides };
}
