/**
 * O mínimo de logger que este pacote usa.
 *
 * Casa com a forma do pino (`log.warn({ campos }, "mensagem")`) sem depender
 * dele: `packages/runs` é domínio de execução puro e roda em teste sem nenhuma
 * infraestrutura. Todos os métodos são opcionais para que um objeto parcial
 * sirva de dublê.
 */
export interface RunsLogger {
  debug?: (fields: Record<string, unknown>, message: string) => void;
  info?: (fields: Record<string, unknown>, message: string) => void;
  warn?: (fields: Record<string, unknown>, message: string) => void;
  error?: (fields: Record<string, unknown>, message: string) => void;
}
