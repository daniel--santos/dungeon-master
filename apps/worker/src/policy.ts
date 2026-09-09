import {
  DEFAULT_TRUSTED_COMMANDS,
  type DiagnosticLevel,
  type ExecutionProfileSnapshot,
  type HarnessKey,
} from "@dungeon-master/contracts";
import type {
  HarnessCapabilities,
  PermissionGrant,
  RuntimeEnvironmentPolicy,
  RuntimePermissionPolicy,
} from "@dungeon-master/runtime";

/**
 * A tradução da política declarativa do Loadout para o que o runtime consome.
 *
 * **Isto é regra de domínio, e por isso mora no Worker.** `packages/contracts`
 * declara o que o usuário pediu (`workspaceWrite`, `commandExecution`,
 * `allowedVariables`); `packages/runtime` declara o que um adapter sabe montar.
 * O que o Worker decide é **quanto conceder**; o que cada adapter decide é como
 * escrever isso no argv dele. Sem essa divisão, ou o Worker passaria a saber o
 * que é `Bash(git:*)`, ou cada adapter inventaria o seu próprio significado
 * para "executar qualquer comando".
 *
 * ## Três degraus, não dois
 *
 * A primeira versão desta função tinha só dois destinos, e os dois erravam. O
 * modo de auto-aprovação de edições (`acceptEdits` no Claude Code) libera
 * escrita de arquivo e **não** libera comando: um Run com ele criou o arquivo
 * pedido, não conseguiu `git add`, e reportou `blocked`. `bypass` liberava
 * tudo, inclusive o que ninguém pediu.
 *
 * O degrau do meio é a **concessão**: o Worker diz o que o agente pode fazer —
 * escrever no workspace, executar estes prefixos de comando — e o adapter
 * traduz para `--allowedTools`, `--sandbox` ou `--tools`, conforme a CLI.
 *
 * ## A regra dura continua a mesma
 *
 * `bypass` só sai com `enforcement = SANDBOX_ENFORCED` — há isolamento de
 * verdade em volta — ou com `permissionPolicy.allowUnsafeBypass = true`, opt-in
 * explícito de quem editou o perfil. No segundo caso o Run emite um
 * `Diagnostic` e grava uma linha no diário do Project.
 *
 * `commandExecution: ALL` **nunca** vira `bypass` sozinho. Ele vira a concessão
 * mais larga que ainda é uma lista: os comandos de trabalho que qualquer tarefa
 * de código precisa, mais o que o perfil listar. Um agente sem lista nenhuma é
 * outro pedido, e tem outra porta.
 */

export interface PolicyNote {
  readonly level: DiagnosticLevel;
  readonly message: string;
  readonly detail?: string;
  /** Código estável, quando a nota é um fato acionável. */
  readonly code?: string;
}

export interface ResolvedRunPolicies {
  readonly permission: RuntimePermissionPolicy;
  readonly environment: RuntimeEnvironmentPolicy;
  /** Diagnósticos a gravar no log do Run, na ordem. */
  readonly notes: readonly PolicyNote[];
  /**
   * O Run vai rodar com as checagens da CLI desligadas e sem isolamento.
   *
   * Quando verdadeiro, o Worker grava `run.permission_bypassed` no diário: um
   * `Diagnostic` no log de execução some junto com o Run na tela de histórico,
   * e a pergunta "por que aquele agente teve permissão para tudo?" costuma
   * chegar meses depois.
   */
  readonly bypassWithoutSandbox: boolean;
}

/**
 * Os comandos que `commandExecution: ALL` concede por padrão.
 *
 * Vem de `@dungeon-master/contracts` e é reexportada aqui por conveniência de
 * quem lê a tradução: o que a semente coloca no perfil "Campo aberto" e o que
 * `ALL` concede são a mesma lista, de propósito.
 */
export { DEFAULT_TRUSTED_COMMANDS };

/**
 * O aviso do Antigravity, que erra para o lado oposto dos demais.
 *
 * Nos outros harnesses sem permissão nativa a allow-list é **frouxa**: uma vez
 * que a ferramenta de shell existe, qualquer comando passa. No `agy` 1.1.27 ela
 * é **inexistente em modo headless**: a CLI tem allow-list de comando em
 * `settings.json`, mas não a consulta com `-p`, então nenhum comando passa, com
 * lista ou sem ela. Medido contra a CLI real; está no README do
 * `packages/runtime-antigravity`.
 *
 * A diferença muda o que o usuário deve fazer, e é por isso que ela tem texto
 * próprio: acrescentar prefixos em `allowedCommands` não resolve nada aqui.
 */
const ANTIGRAVITY_ALLOWLIST_NOTE: PolicyNote = {
  level: "WARN",
  message:
    "O Antigravity não consulta allow-list de comando em modo headless: neste Run nenhum " +
    "comando de shell vai passar, e a lista do perfil não muda isso.",
  detail:
    "Acrescentar prefixos em `permissionPolicy.allowedCommands` não tem efeito neste harness. " +
    "Para o agente executar comandos, ligue `allowUnsafeBypass` no ExecutionProfile — o que " +
    "desliga todas as checagens da CLI, não só as da lista — ou escolha um harness com " +
    "permissão por comando. O `enforcement` deste Run sai como ADVISORY.",
};

export interface ResolveRunPoliciesInput {
  readonly profile: ExecutionProfileSnapshot;
  readonly harnessKey: HarnessKey;
  /** Matriz do adapter que vai executar, não a semeada no banco. */
  readonly capabilities: Pick<HarnessCapabilities, "nativePermissions">;
  /**
   * Os prefixos das Tools `COMMAND` do Loadout (Fase 8B), já sem repetição.
   *
   * Somam-se à allow-list do perfil por Run — união — e passam pela mesma
   * tradução por harness. Um perfil que não libera comando nenhum não ganha
   * comando por Tool: a Tool amplia a lista, não abre a porta.
   */
  readonly toolCommands?: readonly string[];
}

export function resolveRunPolicies(input: ResolveRunPoliciesInput): ResolvedRunPolicies {
  const { profile, harnessKey, capabilities } = input;
  const policy = profile.permissionPolicy;
  const toolCommands = input.toolCommands ?? [];
  const notes: PolicyNote[] = [];

  const sandboxEnforced = profile.enforcement === "SANDBOX_ENFORCED";
  const optIn = policy.allowUnsafeBypass === true;
  const querTudo = policy.commandExecution === "ALL";

  let permission: RuntimePermissionPolicy;
  let bypassWithoutSandbox = false;

  if (querTudo && sandboxEnforced) {
    permission = { mode: "BYPASS" };
    notes.push({
      level: "INFO",
      message:
        "Execução de comandos liberada com as checagens da CLI desligadas, dentro de um " +
        "ambiente com isolamento imposto.",
    });
  } else if (querTudo && optIn) {
    // O opt-in é a única porta de bypass sem isolamento, e ela é barulhenta de
    // propósito: `Diagnostic` no log e linha no diário do Project.
    permission = { mode: "BYPASS", allowBypassWithoutSandbox: true };
    bypassWithoutSandbox = true;
    notes.push({
      level: "WARN",
      message:
        "Este Run roda com as checagens de permissão da CLI desligadas e SEM isolamento: " +
        "o agente tem as mesmas permissões do seu usuário no sistema.",
      detail:
        `Origem: allowUnsafeBypass = true no ExecutionProfile "${profile.name}". ` +
        "Desligue a opção no perfil para voltar ao modo configurado por allow-list.",
    });
  } else {
    const grant = buildGrant(policy, querTudo, toolCommands);
    permission = { mode: "CONFIGURED", grant };

    notes.push(describeGrant(grant, querTudo));

    if (toolCommands.length > 0) {
      notes.push(
        grant.commandExecution === "NONE"
          ? {
              level: "WARN",
              message:
                "A política do perfil não libera execução de comandos; as Tools de comando do " +
                `Loadout não foram somadas à allow-list: ${toolCommands.join(", ")}.`,
              detail:
                "Uma Tool amplia a lista do ExecutionProfile, não abre a porta. Mude " +
                "`commandExecution` no perfil para ALLOWLIST ou ALL.",
            }
          : {
              level: "INFO",
              message: `Tools de comando do Loadout somadas à allow-list: ${toolCommands.join(", ")}.`,
            },
      );
    }

    if (!capabilities.nativePermissions && grant.commandExecution === "ALLOWLIST") {
      // Diferenciar `policy requested` de `policy enforced` (documento técnico,
      // seção 15). Os dois harnesses sem permissão nativa erram para lados
      // opostos, e dizer a mesma frase para os dois mandaria metade dos
      // usuários fazer a coisa errada.
      notes.push(
        harnessKey === "ANTIGRAVITY"
          ? ANTIGRAVITY_ALLOWLIST_NOTE
          : {
              level: "WARN",
              message:
                `${harnessKey} não aplica permissão por comando: a lista de comandos é indicativa, ` +
                "e o que a ferramenta de shell dele executa não é filtrado.",
              detail:
                "O `enforcement` deste Run sai como ADVISORY por isso. Para uma barreira de verdade, " +
                "use um harness com permissão nativa ou espere o modo DOCKER da Fase 2C.",
            },
      );
    }

    if (grant.deniedCommands.length > 0) {
      notes.push({
        level: "INFO",
        message: `Comandos recusados mesmo dentro da lista: ${grant.deniedCommands.join(", ")}.`,
      });
    }
  }

  if (!policy.workspaceWrite) {
    notes.push({
      level: "INFO",
      message:
        "A política pede workspace somente leitura: as ferramentas de escrita ficam fora da " +
        "allow-list. Isso não impede o agente de escrever por outro caminho — worktree é " +
        "isolamento de código, não de sistema de arquivos.",
    });
  }

  const environment: RuntimeEnvironmentPolicy = {
    allowList: profile.environmentPolicy.allowedVariables,
    // `inheritPath` e `inheritEssential` são o mesmo interruptor visto de dois
    // lados: sem o piso do sistema operacional não há `PATH`, e sem `PATH` a
    // CLI não encontra nem as ferramentas dela nem o `git`.
    inheritEssential: profile.environmentPolicy.inheritPath,
  };

  return { permission, environment, notes, bypassWithoutSandbox };
}

/**
 * A concessão que o adapter vai traduzir.
 *
 * `ALL` sem opt-in é a lista de trabalho mais o que o perfil pediu; `ALLOWLIST`
 * é exatamente o que o perfil pediu; `NONE` não concede comando nenhum.
 * Duplicatas somem porque `Bash(git:*)` duas vezes no argv não ajuda ninguém a
 * ler o comando no log.
 */
function buildGrant(
  policy: ExecutionProfileSnapshot["permissionPolicy"],
  querTudo: boolean,
  toolCommands: readonly string[],
): PermissionGrant {
  const daPolitica = policy.allowedCommands.map((comando) => comando.trim()).filter(Boolean);

  // A união: o que o perfil pede, mais as Tools de comando do Loadout, sem
  // repetir e na ordem perfil → Tools, para o log ler igual ao que foi editado.
  const permitidos =
    policy.commandExecution === "NONE"
      ? []
      : [
          ...new Set(
            querTudo
              ? [...DEFAULT_TRUSTED_COMMANDS, ...daPolitica, ...toolCommands]
              : [...daPolitica, ...toolCommands],
          ),
        ];

  return {
    workspaceWrite: policy.workspaceWrite,
    commandExecution: policy.commandExecution === "NONE" ? "NONE" : "ALLOWLIST",
    allowedCommands: permitidos,
    deniedCommands: policy.deniedCommands.map((comando) => comando.trim()).filter(Boolean),
  };
}

/** A frase que explica, no log do Run, o que o agente pode fazer. */
function describeGrant(grant: PermissionGrant, querTudo: boolean): PolicyNote {
  if (grant.commandExecution === "NONE") {
    return {
      level: "INFO",
      message: grant.workspaceWrite
        ? "O agente pode ler e escrever no workspace, e não pode executar comandos."
        : "O agente pode apenas ler o workspace.",
    };
  }

  if (grant.allowedCommands.length === 0) {
    return {
      level: "WARN",
      message:
        "A política libera execução de comandos mas não lista nenhum, então nenhum comando " +
        "passa. Acrescente prefixos em `allowedCommands` no ExecutionProfile.",
    };
  }

  return {
    level: "INFO",
    message:
      `Execução liberada por allow-list para: ${grant.allowedCommands.join(", ")}. ` +
      (grant.workspaceWrite ? "Escrita no workspace liberada." : "Workspace somente leitura."),
    ...(querTudo
      ? {
          detail:
            "A política pede execução de qualquer comando. Sem `allowUnsafeBypass`, isso vira " +
            `a lista de trabalho padrão (${DEFAULT_TRUSTED_COMMANDS.join(", ")}) mais o que o ` +
            "perfil declarou — e não uma permissão irrestrita.",
        }
      : {}),
  };
}
