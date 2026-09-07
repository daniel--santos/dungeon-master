/**
 * O mínimo de logger que este pacote usa.
 *
 * Casa com a forma do pino (`log.warn({ campos }, "mensagem")`) sem depender
 * dele: `packages/events` é lógica pura e precisa rodar em teste sem nenhuma
 * infraestrutura. Todos os métodos são opcionais para que um objeto parcial
 * sirva de dublê.
 */
export interface EventsLogger {
  debug?: (fields: Record<string, unknown>, message: string) => void;
  info?: (fields: Record<string, unknown>, message: string) => void;
  warn?: (fields: Record<string, unknown>, message: string) => void;
  error?: (fields: Record<string, unknown>, message: string) => void;
}
