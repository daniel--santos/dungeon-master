import type { HarnessCapabilities, HarnessKey, PermissionPolicy } from "@dungeon-master/contracts";
import { and, eq } from "drizzle-orm";

import type { Database } from "./client.js";
import {
  DEFAULT_ENVIRONMENT_POLICY,
  DEFAULT_NETWORK_POLICY,
  DEFAULT_PERMISSION_POLICY,
} from "./execution-profile.js";
import { newId } from "./ids.js";
import { executionProfiles, harnesses } from "./schema/execution.js";

/**
 * As sementes dos cadastros fechados: os quatro Harnesses e os dois
 * ExecutionProfiles do planejamento v0.4.
 *
 * Harness e ExecutionProfile nascem do `db:seed`, e não da massa de
 * demonstração, porque não são exemplo: são o vocabulário do sistema. Um banco
 * sem eles não consegue criar Loadout nenhum, e a aplicação estaria quebrada em
 * vez de vazia.
 *
 * Idempotente pela chave natural: `key` para o Harness, `name` para o perfil.
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
      multiTurnProcess: false,
      toolEvents: true,
      tokenUsage: true,
      modelSelection: true,
      agentSelection: true,
      nativePermissions: true,
      hostExecution: true,
      dockerExecution: true,
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
      multiTurnProcess: false,
      toolEvents: true,
      tokenUsage: true,
      modelSelection: true,
      agentSelection: false,
      nativePermissions: false,
      hostExecution: true,
      dockerExecution: true,
    },
  },
  {
    // Desligado: o Antigravity tem fase própria (planejamento v0.4, Fase 3), com
    // spike técnico, autenticação particular e Docker por decidir. Aparecer na
    // lista ligado prometeria uma execução que ainda não existe.
    key: "ANTIGRAVITY",
    name: "Antigravity CLI",
    enabled: false,
    capabilities: {
      streaming: true,
      structuredOutput: true,
      resume: true,
      multiTurnProcess: false,
      toolEvents: true,
      tokenUsage: true,
      modelSelection: true,
      agentSelection: true,
      nativePermissions: true,
      hostExecution: true,
      dockerExecution: false,
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
 * Ela existe porque um perfil sem comando nenhum não termina uma tarefa de
 * código: o agente cria o arquivo, não consegue commitar e reporta `blocked`.
 * Foi o que aconteceu no primeiro Run desta fase, e a correção não é afrouxar
 * tudo — é dizer, na cara, quais comandos um Run pode executar.
 *
 * Cada prefixo aqui é uma porta aberta em toda execução do sistema, então a
 * lista é o mínimo que faz uma tarefa de código funcionar de ponta a ponta:
 * inspecionar e versionar o próprio worktree. Instalar dependência, publicar
 * pacote ou apagar arquivo por comando **não** estão aqui de propósito; quem
 * precisa acrescenta no perfil, e a escolha fica visível na tela.
 */
export const OPEN_FIELD_ALLOWED_COMMANDS: readonly string[] = ["git", "ls", "cat", "node"];

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

export interface ExecutionSeedResult {
  readonly harnessesCreated: number;
  readonly harnessesTotal: number;
  readonly executionProfilesCreated: number;
  readonly executionProfilesTotal: number;
}

export async function seedExecutionRegistry(
  db: Database,
  input: { userId: string },
): Promise<ExecutionSeedResult> {
  const { userId } = input;

  let harnessesCreated = 0;
  let executionProfilesCreated = 0;

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

  return {
    harnessesCreated,
    harnessesTotal: HARNESS_SEEDS.length,
    executionProfilesCreated,
    executionProfilesTotal: EXECUTION_PROFILE_SEEDS.length,
  };
}
