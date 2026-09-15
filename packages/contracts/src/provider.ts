import { z } from "zod";

import { CurrencySchema, NullableBillingKindSchema } from "./billing.js";
import { HarnessKeySchema } from "./harness.js";
import { EnvKeysSchema } from "./mcp-server.js";
import { PageQuerySchema, paginatedSchema } from "./pagination.js";

/**
 * Provider: quem serve os modelos (planejamento v0.4, Fase 8A).
 *
 * Existe para o preflight responder "há credencial para este Run?" sem chamar
 * modelo nenhum. O que o registro guarda é a forma da autenticação — por
 * assinatura da CLI, por chave de API ou local — e **os nomes** das variáveis
 * de ambiente que a carregam. O valor nunca é gravado: o preflight só olha se
 * a variável existe no ambiente do processo da API.
 */

export const PROVIDER_KIND_VALUES = ["SUBSCRIPTION", "API_KEY", "LOCAL"] as const;

export const ProviderKindSchema = z.enum(PROVIDER_KIND_VALUES).meta({
  id: "ProviderKind",
  description:
    "`SUBSCRIPTION` autentica pela CLI (login); `API_KEY` por variável de ambiente; " +
    "`LOCAL` não autentica.",
});

export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const PROVIDER_NAME_MAX_LENGTH = 200;
export const PROVIDER_DOCS_URL_MAX_LENGTH = 2_000;

const NameSchema = z.string().trim().min(1).max(PROVIDER_NAME_MAX_LENGTH);
const DocsUrlSchema = z
  .string()
  .trim()
  .max(PROVIDER_DOCS_URL_MAX_LENGTH)
  .regex(/^https?:\/\//i, "A URL precisa começar por http:// ou https://.");

export const ProviderSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do Provider."),
    name: z.string().describe("Nome do Provider. Único por usuário."),
    kind: ProviderKindSchema,
    authEnvKeys: z
      .array(z.string())
      .describe("Nomes das variáveis que carregam a credencial. Qualquer uma presente basta."),
    harnessKeys: z.array(HarnessKeySchema).describe("Os Harnesses que usam este Provider."),
    docsUrl: z.string().nullable().describe("Onde está explicado como autenticar."),
    billingKind: NullableBillingKindSchema.describe(
      "Como o Provider **cobra** (Fase 10A). Não é o mesmo que `kind`, que diz " +
        "como ele **autentica**: uma CLI por login pode cobrar por token, e uma " +
        "chave de API pode vir de um plano fixo. Nulo é desconhecido, e desconhecido " +
        "faz o custo sair `NOT_MEASURED` em vez de zero.",
    ),
    monthlyCost: z
      .number()
      .nullable()
      .describe("A mensalidade, em `currency`. Só faz sentido em `SUBSCRIPTION`."),
    currency: z.string().nullable().describe("ISO 4217 da mensalidade."),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Provider", description: "Quem serve os modelos, como se autentica e como cobra." });

export type Provider = z.infer<typeof ProviderSchema>;

export const CreateProviderSchema = z
  .object({
    name: NameSchema,
    kind: ProviderKindSchema,
    authEnvKeys: EnvKeysSchema.optional().describe("Padrão: nenhuma."),
    harnessKeys: z.array(HarnessKeySchema).optional().describe("Padrão: nenhum."),
    docsUrl: DocsUrlSchema.nullish(),
  })
  .meta({ id: "CreateProvider", description: "Corpo de `POST /api/v1/providers`." });

export type CreateProvider = z.infer<typeof CreateProviderSchema>;

export const UpdateProviderSchema = z
  .object({
    name: NameSchema.optional(),
    kind: ProviderKindSchema.optional(),
    authEnvKeys: EnvKeysSchema.optional(),
    harnessKeys: z.array(HarnessKeySchema).optional(),
    docsUrl: DocsUrlSchema.nullish(),
    billingKind: NullableBillingKindSchema.optional().describe("`null` volta a ser desconhecido."),
    monthlyCost: z
      .number()
      .nonnegative()
      .max(1_000_000)
      .nullish()
      .describe("A mensalidade. Exige `currency` e só é aceita em `SUBSCRIPTION`."),
    currency: CurrencySchema.nullish(),
  })
  // Uma mensalidade sem moeda é um número sem unidade. A regra vive aqui, e não
  // só no `CHECK` da tabela, para o usuário receber um `422` com o campo em vez
  // de um `500` vindo do banco.
  .refine((patch) => patch.monthlyCost == null || patch.currency != null, {
    message: "Uma mensalidade precisa vir com a moeda (`currency`).",
    path: ["currency"],
  })
  .meta({ id: "UpdateProvider", description: "Corpo de `PATCH /api/v1/providers/{id}`." });

export type UpdateProvider = z.infer<typeof UpdateProviderSchema>;

export const ProviderListQuerySchema = PageQuerySchema.extend({
  harnessKey: HarnessKeySchema.optional().describe("Só os Providers que este Harness usa."),
}).meta({ id: "ProviderListQuery" });

export type ProviderListQuery = z.infer<typeof ProviderListQuerySchema>;

export const ProviderPageSchema = paginatedSchema(
  ProviderSchema,
  "ProviderPage",
  "Uma página de Providers, em ordem alfabética.",
);

export type ProviderPage = z.infer<typeof ProviderPageSchema>;
