import {
  BUILT_IN_KNOWLEDGE_MCP_SERVER_NAME,
  DEFAULT_TRUSTED_COMMANDS,
  type HarnessCapabilities,
  type HarnessKey,
  type PermissionPolicy,
  type ProviderKind,
} from "@dungeon-master/contracts";
import { and, eq } from "drizzle-orm";

import type { Database } from "./client.js";
import {
  DEFAULT_ENVIRONMENT_POLICY,
  DEFAULT_NETWORK_POLICY,
  DEFAULT_PERMISSION_POLICY,
} from "./execution-profile.js";
import { newId } from "./ids.js";
import { executionProfiles, harnesses } from "./schema/execution.js";
import { mcpServers, providers, tools } from "./schema/registry.js";

/**
 * As sementes dos cadastros fechados: os quatro Harnesses, os dois
 * ExecutionProfiles e, desde a Fase 8A, os quatro Providers, as cinco Tools de
 * comando e o servidor MCP `builtIn` do Grimório.
 *
 * Harness e ExecutionProfile nascem do `db:seed`, e não da massa de
 * demonstração, porque não são exemplo: são o vocabulário do sistema. Um banco
 * sem eles não consegue criar Loadout nenhum, e a aplicação estaria quebrada em
 * vez de vazia.
 *
 * Idempotente pela chave natural: `key` para o Harness, `name` para o resto.
 * Rodar duas vezes não duplica, e o que já existe é respeitado — quem editou o
 * nome de um perfil ou desligou um harness fez isso de propósito.
 */

interface HarnessSeed {
  readonly key: HarnessKey;
  readonly name: string;
  readonly enabled: boolean;
  readonly capabilities: HarnessCapabilities;
}

/**
 * As capabilities de partida (documento técnico, seção 32).
 *
 * São **declaradas**, e não descobertas: o preflight de cada adapter confirma
 * versão e instalação (Fase 2B), mas o que a CLI sabe fazer é conhecimento do
 * adapter e entra aqui como dado. Uma matriz descoberta em tempo de execução
 * deixaria a interface sem resposta antes do primeiro Run.
 *
 * `mcpServers` e `forkSession` (Fase 8A) copiam o que cada adapter declara em
 * `packages/runtime-sandcastle` e `packages/runtime-antigravity`: Claude Code
 * sobe servidores e forka sessão; Codex sobe servidores; Pi e Antigravity não
 * têm caminho headless para servidores MCP na versão pinada.
 */
const HARNESS_SEEDS: readonly HarnessSeed[] = [
  {
    key: "CLAUDE_CODE",
    name: "Claude Code",
    enabled: true,
    capabilities: {
      streaming: true,
      structuredOutput: true,
      resume: true,
      forkSession: true,
      multiTurnProcess: false,
      toolEvents: true,
      tokenUsage: true,
      modelSelection: true,
      agentSelection: true,
      nativePermissions: true,
      hostExecution: true,
      dockerExecution: true,
      mcpServers: true,
    },
  },
  {
    key: "CODEX",
    name: "Codex CLI",
    enabled: true,
    capabilities: {
      streaming: true,
      structuredOutput: true,
      resume: true,
      forkSession: false,
      multiTurnProcess: false,
      toolEvents: true,
      tokenUsage: true,
      modelSelection: true,
      agentSelection: false,
      nativePermissions: true,
      hostExecution: true,
      // O ADR 0001 classificou o Codex em Docker como **experimental**: o único
      // caminho de credencial provado nele é montar `~/.codex/auth.json`, cujo
      // conteúdo o sanitizador de credenciais não sabe redigir. Não existe
      // adapter `codex@docker`, e prometer aqui deixaria a interface oferecendo
      // um Ambiente de Execução que o Run recusa na partida.
      dockerExecution: false,
      mcpServers: true,
    },
  },
  {
    key: "PI",
    name: "Pi",
    enabled: true,
    capabilities: {
      streaming: true,
      structuredOutput: true,
      resume: true,
      forkSession: false,
      multiTurnProcess: false,
      toolEvents: true,
      tokenUsage: true,
      modelSelection: true,
      agentSelection: false,
      nativePermissions: false,
      hostExecution: true,
      dockerExecution: true,
      mcpServers: false,
    },
  },
  {
    // Ligado na Fase 3: o adapter de `packages/runtime-antigravity` passa os
    // onze casos da suíte de contrato com a CLI 1.1.27 de verdade.
    //
    // Três campos mudaram em relação ao que a semente prometia antes do spike,
    // e os três para menos. `nativePermissions` virou `false` porque a CLI não
    // consulta allow-list de comando em modo headless — ela tem a lista, mas
    // com `-p` nega todo comando de qualquer jeito, e o único interruptor que
    // funciona libera tudo. `agentSelection` virou `false` porque `--agent`
    // existe mas não houve agente para exercitá-lo. `dockerExecution` continua
    // `false`: a credencial do `agy` vem do chaveiro do sistema, e levá-la para
    // dentro de um container é decisão da Fase 3D.
    key: "ANTIGRAVITY",
    name: "Antigravity CLI",
    enabled: true,
    capabilities: {
      streaming: true,
      structuredOutput: true,
      resume: true,
      forkSession: false,
      multiTurnProcess: false,
      toolEvents: true,
      tokenUsage: true,
      modelSelection: true,
      agentSelection: false,
      nativePermissions: false,
      hostExecution: true,
      dockerExecution: false,
      mcpServers: false,
    },
  },
];

interface ExecutionProfileSeed {
  readonly name: string;
  readonly mode: "HOST" | "DOCKER";
  readonly workspaceStrategy: "CURRENT" | "GIT_WORKTREE" | "COPY";
  readonly enforcement: "ADVISORY" | "HARNESS_NATIVE" | "SANDBOX_ENFORCED";
  readonly enabled: boolean;
  readonly isDefault: boolean;
  /** Ausente usa {@link DEFAULT_PERMISSION_POLICY}. */
  readonly permissionPolicy?: PermissionPolicy;
}

/**
 * A allow-list de comandos com que "Campo aberto" nasce.
 *
 * É a lista compartilhada de `DEFAULT_TRUSTED_COMMANDS`, e não uma cópia: o que
 * o perfil semeado concede e o que `commandExecution: ALL` concede precisam ser
 * a mesma coisa, senão o padrão da tela e o padrão do código divergem no
 * primeiro ajuste. Quem precisa de mais acrescenta no perfil.
 */
export const OPEN_FIELD_ALLOWED_COMMANDS: readonly string[] = DEFAULT_TRUSTED_COMMANDS;

/**
 * Os dois perfis de partida, com os nomes do glossário `dnd` na coluna `name`.
 *
 * O nome é dado do usuário, e não label de interface: ele pode renomear os
 * dois. O que a interface nunca deixa sumir é o aviso de isolamento — "Campo
 * aberto" aparece sempre acompanhado de "sem isolamento" (CLAUDE.md, seção 2).
 *
 * "Masmorra selada" nasce **ligada** desde a Fase 2C. Ela ficou desligada
 * enquanto o modo `DOCKER` não existia — um perfil escolhível antes disso
 * produziria um Run que o worker não sabe executar —, e o que a ligou foi o
 * veredito do ADR `docs/adr/0001-autenticacao-em-docker.md`: pelo menos um
 * harness (dois, na verdade) tem caminho de credencial provado dentro do
 * container. Quem não tem é o Codex, e isso aparece onde é acionável, na matriz
 * de capabilities dele (`dockerExecution: false`), e não num perfil desligado.
 */
const EXECUTION_PROFILE_SEEDS: readonly ExecutionProfileSeed[] = [
  {
    name: "Campo aberto",
    mode: "HOST",
    workspaceStrategy: "GIT_WORKTREE",
    enforcement: "HARNESS_NATIVE",
    enabled: true,
    isDefault: true,
    permissionPolicy: {
      workspaceWrite: true,
      commandExecution: "ALLOWLIST",
      allowedCommands: [...OPEN_FIELD_ALLOWED_COMMANDS],
      deniedCommands: [],
    },
  },
  {
    name: "Masmorra selada",
    mode: "DOCKER",
    workspaceStrategy: "GIT_WORKTREE",
    enforcement: "SANDBOX_ENFORCED",
    enabled: true,
    isDefault: false,
    // A allow-list de "Campo aberto" não se repete aqui de propósito. No modo
    // `DOCKER` quem impõe a fronteira é o container, e não a CLI: o perfil pede
    // `BYPASS`, o `AgentRuntime` concede porque `SANDBOX_ENFORCED` vale, e o
    // agente trabalha sem ser interrompido dentro de um ambiente que ele não
    // consegue deixar. Fora do container esse mesmo pedido seria rebaixado para
    // `DEFAULT`, com `Diagnostic` — é a regra dos três degraus da Fase 2B, e é
    // ela que torna este `BYPASS` honesto em vez de perigoso.
    // `allowUnsafeBypass` fica **ausente** de propósito: ele é a porta de bypass
    // *sem* isolamento, e aqui o isolamento existe. É `enforcement` que decide.
    permissionPolicy: {
      workspaceWrite: true,
      commandExecution: "ALL",
      allowedCommands: [],
      deniedCommands: [],
    },
  },
];

interface ProviderSeed {
  readonly name: string;
  readonly kind: ProviderKind;
  readonly authEnvKeys: readonly string[];
  readonly harnessKeys: readonly HarnessKey[];
  readonly docsUrl: string | null;
}

/**
 * Os Providers de partida (Fase 8A).
 *
 * `SUBSCRIPTION` porque o caminho provado de cada CLI é o login da própria
 * ferramenta (ADR 0001); a variável de ambiente é a alternativa, e é ela que o
 * preflight consegue enxergar sem chamar modelo nenhum. Só **nomes**: o valor
 * nunca é gravado.
 */
const PROVIDER_SEEDS: readonly ProviderSeed[] = [
  {
    name: "Anthropic",
    kind: "SUBSCRIPTION",
    authEnvKeys: ["ANTHROPIC_API_KEY"],
    harnessKeys: ["CLAUDE_CODE", "PI"],
    docsUrl: "https://docs.anthropic.com/",
  },
  {
    name: "OpenAI",
    kind: "SUBSCRIPTION",
    authEnvKeys: ["OPENAI_API_KEY"],
    harnessKeys: ["CODEX", "PI"],
    docsUrl: "https://platform.openai.com/docs",
  },
  {
    name: "Google",
    kind: "SUBSCRIPTION",
    authEnvKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    harnessKeys: ["ANTIGRAVITY", "PI"],
    docsUrl: "https://ai.google.dev/gemini-api/docs",
  },
  {
    name: "Local",
    kind: "LOCAL",
    authEnvKeys: [],
    harnessKeys: ["PI"],
    docsUrl: null,
  },
];

/**
 * O servidor do Grimório, o único `builtIn`.
 *
 * O comando aqui é simbólico: quem sabe o arquivo empacotado, os argumentos
 * (`projectId`, `userId`) e a `DATABASE_URL` é o Worker, que o sobe por
 * `knowledgePolicy` do Loadout (Fase 7B). O registro existe para o Loadout
 * poder referenciá-lo como qualquer outro servidor e para a interface listá-lo.
 */
const KNOWLEDGE_MCP_SERVER_SEED = {
  name: BUILT_IN_KNOWLEDGE_MCP_SERVER_NAME,
  transport: "STDIO" as const,
  command: "node",
  args: [] as string[],
  envKeys: ["DATABASE_URL"],
  readOnly: true,
  builtIn: true,
  description:
    "O servidor MCP do Grimório: busca e leitura das páginas do Project, só leitura. " +
    "O Worker resolve o arquivo do servidor e os argumentos na hora de subir.",
};

export interface ExecutionSeedResult {
  readonly harnessesCreated: number;
  readonly harnessesTotal: number;
  readonly executionProfilesCreated: number;
  readonly executionProfilesTotal: number;
  readonly providersCreated: number;
  readonly providersTotal: number;
  readonly toolsCreated: number;
  readonly toolsTotal: number;
  readonly mcpServersCreated: number;
  readonly mcpServersTotal: number;
}

export async function seedExecutionRegistry(
  db: Database,
  input: { userId: string },
): Promise<ExecutionSeedResult> {
  const { userId } = input;

  let harnessesCreated = 0;
  let executionProfilesCreated = 0;
  let providersCreated = 0;
  let toolsCreated = 0;
  let mcpServersCreated = 0;

  for (const seed of HARNESS_SEEDS) {
    const inserted = await db
      .insert(harnesses)
      .values({
        id: newId(),
        userId,
        key: seed.key,
        name: seed.name,
        enabled: seed.enabled,
        capabilities: seed.capabilities,
      })
      .onConflictDoNothing({ target: [harnesses.userId, harnesses.key] })
      .returning({ id: harnesses.id });

    if (inserted.length > 0) harnessesCreated += 1;
  }

  for (const seed of EXECUTION_PROFILE_SEEDS) {
    const [existing] = await db
      .select({ id: executionProfiles.id })
      .from(executionProfiles)
      .where(and(eq(executionProfiles.userId, userId), eq(executionProfiles.name, seed.name)));

    if (existing !== undefined) continue;

    await db.insert(executionProfiles).values({
      id: newId(),
      userId,
      name: seed.name,
      mode: seed.mode,
      workspaceStrategy: seed.workspaceStrategy,
      enforcement: seed.enforcement,
      permissionPolicy: seed.permissionPolicy ?? DEFAULT_PERMISSION_POLICY,
      environmentPolicy: DEFAULT_ENVIRONMENT_POLICY,
      networkPolicy: DEFAULT_NETWORK_POLICY,
      enabled: seed.enabled,
      isDefault: seed.isDefault,
    });

    executionProfilesCreated += 1;
  }

  for (const seed of PROVIDER_SEEDS) {
    const inserted = await db
      .insert(providers)
      .values({
        id: newId(),
        userId,
        name: seed.name,
        kind: seed.kind,
        authEnvKeys: [...seed.authEnvKeys],
        harnessKeys: [...seed.harnessKeys],
        docsUrl: seed.docsUrl,
      })
      .onConflictDoNothing({ target: [providers.userId, providers.name] })
      .returning({ id: providers.id });

    if (inserted.length > 0) providersCreated += 1;
  }

  // As cinco Tools de comando são os mesmos prefixos da allow-list de "Campo
  // aberto": o que o perfil concede e o que o registro oferece são a mesma
  // lista, e é `DEFAULT_TRUSTED_COMMANDS` que a define.
  for (const command of DEFAULT_TRUSTED_COMMANDS) {
    const inserted = await db
      .insert(tools)
      .values({
        id: newId(),
        userId,
        name: command,
        kind: "COMMAND",
        command,
        mcpServerId: null,
        toolName: null,
        description: `Prefixo de comando liberado: \`${command}\`.`,
      })
      .onConflictDoNothing({ target: [tools.userId, tools.name] })
      .returning({ id: tools.id });

    if (inserted.length > 0) toolsCreated += 1;
  }

  const [knowledge] = await db
    .select({ id: mcpServers.id, builtIn: mcpServers.builtIn })
    .from(mcpServers)
    .where(and(eq(mcpServers.userId, userId), eq(mcpServers.name, KNOWLEDGE_MCP_SERVER_SEED.name)));

  if (knowledge === undefined) {
    await db.insert(mcpServers).values({ id: newId(), userId, ...KNOWLEDGE_MCP_SERVER_SEED });
    mcpServersCreated += 1;
  } else if (!knowledge.builtIn) {
    // Um servidor inline chamado `knowledge` de antes da Fase 8A: o nome sempre
    // foi reservado e o Worker o ignorava com aviso. Ele vira o `builtIn`, que
    // é o único sentido que esse nome tem.
    await db
      .update(mcpServers)
      .set(KNOWLEDGE_MCP_SERVER_SEED)
      .where(eq(mcpServers.id, knowledge.id));
  }

  return {
    harnessesCreated,
    harnessesTotal: HARNESS_SEEDS.length,
    executionProfilesCreated,
    executionProfilesTotal: EXECUTION_PROFILE_SEEDS.length,
    providersCreated,
    providersTotal: PROVIDER_SEEDS.length,
    toolsCreated,
    toolsTotal: DEFAULT_TRUSTED_COMMANDS.length,
    mcpServersCreated,
    mcpServersTotal: 1,
  };
}
