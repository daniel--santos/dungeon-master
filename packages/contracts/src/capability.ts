import { z } from "zod";

import { PreflightProblemSchema } from "./docker-preflight.js";
import { EnforcementLevelSchema, ExecutionModeSchema } from "./execution-profile.js";
import {
  HarnessCapabilitiesSchema,
  HarnessCapabilityKeySchema,
  HarnessKeySchema,
} from "./harness.js";
import { ProviderKindSchema } from "./provider.js";

/**
 * O relatório de capability matching (planejamento v0.4, Fase 8A; documento
 * técnico, seção 32).
 *
 * É o que sai de `matchCapabilities`, a função pura de `@dungeon-master/domain`
 * que compara o que o Loadout pede com o que o Harness declara. Cada código é
 * fixo e tem uma mensagem canônica: a API a devolve no preflight e no `409` de
 * `POST /runs`, e o Worker a grava como `Diagnostic` no diário do Run — um
 * texto só, escrito uma vez, e a interface reconhece pelo código.
 *
 * `BLOCKER` impede a partida; `WARNING` segue e fica registrado.
 */

export const CAPABILITY_ISSUE_CODE_VALUES = [
  "DOCKER_UNSUPPORTED",
  "HOST_UNSUPPORTED",
  "STRUCTURED_OUTPUT_REQUIRED",
  "MCP_UNSUPPORTED",
  "MODEL_SELECTION_UNSUPPORTED",
  "COMMAND_TOOLS_ADVISORY",
  "RESUME_UNSUPPORTED",
] as const;

export const CapabilityIssueCodeSchema = z.enum(CAPABILITY_ISSUE_CODE_VALUES).meta({
  id: "CapabilityIssueCode",
  description: "Código estável de um descompasso entre o Loadout e a matriz do Harness.",
});

export type CapabilityIssueCode = z.infer<typeof CapabilityIssueCodeSchema>;

export const CAPABILITY_ISSUE_SEVERITY_VALUES = ["BLOCKER", "WARNING"] as const;

export const CapabilityIssueSeveritySchema = z.enum(CAPABILITY_ISSUE_SEVERITY_VALUES).meta({
  id: "CapabilityIssueSeverity",
  description: "`BLOCKER` impede a partida; `WARNING` segue e vira `Diagnostic`.",
});

export type CapabilityIssueSeverity = z.infer<typeof CapabilityIssueSeveritySchema>;

export const CapabilityIssueSchema = z
  .object({
    code: CapabilityIssueCodeSchema,
    severity: CapabilityIssueSeveritySchema,
    capability: HarnessCapabilityKeySchema.describe("A capability que o Harness não declara."),
    message: z.string().describe("A mensagem canônica, em português, escrita pelo domínio."),
    causedBy: z
      .array(z.string())
      .describe(
        "O que no Loadout ou no pedido provocou o descompasso: nomes de servidores MCP, " +
          "de Tools, a chave do Model, o modo de execução.",
      ),
  })
  .meta({ id: "CapabilityIssue", description: "Um descompasso entre o pedido e o Harness." });

export type CapabilityIssue = z.infer<typeof CapabilityIssueSchema>;

export const CapabilityReportSchema = z
  .object({
    blockers: z.array(CapabilityIssueSchema).describe("Impedem a partida. Vazio é obrigatório."),
    warnings: z.array(CapabilityIssueSchema).describe("Seguem, registrados no diário do Run."),
  })
  .meta({
    id: "CapabilityReport",
    description: "O resultado do capability matching entre um Loadout e o Harness dele.",
  });

export type CapabilityReport = z.infer<typeof CapabilityReportSchema>;

// --------------------------------------------------------------------------
// O preflight de um Loadout
// --------------------------------------------------------------------------

/**
 * O que dá para saber sobre a credencial do Provider **sem chamar o modelo**.
 *
 * `ENV_KEY_PRESENT` é a variável nomeada em `authEnvKeys` existindo no
 * ambiente do processo da API; `CLI_AUTHENTICATED`/`CLI_NOT_AUTHENTICATED` é o
 * que o preflight da CLI respondeu, quando ele checa credencial; `NOT_REQUIRED`
 * é um Provider `LOCAL`; `UNKNOWN` é nenhuma das anteriores.
 */
export const PROVIDER_AUTH_STATUS_VALUES = [
  "ENV_KEY_PRESENT",
  "CLI_AUTHENTICATED",
  "CLI_NOT_AUTHENTICATED",
  "NOT_REQUIRED",
  "UNKNOWN",
] as const;

export const ProviderAuthStatusSchema = z.enum(PROVIDER_AUTH_STATUS_VALUES).meta({
  id: "ProviderAuthStatus",
  description: "O estado da credencial do Provider, sem nenhuma chamada ao modelo.",
});

export type ProviderAuthStatus = z.infer<typeof ProviderAuthStatusSchema>;

export const ProviderAuthSchema = z
  .object({
    providerId: z.uuid(),
    name: z.string(),
    kind: ProviderKindSchema,
    authEnvKeys: z.array(z.string()).describe("As variáveis que o Provider declara."),
    presentEnvKeys: z
      .array(z.string())
      .describe("As que existem no ambiente da API. Só os nomes: o valor nunca sai daqui."),
    status: ProviderAuthStatusSchema,
    docsUrl: z.string().nullable(),
  })
  .meta({ id: "ProviderAuth", description: "O Provider do Run e o estado da credencial dele." });

export type ProviderAuth = z.infer<typeof ProviderAuthSchema>;

export const CliPreflightSchema = z
  .object({
    mode: ExecutionModeSchema,
    adapterId: z.string().describe("Identificador do adapter, com o ambiente: `claude-code@host`."),
    installed: z.boolean(),
    version: z.string().nullable(),
    authenticated: z
      .boolean()
      .nullable()
      .describe("Resultado da checagem de credencial do adapter. Nulo quando ela não existe."),
    timedOut: z.boolean().describe("O adapter não respondeu dentro do teto."),
    problems: z.array(PreflightProblemSchema),
  })
  .meta({
    id: "CliPreflight",
    description: "O preflight da CLI do Harness, no modo do perfil, medido na chamada.",
  });

export type CliPreflight = z.infer<typeof CliPreflightSchema>;

export const LoadoutPreflightSchema = z
  .object({
    loadoutId: z.uuid(),
    loadoutVersion: z.number().int().positive(),
    checkedAt: z.iso.datetime().describe("Instante em que a checagem começou, em UTC."),
    durationMs: z.number().int().nonnegative(),
    harness: z.object({
      id: z.uuid(),
      key: HarnessKeySchema,
      name: z.string(),
      enabled: z.boolean(),
      capabilities: HarnessCapabilitiesSchema,
      installedVersion: z
        .string()
        .nullable()
        .describe("O que o Worker gravou no último preflight de boot."),
      checkedAt: z.iso.datetime().nullable(),
    }),
    executionProfile: z.object({
      id: z.uuid(),
      name: z.string(),
      mode: ExecutionModeSchema,
      enforcement: EnforcementLevelSchema,
      enabled: z.boolean(),
    }),
    model: z
      .object({ id: z.uuid(), key: z.string(), name: z.string() })
      .nullable()
      .describe("O Model efetivo: o do Loadout, ou o padrão do Harness."),
    provider: ProviderAuthSchema.nullable().describe(
      "O Provider do Model, ou o primeiro que declara o Harness. Nulo quando não há nenhum.",
    ),
    cli: CliPreflightSchema.nullable().describe(
      "Nulo quando a API não tem adapter registrado para o par Harness/modo.",
    ),
    docker: z
      .object({
        daemonReachable: z.boolean(),
        serverVersion: z.string().nullable(),
        imageName: z.string(),
        imagePresent: z.boolean(),
        problems: z.array(PreflightProblemSchema),
      })
      .nullable()
      .describe("Só em perfil `DOCKER`: daemon e imagem, medidos na chamada."),
    capabilities: CapabilityReportSchema,
    ready: z
      .boolean()
      .describe(
        "Sem blocker de capability, sem problema fatal de CLI, com Harness e perfil ligados.",
      ),
  })
  .meta({
    id: "LoadoutPreflight",
    description:
      "Tudo o que dá para saber antes de partir: matriz, CLI, credencial e o relatório de capabilities.",
  });

export type LoadoutPreflight = z.infer<typeof LoadoutPreflightSchema>;

export const LoadoutPreflightQuerySchema = z
  .object({
    executionProfileId: z
      .uuid()
      .optional()
      .describe("Sobrepõe o ExecutionProfile do Loadout, como `POST /runs` permite."),
    resume: z
      .enum(["true", "false"])
      .optional()
      .describe("`true` avalia a intenção de retomar uma sessão."),
  })
  .meta({ id: "LoadoutPreflightQuery" });

export type LoadoutPreflightQuery = z.infer<typeof LoadoutPreflightQuerySchema>;
