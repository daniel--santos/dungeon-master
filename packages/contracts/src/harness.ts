import { z } from "zod";

/**
 * Harness é a Guilda: o runtime/CLI que executa um agente (documento técnico,
 * seção 5.2). Agent, Harness e Model são três coisas diferentes de propósito —
 * o papel é independente da ferramenta, e a ferramenta é independente do modelo.
 *
 * O cadastro de Harness é **fechado**: as quatro linhas nascem no `db:seed` e a
 * aplicação nunca cria uma quinta. Um harness novo é código (um adapter), não
 * um registro; deixar o usuário inventar um harness produziria uma linha que
 * nenhum adapter sabe executar.
 */

export const HARNESS_KEY_VALUES = ["CLAUDE_CODE", "CODEX", "PI", "ANTIGRAVITY"] as const;

export const HarnessKeySchema = z
  .enum(HARNESS_KEY_VALUES)
  .meta({ id: "HarnessKey", description: "Qual CLI de agente executa o Run." });

export type HarnessKey = z.infer<typeof HarnessKeySchema>;

/**
 * A matriz de capabilities (documento técnico, seção 32).
 *
 * Existe para a interface e o orquestrador perguntarem "este harness sabe
 * retomar sessão?" em vez de escreverem `if (harness === "antigravity")`. Todo
 * campo é obrigatório: uma capability ausente seria lida como `false` em um
 * lugar e como "não sei" em outro.
 */
export const HarnessCapabilitiesSchema = z
  .object({
    streaming: z.boolean().describe("Emite saída incremental enquanto executa."),
    structuredOutput: z.boolean().describe("Aceita um schema e devolve JSON validado."),
    resume: z.boolean().describe("Retoma uma sessão anterior a partir de `harnessSessionId`."),
    multiTurnProcess: z.boolean().describe("Mantém um processo vivo por vários turnos."),
    toolEvents: z.boolean().describe("Publica chamadas de ferramenta como eventos."),
    tokenUsage: z.boolean().describe("Reporta consumo de tokens."),
    modelSelection: z.boolean().describe("Aceita escolher o modelo por parâmetro."),
    agentSelection: z.boolean().describe("Aceita escolher um sub-agente por parâmetro."),
    nativePermissions: z.boolean().describe("Tem mecanismo próprio de permissão."),
    hostExecution: z.boolean().describe("Roda no host, sem isolamento."),
    dockerExecution: z.boolean().describe("Roda dentro de container."),
  })
  .meta({
    id: "HarnessCapabilities",
    description: "O que este harness sabe fazer. Substitui condicionais por harness espalhados.",
  });

export type HarnessCapabilities = z.infer<typeof HarnessCapabilitiesSchema>;

export const HarnessSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do Harness."),
    key: HarnessKeySchema,
    name: z.string().describe("Nome exibido. Único por usuário junto com `key`."),
    enabled: z
      .boolean()
      .describe("Desligado some das listas de escolha, mas não some do histórico."),
    capabilities: HarnessCapabilitiesSchema,
    installedVersion: z.string().nullable().describe("Versão descoberta pelo preflight."),
    checkedAt: z.iso
      .datetime()
      .nullable()
      .describe("Último preflight, em UTC (ISO 8601). Nulo enquanto ninguém checou."),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Harness", description: "Um runtime de agente conhecido pelo sistema." });

export type Harness = z.infer<typeof HarnessSchema>;

/**
 * O único campo editável de um Harness.
 *
 * `capabilities` e `key` são do adapter, não do usuário: editar a matriz pela
 * API produziria uma promessa que o código não cumpre. `installedVersion` e
 * `checkedAt` são escritos pelo preflight.
 */
export const UpdateHarnessSchema = z
  .object({
    enabled: z.boolean().describe("Liga ou desliga o Harness para novas execuções."),
  })
  .meta({ id: "UpdateHarness", description: "Corpo de `PATCH /api/v1/harnesses/{id}`." });

export type UpdateHarness = z.infer<typeof UpdateHarnessSchema>;

export const HarnessListSchema = z
  .object({
    items: z.array(HarnessSchema).describe("Os Harnesses conhecidos, na ordem do catálogo."),
  })
  .meta({ id: "HarnessList", description: "O cadastro fechado de Harnesses." });

export type HarnessList = z.infer<typeof HarnessListSchema>;

// --------------------------------------------------------------------------
// Model
// --------------------------------------------------------------------------

/**
 * Model é o Patrono: o LLM que o harness usa (documento técnico, seção 5.2).
 *
 * Pertence a um Harness porque a chave é do vocabulário dele — o mesmo modelo
 * tem nomes diferentes em CLIs diferentes, e uma tabela global de modelos
 * obrigaria a traduzir na hora de executar.
 */
export const MODEL_KEY_MAX_LENGTH = 200;
export const MODEL_NAME_MAX_LENGTH = 200;

const ModelKeySchema = z.string().trim().min(1).max(MODEL_KEY_MAX_LENGTH);
const ModelNameSchema = z.string().trim().min(1).max(MODEL_NAME_MAX_LENGTH);

export const ModelSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do Model."),
    harnessId: z.uuid().describe("Harness dono da chave."),
    key: z.string().describe("Identificador que o harness aceita na linha de comando."),
    name: z.string().describe("Nome exibido."),
    isDefault: z.boolean().describe("Escolhido quando o Loadout não indica um Model."),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Model", description: "Um modelo aceito por um Harness." });

export type Model = z.infer<typeof ModelSchema>;

export const CreateModelSchema = z
  .object({
    harnessId: z.uuid().describe("Harness dono da chave."),
    key: ModelKeySchema.describe("Identificador aceito pelo harness. Único dentro do Harness."),
    name: ModelNameSchema,
    isDefault: z
      .boolean()
      .optional()
      .describe("Marcar como padrão desmarca o padrão anterior do mesmo Harness."),
  })
  .meta({ id: "CreateModel", description: "Corpo de `POST /api/v1/models`." });

export type CreateModel = z.infer<typeof CreateModelSchema>;

export const UpdateModelSchema = z
  .object({
    key: ModelKeySchema.optional(),
    name: ModelNameSchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .meta({ id: "UpdateModel", description: "Corpo de `PATCH /api/v1/models/{id}`." });

export type UpdateModel = z.infer<typeof UpdateModelSchema>;

export const ModelListQuerySchema = z
  .object({
    harnessId: z.uuid().optional().describe("Só os Models deste Harness."),
  })
  .meta({ id: "ModelListQuery" });

export type ModelListQuery = z.infer<typeof ModelListQuerySchema>;

export const ModelListSchema = z
  .object({
    items: z.array(ModelSchema).describe("Os Models, agrupados por Harness e ordenados por nome."),
  })
  .meta({ id: "ModelList", description: "O cadastro de Models." });

export type ModelList = z.infer<typeof ModelListSchema>;
