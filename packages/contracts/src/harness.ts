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
    forkSession: z
      .boolean()
      .describe("Retoma criando uma sessão nova em vez de mutar a original (fork)."),
    multiTurnProcess: z.boolean().describe("Mantém um processo vivo por vários turnos."),
    toolEvents: z.boolean().describe("Publica chamadas de ferramenta como eventos."),
    tokenUsage: z.boolean().describe("Reporta consumo de tokens."),
    modelSelection: z.boolean().describe("Aceita escolher o modelo por parâmetro."),
    agentSelection: z.boolean().describe("Aceita escolher um sub-agente por parâmetro."),
    nativePermissions: z.boolean().describe("Tem mecanismo próprio de permissão."),
    hostExecution: z.boolean().describe("Roda no host, sem isolamento."),
    dockerExecution: z.boolean().describe("Roda dentro de container."),
    /**
     * As duas últimas chegaram ao contrato na Fase 8A. Elas já existiam na
     * matriz do runtime desde a Fase 7 (`mcpServers`) e a Fase 2 (`forkSession`),
     * e o preflight do Worker as gravava em `harness.capabilities`; o contrato é
     * quem faltava, e sem ele o capability matching teria que adivinhar.
     */
    mcpServers: z
      .boolean()
      .describe("Sobe os servidores MCP declarados por Run, em modo headless (Fase 7)."),
  })
  .meta({
    id: "HarnessCapabilities",
    description: "O que este harness sabe fazer. Substitui condicionais por harness espalhados.",
  });

/**
 * As chaves da matriz, na ordem do contrato.
 *
 * Escritas por extenso, e não derivadas de `Object.keys(shape)`, porque o
 * relatório de capabilities as usa como enum na spec OpenAPI, e um enum precisa
 * de uma tupla literal. O `satisfies` prende a lista ao schema num sentido; o
 * teste de contratos prende no outro (nenhuma chave do schema fora da lista).
 */
export const HARNESS_CAPABILITY_KEY_VALUES = [
  "streaming",
  "structuredOutput",
  "resume",
  "forkSession",
  "multiTurnProcess",
  "toolEvents",
  "tokenUsage",
  "modelSelection",
  "agentSelection",
  "nativePermissions",
  "hostExecution",
  "dockerExecution",
  "mcpServers",
] as const satisfies readonly (keyof z.infer<typeof HarnessCapabilitiesSchema>)[];

export const HarnessCapabilityKeySchema = z.enum(HARNESS_CAPABILITY_KEY_VALUES).meta({
  id: "HarnessCapabilityKey",
  description: "Uma das chaves de `HarnessCapabilities`.",
});

export type HarnessCapabilityKey = z.infer<typeof HarnessCapabilityKeySchema>;

export type HarnessCapabilities = z.infer<typeof HarnessCapabilitiesSchema>;

/**
 * O estado da credencial da CLI **nesta máquina**, medido pelo Worker no boot
 * (planejamento v0.4, Fase 8B).
 *
 * É o que cada adapter consegue saber barato e sem chamar modelo: `claude auth
 * status`, `codex login status`, `pi auth check --json`, `agy models`. `UNKNOWN`
 * é a resposta honesta quando a checagem não existe, não respondeu ou a CLI não
 * está instalada; um `NOT_AUTHENTICATED` sem prova travaria Runs que
 * funcionariam. Difere de `ProviderAuthStatus`, que é sobre o Provider do
 * Model e inclui a variável de ambiente presente na API.
 */
export const HARNESS_AUTH_STATUS_VALUES = [
  "AUTHENTICATED",
  "NOT_AUTHENTICATED",
  "UNKNOWN",
] as const;

export const HarnessAuthStatusSchema = z.enum(HARNESS_AUTH_STATUS_VALUES).meta({
  id: "HarnessAuthStatus",
  description:
    "O que a CLI do Harness respondeu sobre a credencial dela no último preflight de boot " +
    "do Worker. `UNKNOWN` quando não há checagem barata ou ela não respondeu.",
});

export type HarnessAuthStatus = z.infer<typeof HarnessAuthStatusSchema>;

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
    /**
     * Os três campos de autenticação são opcionais no contrato só porque a
     * interface (8C) e as fixtures dela ainda não os conhecem; a API sempre os
     * devolve, nulos enquanto nenhum Worker mediu. A 8C pode torná-los
     * obrigatórios ao acompanhar.
     */
    authStatus: HarnessAuthStatusSchema.nullable()
      .optional()
      .describe("A credencial da CLI nesta máquina, pelo último boot do Worker."),
    authCheckedAt: z.iso
      .datetime()
      .nullable()
      .optional()
      .describe("Quando a credencial foi medida, em UTC. Nulo enquanto nenhum Worker mediu."),
    authReason: z
      .string()
      .nullable()
      .optional()
      .describe("Como o estado foi medido, numa frase sem segredo: o comando e o que respondeu."),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Harness", description: "Um runtime de agente conhecido pelo sistema." });

export type Harness = z.infer<typeof HarnessSchema>;

/**
 * O único campo editável de um Harness.
 *
 * `capabilities` e `key` são do adapter, não do usuário: editar a matriz pela
 * API produziria uma promessa que o código não cumpre. `installedVersion`,
 * `checkedAt` e os campos `auth*` são escritos pelo preflight do Worker.
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
    providerId: z
      .uuid()
      .nullable()
      .describe(
        "Provider que serve o modelo (Fase 8A). Nulo quando ninguém o associou; o preflight " +
          "então procura um Provider pelo Harness.",
      ),
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
    providerId: z.uuid().nullish().describe("Provider que serve o modelo. Padrão: nenhum."),
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
    providerId: z.uuid().nullish().describe("`null` desassocia o Provider."),
    key: ModelKeySchema.optional(),
    name: ModelNameSchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .meta({ id: "UpdateModel", description: "Corpo de `PATCH /api/v1/models/{id}`." });

export type UpdateModel = z.infer<typeof UpdateModelSchema>;

export const ModelListQuerySchema = z
  .object({
    harnessId: z.uuid().optional().describe("Só os Models deste Harness."),
    providerId: z.uuid().optional().describe("Só os Models deste Provider."),
  })
  .meta({ id: "ModelListQuery" });

export type ModelListQuery = z.infer<typeof ModelListQuerySchema>;

export const ModelListSchema = z
  .object({
    items: z.array(ModelSchema).describe("Os Models, agrupados por Harness e ordenados por nome."),
  })
  .meta({ id: "ModelList", description: "O cadastro de Models." });

export type ModelList = z.infer<typeof ModelListSchema>;
