import { z } from "zod";

import { HarnessKeySchema } from "./harness.js";

/**
 * O preflight do backend Docker, exposto pela API (pendência da Fase 2.5D).
 *
 * Settings mostrava só o preflight das CLIs de host, que o Worker grava no
 * boot em `harness.installed_version`. O do container não tem onde ser
 * gravado — ele depende do daemon estar no ar **agora** — então a API o roda
 * sob demanda, na chamada, com teto curto, e devolve o resultado inteiro:
 * daemon, imagem e, por harness que sabe rodar em container, versão e
 * autenticação medidas lá dentro. Nunca roda no boot da API.
 */

/**
 * Os códigos de problema do preflight, os mesmos do runtime.
 *
 * O array mora aqui, e não em `@dungeon-master/runtime`, porque o runtime já
 * importa os contratos e a API precisa do enum para a spec; declarar os cinco
 * nos dois lugares deixaria as listas livres para divergir em silêncio.
 */
export const PREFLIGHT_PROBLEM_CODE_VALUES = [
  "NOT_INSTALLED",
  "VERSION_UNREADABLE",
  "NOT_AUTHENTICATED",
  "UNSUPPORTED_MODE",
  "UNSUPPORTED_PLATFORM",
] as const;

export const PreflightProblemCodeSchema = z.enum(PREFLIGHT_PROBLEM_CODE_VALUES).meta({
  id: "PreflightProblemCode",
  description: "Código estável de um problema encontrado no preflight.",
});

export type PreflightProblemCode = z.infer<typeof PreflightProblemCodeSchema>;

export const PreflightProblemSchema = z
  .object({
    code: PreflightProblemCodeSchema,
    message: z.string().describe("O que falta e como resolver, em português."),
    fatal: z.boolean().describe("Um problema fatal impede a execução; os demais viram aviso."),
  })
  .meta({ id: "PreflightProblem", description: "Um problema encontrado no preflight." });

export type PreflightProblem = z.infer<typeof PreflightProblemSchema>;

export const DockerHarnessPreflightSchema = z
  .object({
    harnessKey: HarnessKeySchema,
    adapterId: z
      .string()
      .describe("Identificador do adapter, com o ambiente: `claude-code@docker`."),
    installed: z.boolean().describe("A CLI respondeu dentro da imagem."),
    version: z
      .string()
      .nullable()
      .describe("Versão lida dentro do container. Nula quando ilegível."),
    authenticated: z
      .boolean()
      .nullable()
      .describe("Resultado da checagem de credencial. Nulo quando ela não é barata ou não existe."),
    timedOut: z
      .boolean()
      .describe("O adapter não respondeu dentro do teto; `installed` e `version` não valem."),
    problems: z.array(PreflightProblemSchema),
  })
  .meta({
    id: "DockerHarnessPreflight",
    description: "O preflight de um harness dentro do container: versão e credencial.",
  });

export type DockerHarnessPreflight = z.infer<typeof DockerHarnessPreflightSchema>;

export const DockerPreflightSchema = z
  .object({
    checkedAt: z.iso.datetime().describe("Instante em que a checagem começou, em UTC."),
    durationMs: z.number().int().nonnegative().describe("Quanto a checagem inteira levou."),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .describe("Teto por comando do cliente Docker e por harness. Fixo e curto."),
    daemon: z
      .object({
        reachable: z.boolean().describe("O daemon respondeu ao cliente."),
        serverVersion: z.string().nullable().describe("Versão do servidor. Nula sem daemon."),
      })
      .describe("O daemon do Docker."),
    image: z
      .object({
        name: z.string().describe("A imagem de referência que os Runs em container usam."),
        present: z.boolean().describe("A imagem existe nesta máquina."),
        user: z.string().nullable().describe("`USER` da imagem, que precisa bater com o worker."),
      })
      .describe("A imagem do agente."),
    problems: z
      .array(PreflightProblemSchema)
      .describe("Problemas de daemon e de imagem. Os de cada harness ficam no harness."),
    harnesses: z
      .array(DockerHarnessPreflightSchema)
      .describe(
        "Um por adapter de container registrado. Sem daemon ou sem imagem, nenhum é " +
          "verificado e todos saem com `installed: false`.",
      ),
  })
  .meta({
    id: "DockerPreflight",
    description: "O preflight do backend Docker, medido na chamada.",
  });

export type DockerPreflight = z.infer<typeof DockerPreflightSchema>;
