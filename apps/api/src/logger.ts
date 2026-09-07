import { pino, type Logger } from "pino";

export interface CreateLoggerOptions {
  level?: string;
  /** Em desenvolvimento o log sai legível; em qualquer outro ambiente, JSON. */
  pretty?: boolean;
  name?: string;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const name = options.name ?? "dungeon-master-api";

  if (options.pretty) {
    return pino({
      name,
      level,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss.l",
          ignore: "pid,hostname",
        },
      },
    });
  }

  return pino({
    name,
    level,
    // Timestamps em UTC, como todo instante registrado pelo sistema.
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type { Logger };
