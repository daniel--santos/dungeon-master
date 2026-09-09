import {
  AgentListSchema,
  AgentSchema,
  CreateAgentSchema,
  CreateExecutionProfileSchema,
  CreateLoadoutSchema,
  CreateModelSchema,
  ExecutionProfileListSchema,
  ExecutionProfileSchema,
  HarnessListSchema,
  HarnessSchema,
  LoadoutListSchema,
  LoadoutPreflightQuerySchema,
  LoadoutPreflightSchema,
  LoadoutSchema,
  LoadoutVersionListQuerySchema,
  LoadoutVersionPageSchema,
  ModelListQuerySchema,
  ModelListSchema,
  ModelSchema,
  ProblemDetailsSchema,
  UpdateAgentSchema,
  UpdateExecutionProfileSchema,
  UpdateHarnessSchema,
  UpdateLoadoutSchema,
  UpdateModelSchema,
} from "@dungeon-master/contracts";
import { createRoute, z } from "@hono/zod-openapi";

import { API_BASE_PATH } from "../config.js";
import { PROBLEM_CONTENT_TYPE } from "../problem.js";

/**
 * Os cadastros de execução: Harness, Model, Agent, ExecutionProfile e Loadout.
 *
 * Nenhum deles é paginado. São cadastros de um sistema pessoal — quatro
 * harnesses, alguns modelos, um punhado de agentes e equipamentos —, e paginar
 * uma lista que cabe numa tela custaria um paginador em cinco telas para
 * resolver um problema que não existe. Quando existir, a paginação entra pelo
 * mesmo `PageQuerySchema` das outras listagens.
 */

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemDetailsSchema } },
});

export const IdParamSchema = z.object({
  id: z.uuid().describe("UUIDv7 do registro."),
});

export const LoadoutVersionParamSchema = z.object({
  id: z.uuid().describe("UUIDv7 do Loadout."),
  version: z
    .string()
    .regex(/^[1-9]\d{0,8}$/, "A versão é um inteiro positivo em base decimal.")
    .describe("O número da versão a restaurar."),
});

// ------------------------------------------------------------------ harnesses

export const harnessesListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/harnesses`,
  tags: ["execution"],
  summary: "Lista os Harnesses",
  description:
    "Cadastro fechado: as quatro guildas nascem no `db:seed` e a API não cria " +
    "nem apaga. Um harness novo é um adapter novo, não um registro. A ordem é " +
    "a do catálogo (Claude Code, Codex, Pi, Antigravity), não a alfabética.",
  responses: {
    200: {
      description: "Os Harnesses conhecidos.",
      content: { "application/json": { schema: HarnessListSchema } },
    },
  },
});

export const harnessesUpdateRoute = createRoute({
  method: "patch",
  path: `${API_BASE_PATH}/harnesses/{id}`,
  tags: ["execution"],
  summary: "Liga ou desliga o Harness",
  description:
    "Único campo editável. `capabilities` e `key` são do adapter: editá-los " +
    "pela API produziria uma promessa que o código não cumpre.",
  request: {
    params: IdParamSchema,
    body: { required: true, content: { "application/json": { schema: UpdateHarnessSchema } } },
  },
  responses: {
    200: {
      description: "O Harness depois da mudança.",
      content: { "application/json": { schema: HarnessSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe Harness com este id."),
  },
});

// --------------------------------------------------------------------- models

export const modelsListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/models`,
  tags: ["execution"],
  summary: "Lista os Models",
  request: { query: ModelListQuerySchema },
  responses: {
    200: {
      description: "Os Models, agrupados por Harness.",
      content: { "application/json": { schema: ModelListSchema } },
    },
    400: problem("Filtro inválido."),
  },
});

export const modelsCreateRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/models`,
  tags: ["execution"],
  summary: "Cria um Model",
  description:
    "A chave é única dentro do Harness. Marcar como padrão desmarca o padrão " +
    "anterior do mesmo Harness, em vez de recusar.",
  request: {
    body: { required: true, content: { "application/json": { schema: CreateModelSchema } } },
  },
  responses: {
    201: {
      description: "Model criado.",
      content: { "application/json": { schema: ModelSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("O Harness informado não existe."),
    409: problem("Já existe um Model com esta chave no Harness."),
  },
});

export const modelsUpdateRoute = createRoute({
  method: "patch",
  path: `${API_BASE_PATH}/models/{id}`,
  tags: ["execution"],
  summary: "Edita o Model",
  request: {
    params: IdParamSchema,
    body: { required: true, content: { "application/json": { schema: UpdateModelSchema } } },
  },
  responses: {
    200: {
      description: "O Model depois da edição.",
      content: { "application/json": { schema: ModelSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe Model com este id."),
    409: problem("A chave já é usada por outro Model do mesmo Harness."),
  },
});

export const modelsDeleteRoute = createRoute({
  method: "delete",
  path: `${API_BASE_PATH}/models/{id}`,
  tags: ["execution"],
  summary: "Apaga o Model",
  description:
    "Recusa enquanto algum Loadout aponta para ele: apagar faria o Loadout " +
    "passar a usar em silêncio o Model padrão do Harness.",
  request: { params: IdParamSchema },
  responses: {
    204: { description: "Model apagado." },
    404: problem("Não existe Model com este id."),
    409: problem("Algum Loadout ainda usa este Model."),
  },
});

// --------------------------------------------------------------------- agents

export const agentsListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/agents`,
  tags: ["execution"],
  summary: "Lista os Agents",
  responses: {
    200: {
      description: "Os Agents, em ordem alfabética.",
      content: { "application/json": { schema: AgentListSchema } },
    },
  },
});

export const agentsGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/agents/{id}`,
  tags: ["execution"],
  summary: "Um Agent",
  request: { params: IdParamSchema },
  responses: {
    200: { description: "O Agent.", content: { "application/json": { schema: AgentSchema } } },
    404: problem("Não existe Agent com este id."),
  },
});

export const agentsCreateRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/agents`,
  tags: ["execution"],
  summary: "Cria um Agent",
  description: "O nome é único por usuário. As instruções são o texto do papel.",
  request: {
    body: { required: true, content: { "application/json": { schema: CreateAgentSchema } } },
  },
  responses: {
    201: { description: "Agent criado.", content: { "application/json": { schema: AgentSchema } } },
    400: problem("Corpo inválido."),
    409: problem("Já existe um Agent com este nome."),
  },
});

export const agentsUpdateRoute = createRoute({
  method: "patch",
  path: `${API_BASE_PATH}/agents/{id}`,
  tags: ["execution"],
  summary: "Edita o Agent",
  request: {
    params: IdParamSchema,
    body: { required: true, content: { "application/json": { schema: UpdateAgentSchema } } },
  },
  responses: {
    200: {
      description: "O Agent depois da edição.",
      content: { "application/json": { schema: AgentSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe Agent com este id."),
    409: problem("Já existe um Agent com este nome."),
  },
});

export const agentsDeleteRoute = createRoute({
  method: "delete",
  path: `${API_BASE_PATH}/agents/{id}`,
  tags: ["execution"],
  summary: "Apaga o Agent",
  description:
    "Recusa enquanto algum Loadout o usa. Runs antigos não impedem: o snapshot " +
    "deles já carrega o Agent inteiro, e é para isso que ele carrega.",
  request: { params: IdParamSchema },
  responses: {
    204: { description: "Agent apagado." },
    404: problem("Não existe Agent com este id."),
    409: problem("Algum Loadout ainda usa este Agent."),
  },
});

// ---------------------------------------------------------- execution profiles

export const executionProfilesListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/execution-profiles`,
  tags: ["execution"],
  summary: "Lista os ExecutionProfiles",
  description:
    "`mode` e `workspaceStrategy` são eixos ortogonais: worktree não é backend " +
    "de execução. `enforcement` diz quão forte é a barreira, e a interface " +
    "nunca mostra política pedida como política imposta.",
  responses: {
    200: {
      description: "Os perfis, em ordem alfabética.",
      content: { "application/json": { schema: ExecutionProfileListSchema } },
    },
  },
});

export const executionProfilesGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/execution-profiles/{id}`,
  tags: ["execution"],
  summary: "Um ExecutionProfile",
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: "O perfil.",
      content: { "application/json": { schema: ExecutionProfileSchema } },
    },
    404: problem("Não existe ExecutionProfile com este id."),
  },
});

export const executionProfilesCreateRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/execution-profiles`,
  tags: ["execution"],
  summary: "Cria um ExecutionProfile",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: CreateExecutionProfileSchema } },
    },
  },
  responses: {
    201: {
      description: "Perfil criado.",
      content: { "application/json": { schema: ExecutionProfileSchema } },
    },
    400: problem("Corpo inválido."),
    409: problem("Já existe um perfil com este nome."),
  },
});

export const executionProfilesUpdateRoute = createRoute({
  method: "patch",
  path: `${API_BASE_PATH}/execution-profiles/{id}`,
  tags: ["execution"],
  summary: "Edita o ExecutionProfile",
  request: {
    params: IdParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: UpdateExecutionProfileSchema } },
    },
  },
  responses: {
    200: {
      description: "O perfil depois da edição.",
      content: { "application/json": { schema: ExecutionProfileSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Não existe ExecutionProfile com este id."),
    409: problem("Já existe um perfil com este nome."),
  },
});

export const executionProfilesDeleteRoute = createRoute({
  method: "delete",
  path: `${API_BASE_PATH}/execution-profiles/{id}`,
  tags: ["execution"],
  summary: "Apaga o ExecutionProfile",
  request: { params: IdParamSchema },
  responses: {
    204: { description: "Perfil apagado." },
    404: problem("Não existe ExecutionProfile com este id."),
    409: problem("Algum Loadout ainda usa este perfil."),
  },
});

// ------------------------------------------------------------------- loadouts

export const loadoutsListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/loadouts`,
  tags: ["execution"],
  summary: "Lista os Loadouts",
  responses: {
    200: {
      description: "Os Loadouts, em ordem alfabética.",
      content: { "application/json": { schema: LoadoutListSchema } },
    },
  },
});

export const loadoutsGetRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/loadouts/{id}`,
  tags: ["execution"],
  summary: "Um Loadout",
  request: { params: IdParamSchema },
  responses: {
    200: { description: "O Loadout.", content: { "application/json": { schema: LoadoutSchema } } },
    404: problem("Não existe Loadout com este id."),
  },
});

export const loadoutsCreateRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/loadouts`,
  tags: ["execution"],
  summary: "Cria um Loadout",
  description:
    "Nasce em `version: 1`. Agent, Harness e ExecutionProfile precisam existir e estar ligados. " +
    "Skills, Tools e servidores MCP entram por referência (`skillRefs`, `toolIds`, " +
    "`mcpServerIds`) ou na forma curta (`skills`, `tools`, `mcpServers`), resolvida pelo nome; " +
    "as duas formas na mesma coleção são recusadas.",
  request: {
    body: { required: true, content: { "application/json": { schema: CreateLoadoutSchema } } },
  },
  responses: {
    201: {
      description: "Loadout criado.",
      content: { "application/json": { schema: LoadoutSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("Alguma das referências informadas não existe."),
    409: problem(
      "Nome já usado, Harness ou perfil desligado, Model de outro Harness, pin para versão " +
        "inexistente, ou as duas formas de referência na mesma coleção.",
    ),
  },
});

export const loadoutsUpdateRoute = createRoute({
  method: "patch",
  path: `${API_BASE_PATH}/loadouts/{id}`,
  tags: ["execution"],
  summary: "Edita o Loadout e incrementa a versão",
  description:
    "Toda edição que muda alguma coisa sobe `version`. Um PATCH que não muda " +
    "nada não sobe: a versão conta edições, e enviar os mesmos valores não é " +
    "uma edição. O Run guarda a versão junto do snapshot.",
  request: {
    params: IdParamSchema,
    body: { required: true, content: { "application/json": { schema: UpdateLoadoutSchema } } },
  },
  responses: {
    200: {
      description: "O Loadout depois da edição, com a versão nova.",
      content: { "application/json": { schema: LoadoutSchema } },
    },
    400: problem("Corpo inválido."),
    404: problem("O Loadout ou alguma das referências não existe."),
    409: problem("Nome já usado, Harness ou perfil desligado, ou Model de outro Harness."),
  },
});

export const loadoutsDeleteRoute = createRoute({
  method: "delete",
  path: `${API_BASE_PATH}/loadouts/{id}`,
  tags: ["execution"],
  summary: "Apaga o Loadout",
  description:
    "Recusa enquanto algum Run o referencia: `loadoutId` é o fio que liga a " +
    "execução ao equipamento que hoje existe.",
  request: { params: IdParamSchema },
  responses: {
    204: { description: "Loadout apagado." },
    404: problem("Não existe Loadout com este id."),
    409: problem("Algum Run ainda referencia este Loadout."),
  },
});

export const loadoutVersionsListRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/loadouts/{id}/versions`,
  tags: ["execution"],
  summary: "As versões guardadas do Loadout",
  description:
    "Da mais recente para a mais antiga. Cada uma traz a definição por referências daquele " +
    "número: ids, pins e políticas, nunca conteúdo.",
  request: { params: IdParamSchema, query: LoadoutVersionListQuerySchema },
  responses: {
    200: {
      description: "Uma página de versões.",
      content: { "application/json": { schema: LoadoutVersionPageSchema } },
    },
    400: problem("Paginação inválida."),
    404: problem("Não existe Loadout com este id."),
  },
});

export const loadoutVersionsRestoreRoute = createRoute({
  method: "post",
  path: `${API_BASE_PATH}/loadouts/{id}/versions/{version}/restore`,
  tags: ["execution"],
  summary: "Restaura uma versão do Loadout",
  description:
    "Cria uma versão **nova** com a definição da antiga; nunca reescreve. Se a definição já " +
    "for a atual, nada muda e a versão não sobe. As referências são conferidas de novo.",
  request: { params: LoadoutVersionParamSchema },
  responses: {
    200: {
      description: "O Loadout na versão nova (ou na atual, se nada mudou).",
      content: { "application/json": { schema: LoadoutSchema } },
    },
    404: problem("Não existe Loadout com este id, ou alguma referência da versão sumiu."),
    409: problem("A versão não existe, ou uma referência dela está desligada ou em conflito."),
  },
});

export const loadoutPreflightRoute = createRoute({
  method: "get",
  path: `${API_BASE_PATH}/loadouts/{id}/preflight`,
  tags: ["execution"],
  summary: "O preflight do Loadout: tudo o que dá para saber antes de partir",
  description:
    "Junta o relatório de capabilities (o Loadout resolvido contra a matriz do Harness), o " +
    "preflight da CLI no modo do perfil — no host, o `--version` e a checagem de credencial " +
    "do adapter; em `DOCKER`, daemon, imagem e a CLI dentro do container — e o estado da " +
    "credencial do Provider, sem chamar modelo nenhum: variável presente no ambiente da API " +
    "ou o que a CLI respondeu. `executionProfileId` sobrepõe o perfil como `POST /runs` " +
    "permite; `resume=true` avalia a intenção de retomar. Mede na chamada; nunca no boot.",
  request: { params: IdParamSchema, query: LoadoutPreflightQuerySchema },
  responses: {
    200: {
      description: "O preflight, mesmo com blockers: eles vêm no corpo.",
      content: { "application/json": { schema: LoadoutPreflightSchema } },
    },
    400: problem("Parâmetro inválido."),
    404: problem("Não existe Loadout com este id, ou o perfil informado não existe."),
    409: problem("O Loadout aponta para um Agent ou Harness que não existe mais."),
  },
});
