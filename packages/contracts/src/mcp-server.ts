import { z } from "zod";

import { PageQuerySchema, paginatedSchema } from "./pagination.js";

/**
 * McpServer: um servidor MCP do registro (planejamento v0.4, Fase 8A).
 *
 * Até a Fase 7 o servidor era um `McpServerRef` inline no Loadout, com o
 * comando numa string só. Aqui ele vira registro com forma: `STDIO` tem
 * comando e argumentos separados (um caminho com espaço sobrevive), `HTTP` tem
 * URL, e os dois têm `envKeys` — **só nomes** de variáveis de ambiente. O valor
 * nunca é gravado e nunca vai ao argv: quem o repassa é o Worker, pelo
 * ambiente do processo, a partir da allow-list do ExecutionProfile.
 *
 * O `knowledge` do Grimório nasce `builtIn`: o Worker é quem sabe subi-lo, e
 * apagá-lo do registro deixaria os Loadouts apontando para o nada.
 */

export const MCP_TRANSPORT_VALUES = ["STDIO", "HTTP"] as const;

export const McpTransportSchema = z
  .enum(MCP_TRANSPORT_VALUES)
  .meta({ id: "McpTransport", description: "Como o servidor MCP é alcançado." });

export type McpTransport = z.infer<typeof McpTransportSchema>;

/** Nome que toda CLI aceita como chave de servidor: minúsculas, dígitos, hífen e sublinhado. */
export const MCP_SERVER_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,62}$/;

/**
 * O nome canônico do servidor do Grimório, o único `builtIn`.
 *
 * É o mesmo `KNOWLEDGE_MCP_SERVER_NAME` de `@dungeon-master/knowledge-mcp`,
 * que o Worker registra; mora aqui também porque o registro (banco) precisa
 * dele e não pode importar o pacote do servidor sem fechar um ciclo.
 */
export const BUILT_IN_KNOWLEDGE_MCP_SERVER_NAME = "knowledge" as const;

/** Nome de variável de ambiente. Nunca `NOME=valor`. */
export const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]{0,127}$/;

export const MCP_SERVER_COMMAND_MAX_LENGTH = 1_000;
export const MCP_SERVER_ARG_MAX_LENGTH = 1_000;
export const MCP_SERVER_ARGS_MAX = 50;
export const MCP_SERVER_URL_MAX_LENGTH = 2_000;
export const MCP_SERVER_DESCRIPTION_MAX_LENGTH = 2_000;

export const McpServerNameSchema = z
  .string()
  .trim()
  .regex(
    MCP_SERVER_NAME_PATTERN,
    "O nome tem só letras minúsculas, dígitos, hífen e sublinhado, e começa por letra.",
  );

export const EnvKeySchema = z
  .string()
  .regex(ENV_KEY_PATTERN, "É o nome de uma variável de ambiente, nunca `NOME=valor`.");

export const EnvKeysSchema = z
  .array(EnvKeySchema)
  .max(50)
  .describe(
    "Nomes de variáveis que o servidor precisa enxergar. Só nomes; o valor fica no ambiente.",
  );

/**
 * Uma URL que não carrega credencial no `usuário:senha@`: ela iria inteira ao
 * argv. Por regex, e não por `new URL`: este pacote não carrega os tipos do
 * Node nem do DOM, e a autoridade de uma URL é o trecho antes do primeiro
 * `/`, `?` ou `#` — um `@` ali é userinfo.
 */
export function urlWithoutUserInfo(url: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(url);
}

export const McpServerUrlSchema = z
  .string()
  .trim()
  .max(MCP_SERVER_URL_MAX_LENGTH)
  .regex(/^https?:\/\//i, "A URL precisa começar por http:// ou https://.")
  .refine(urlWithoutUserInfo, {
    message: "A URL não pode carregar `usuário:senha@`: ela vai inteira à linha de comando.",
  })
  .describe("Endereço do servidor `HTTP`. Credenciais vão por `envKeys`, nunca na URL.");

const CommandSchema = z
  .string()
  .trim()
  .min(1)
  .max(MCP_SERVER_COMMAND_MAX_LENGTH)
  .describe("Executável do servidor `STDIO`, sem argumentos e sem shell.");

const ArgsSchema = z
  .array(z.string().max(MCP_SERVER_ARG_MAX_LENGTH))
  .max(MCP_SERVER_ARGS_MAX)
  .describe("Argumentos, um por posição. Nunca um segredo: o argv é público na máquina.");

const DescriptionSchema = z.string().max(MCP_SERVER_DESCRIPTION_MAX_LENGTH);

export const McpServerSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do servidor."),
    name: z.string().describe("Nome canônico, único por usuário. É a chave que a CLI registra."),
    transport: McpTransportSchema,
    command: z.string().nullable().describe("Só em `STDIO`."),
    args: z.array(z.string()).describe("Só em `STDIO`; vazio em `HTTP`."),
    url: z.string().nullable().describe("Só em `HTTP`."),
    envKeys: z.array(z.string()).describe("Nomes de variáveis de ambiente, nunca valores."),
    readOnly: z
      .boolean()
      .describe("O servidor só lê. É informação para quem monta o Loadout e para a interface."),
    builtIn: z
      .boolean()
      .describe(
        "Nasce com o sistema e o Worker sabe subi-lo (o `knowledge` do Grimório). Não se apaga.",
      ),
    description: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "McpServer", description: "Um servidor MCP do registro, com a forma de subi-lo." });

export type McpServer = z.infer<typeof McpServerSchema>;

const CreateStdioMcpServerSchema = z.object({
  transport: z.literal("STDIO"),
  name: McpServerNameSchema,
  command: CommandSchema,
  args: ArgsSchema.optional(),
  envKeys: EnvKeysSchema.optional(),
  readOnly: z.boolean().optional().describe("Padrão: `false`."),
  description: DescriptionSchema.nullish(),
});

const CreateHttpMcpServerSchema = z.object({
  transport: z.literal("HTTP"),
  name: McpServerNameSchema,
  url: McpServerUrlSchema,
  envKeys: EnvKeysSchema.optional(),
  readOnly: z.boolean().optional().describe("Padrão: `false`."),
  description: DescriptionSchema.nullish(),
});

export const CreateMcpServerSchema = z
  .discriminatedUnion("transport", [CreateStdioMcpServerSchema, CreateHttpMcpServerSchema])
  .meta({
    id: "CreateMcpServer",
    description: "Corpo de `POST /api/v1/mcp-servers`. A forma depende de `transport`.",
  });

export type CreateMcpServer = z.infer<typeof CreateMcpServerSchema>;

/**
 * `transport` não muda: trocar o transporte é apagar e criar. Num `builtIn` só
 * `description` é editável; o resto é do Worker.
 */
export const UpdateMcpServerSchema = z
  .object({
    name: McpServerNameSchema.optional(),
    command: CommandSchema.optional(),
    args: ArgsSchema.optional(),
    url: McpServerUrlSchema.optional(),
    envKeys: EnvKeysSchema.optional(),
    readOnly: z.boolean().optional(),
    description: DescriptionSchema.nullish(),
  })
  .meta({ id: "UpdateMcpServer", description: "Corpo de `PATCH /api/v1/mcp-servers/{id}`." });

export type UpdateMcpServer = z.infer<typeof UpdateMcpServerSchema>;

export const McpServerListQuerySchema = PageQuerySchema.meta({ id: "McpServerListQuery" });

export type McpServerListQuery = z.infer<typeof McpServerListQuerySchema>;

export const McpServerPageSchema = paginatedSchema(
  McpServerSchema,
  "McpServerPage",
  "Uma página de servidores MCP, em ordem alfabética.",
);

export type McpServerPage = z.infer<typeof McpServerPageSchema>;
