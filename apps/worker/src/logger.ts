import { pino, type Logger } from "pino";

export interface CreateLoggerOptions {
  level?: string;
  pretty?: boolean;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const name = "dungeon-master-worker";

  if (options.pretty) {
    return pino({
      name,
      level,
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" },
      },
    });
  }

  return pino({ name, level, timestamp: pino.stdTimeFunctions.isoTime });
}

export type { Logger };
