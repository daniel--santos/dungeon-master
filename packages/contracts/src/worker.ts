import { z } from "zod";

import { HarnessAuthStatusSchema, HarnessKeySchema } from "./harness.js";

/**
 * Presença de Worker (planejamento v0.4, Fase 10A).
 *
 * Até a Fase 9 o Worker não tinha linha nenhuma no banco: a identidade dele
 * existia só como texto em `run.claimed_by`, e a reconciliação de partida
 * adivinhava se o dono de um Run estava vivo olhando o PID quando o host era o
 * mesmo (post-mortem #6). Isso nunca foi um lease — um Worker de outra máquina
 * era indistinguível de um morto.
 *
 * O batimento fecha essa pendência: cada processo grava uma linha em `worker`
 * no boot, renova `last_heartbeat_at` a cada intervalo e escreve `stopped_at`
 * no desligamento gracioso. A partir daí "este Run tem dono vivo?" é uma
 * pergunta que o banco responde, e a reconciliação deixa de ser só coisa de
 * partida: o Worker sobrevivente fecha, no tique, o que o colega morto deixou.
 */

/**
 * O estado calculado na leitura, nunca uma coluna.
 *
 * Gravar o estado exigiria que alguém escrevesse `STALE` no instante exato em
 * que o prazo vence — um job a mais para dizer o que a subtração de dois
 * instantes já diz. `stale_at` existe, mas é outra coisa: a marca de que a
 * transição já foi **anunciada**, para o evento sair uma vez só.
 */
export const WORKER_STATUS_VALUES = ["ONLINE", "STALE", "OFFLINE"] as const;

export const WorkerStatusSchema = z.enum(WORKER_STATUS_VALUES).meta({
  id: "WorkerStatus",
  description:
    "`ONLINE` bateu dentro do prazo; `STALE` não bate há mais de três intervalos e " +
    "não se despediu; `OFFLINE` desligou graciosamente.",
});

export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

/** Quantos intervalos de silêncio tornam um Worker `STALE`. */
export const WORKER_STALE_INTERVALS = 3 as const;

export const WorkerHarnessSchema = z
  .object({
    key: HarnessKeySchema,
    version: z.string().nullable().describe("A versão que a CLI respondeu no boot."),
    authStatus: HarnessAuthStatusSchema.nullable().describe("A credencial, como o boot a mediu."),
  })
  .meta({
    id: "WorkerHarness",
    description: "Um Harness como este Worker o mediu no boot, nesta máquina.",
  });

export type WorkerHarness = z.infer<typeof WorkerHarnessSchema>;

export const WorkerPresenceSchema = z
  .object({
    id: z
      .string()
      .describe("O `workerId` do processo, o mesmo que vai em `run.claimed_by`: `host#pid#uuid`."),
    hostname: z.string(),
    pid: z.number().int().positive(),
    version: z.string().describe("Versão da app do Worker."),
    nodeVersion: z.string(),
    capacity: z.number().int().positive().describe("Teto de Runs simultâneos deste processo."),
    harnesses: z.array(WorkerHarnessSchema),
    startedAt: z.iso.datetime(),
    lastHeartbeatAt: z.iso.datetime(),
    stoppedAt: z.iso.datetime().nullable().describe("Preenchido só no desligamento gracioso."),
    staleAt: z.iso
      .datetime()
      .nullable()
      .describe(
        "Quando a varredura anunciou o silêncio. É o que torna `worker.stale` idempotente.",
      ),
    status: WorkerStatusSchema,
    runningRuns: z
      .number()
      .int()
      .nonnegative()
      .describe("Runs em `PREPARING` ou `RUNNING` que ainda apontam para este Worker."),
  })
  .meta({
    id: "WorkerPresence",
    description: "Um processo de Worker e o que ele está sustentando.",
  });

export type WorkerPresence = z.infer<typeof WorkerPresenceSchema>;

export const WorkerListSchema = z.object({ items: z.array(WorkerPresenceSchema) }).meta({
  id: "WorkerList",
  description: "Os Workers conhecidos, dos vivos para os desligados.",
});

export type WorkerList = z.infer<typeof WorkerListSchema>;
