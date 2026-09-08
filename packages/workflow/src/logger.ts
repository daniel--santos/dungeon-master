/**
 * O mínimo de logger que este pacote usa.
 *
 * Casa com a forma do pino (`log.warn({ campos }, "mensagem")`) sem depender
 * dele: o motor de Workflow é infraestrutura pura e roda em teste sem nenhum
 * processo em volta. Todos os métodos são opcionais para que um objeto parcial
 * sirva de dublê.
 */
export interface WorkflowLogger {
  debug?: (fields: Record<string, unknown>, message: string) => void;
  info?: (fields: Record<string, unknown>, message: string) => void;
  warn?: (fields: Record<string, unknown>, message: string) => void;
  error?: (fields: Record<string, unknown>, message: string) => void;
}
