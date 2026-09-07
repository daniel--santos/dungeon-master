import type {
  DiagnosticLevel,
  ExecutionProfileSnapshot,
  HarnessKey,
} from "@dungeon-master/contracts";
import type {
  HarnessCapabilities,
  RuntimeEnvironmentPolicy,
  RuntimePermissionPolicy,
} from "@dungeon-master/runtime";

/**
 * A tradução da política declarativa do Loadout para o que o runtime consome.
 *
 * **Isto é regra de domínio, e por isso mora no Worker.** `packages/contracts`
 * declara o que o usuário pediu (`workspaceWrite`, `commandExecution`,
 * `allowedVariables`); `packages/runtime` declara o que um adapter sabe montar
 * (`mode`, `harnessMode`, `allowList`). Quem decide que "executar qualquer
 * comando" vira **qual** modo de permissão de CLI é uma decisão sobre
 * segurança, não sobre argv — e um adapter que a tomasse sozinho tomaria uma
 * diferente por harness.
 *
 * ## A regra dura
 *
 * `commandExecution: ALL` em `HOST` com `enforcement = HARNESS_NATIVE` vira o
 * **modo de auto-aprovação nativo da CLI**, nunca `bypass`. A diferença é toda:
 * auto-aprovação deixa a CLI continuar aplicando as barreiras dela (caminhos
 * proibidos, comandos negados, confirmação para o que é destrutivo) sem parar
 * para perguntar; `bypass` desliga as barreiras. Um Loadout copiado de outra
 * máquina não pode virar bypass silencioso na máquina de alguém.
 *
 * `bypass` só sai em dois casos, os dois visíveis:
 *
 * 1. `enforcement = SANDBOX_ENFORCED` — há isolamento de verdade em volta, e é
 *    o container que limita, não a CLI (planejamento v0.4, Fase 2C).
 * 2. `permissionPolicy.allowUnsafeBypass = true` — opt-in explícito de quem
 *    editou o perfil. Nesse caso o Run emite um `Diagnostic` e grava uma linha
 *    no diário do Project: quem ligou isso deixou rastro.
 *
 * "Nunca usar `sandbox.interactive()` do Sandcastle, que pula permissões
 * incondicionalmente" (planejamento v0.4, Fase 2B) é a mesma regra vista pelo
 * outro lado.
 */

export interface PolicyNote {
  readonly level: DiagnosticLevel;
  readonly message: string;
  readonly detail?: string;
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
 * O nome do modo de auto-aprovação de cada CLI.
 *
 * É vocabulário do harness, não nosso: `acceptEdits` é o que o Claude Code
 * chama de "não me pergunte a cada edição", e `workspace-write` é o sandbox do
 * Codex que libera escrita dentro do diretório de trabalho. Os dois param antes
 * do que é destrutivo fora do workspace, que é exatamente a diferença para
 * `bypass`.
 *
 * `undefined` significa "esta CLI não tem um modo assim". Nesse caso vale o
 * padrão dela, e o Run registra que o pedido não pôde ser atendido — em vez de
 * escalar para bypass, que seria conceder mais do que se pediu.
 */
const AUTO_APPROVE_MODE: Partial<Record<HarnessKey, string>> = {
  CLAUDE_CODE: "acceptEdits",
  CODEX: "workspace-write",
  // Pi não declara `nativePermissions`, e Antigravity chega na Fase 3.
};

export interface ResolveRunPoliciesInput {
  readonly profile: ExecutionProfileSnapshot;
  readonly harnessKey: HarnessKey;
  /** Matriz do adapter que vai executar, não a semeada no banco. */
  readonly capabilities: Pick<HarnessCapabilities, "nativePermissions">;
}

export function resolveRunPolicies(input: ResolveRunPoliciesInput): ResolvedRunPolicies {
  const { profile, harnessKey, capabilities } = input;
  const policy = profile.permissionPolicy;
  const notes: PolicyNote[] = [];

  const sandboxEnforced = profile.enforcement === "SANDBOX_ENFORCED";
  const optIn = policy.allowUnsafeBypass === true;

  let permission: RuntimePermissionPolicy = { mode: "DEFAULT" };
  let bypassWithoutSandbox = false;

  if (policy.commandExecution === "ALL") {
    if (sandboxEnforced) {
      permission = { mode: "BYPASS" };
      notes.push({
        level: "INFO",
        message:
          "Execução de comandos liberada com as checagens da CLI desligadas, dentro de um " +
          "ambiente com isolamento imposto.",
      });
    } else if (optIn) {
      // O opt-in é a única porta de bypass sem isolamento, e ela é barulhenta
      // de propósito: `Diagnostic` no log e linha no diário do Project.
      permission = { mode: "BYPASS", allowBypassWithoutSandbox: true };
      bypassWithoutSandbox = true;
      notes.push({
        level: "WARN",
        message:
          "Este Run roda com as checagens de permissão da CLI desligadas e SEM isolamento: " +
          "o agente tem as mesmas permissões do seu usuário no sistema.",
        detail:
          `Origem: allowUnsafeBypass = true no ExecutionProfile "${profile.name}". ` +
          "Desligue a opção no perfil para voltar ao modo de auto-aprovação nativo do harness.",
      });
    } else {
      const harnessMode = AUTO_APPROVE_MODE[harnessKey];
      if (harnessMode !== undefined && capabilities.nativePermissions) {
        permission = { mode: "CONFIGURED", harnessMode };
        notes.push({
          level: "INFO",
          message:
            `Execução de comandos liberada pelo modo nativo do harness (${harnessMode}). ` +
            "As barreiras da própria CLI continuam valendo.",
        });
      } else {
        notes.push({
          level: "WARN",
          message:
            `A política pede execução de qualquer comando, mas ${harnessKey} não tem um modo ` +
            "de auto-aprovação nativo. Vale o padrão da CLI, e o agente pode parar pedindo " +
            "confirmação.",
        });
      }
    }
  } else if (policy.commandExecution === "ALLOWLIST" && policy.allowedCommands.length > 0) {
    // A allow-list é `ADVISORY` na Fase 2: nenhuma das três CLIs aceita uma
    // lista de comandos permitidos pela linha de comando. Dizer isso alto é o
    // que a seção 15 do documento técnico chama de não confundir política
    // pedida com política imposta.
    notes.push({
      level: "WARN",
      message:
        "A allow-list de comandos é apenas indicativa nesta versão: nenhuma das CLIs de " +
        "agente aceita a lista por parâmetro, então nada impede tecnicamente um comando " +
        "fora dela.",
      detail: `Comandos declarados: ${policy.allowedCommands.join(", ")}.`,
    });
  }

  if (policy.deniedCommands.length > 0 && permission.mode === "BYPASS") {
    notes.push({
      level: "WARN",
      message: "A lista de comandos negados não é aplicada com as checagens da CLI desligadas.",
      detail: `Comandos negados no perfil: ${policy.deniedCommands.join(", ")}.`,
    });
  }

  if (!policy.workspaceWrite) {
    notes.push({
      level: "WARN",
      message:
        "A política pede workspace somente leitura, e isso não é imposto no modo HOST: " +
        "worktree é isolamento de código, não de sistema de arquivos.",
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
