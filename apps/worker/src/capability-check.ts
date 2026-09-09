import {
  HARNESS_CAPABILITY_KEY_VALUES,
  type CapabilityIssue,
  type ExecutionMode,
  type HarnessCapabilities,
  type HarnessCapabilityKey,
  type HarnessKey,
  type Run,
} from "@dungeon-master/contracts";
import { matchCapabilities } from "@dungeon-master/domain";

/**
 * O capability matching na reclamação do Run (planejamento v0.4, Fase 8B).
 *
 * A API já rodou `matchCapabilities` em `POST /runs` e recusou os blockers.
 * O Worker roda de novo, e não por desconfiança: o que a API viu foi a matriz
 * gravada em `harness.capabilities`, e o que executa é o adapter registrado
 * **neste** processo — que pode ser de outra versão, ou nem existir para o
 * par `(harness, modo)`. Quando os dois divergem, a divergência fica no diário
 * e vale a matriz medida, porque é ela que vai rodar.
 *
 * Função pura sobre o Run reclamado: quem grava os `Diagnostic` e fecha o Run
 * como `FAILED` é `prepare-run.ts`, antes de qualquer trava, worktree ou
 * processo — um blocker aqui é um Run que não deve começar, não um Run que
 * roda pior.
 */

/** Código do erro tipado com que um Run barrado por capability termina. */
export const CAPABILITY_BLOCKED_CODE = "CAPABILITY_BLOCKED";

/** Código do `Diagnostic` que registra snapshot e adapter em desacordo. */
export const CAPABILITY_DIVERGENCE_CODE = "CAPABILITY_DIVERGENCE";

/** A matriz do adapter registrado para o par, ou `undefined` quando não há. */
export type MeasureCapabilities = (
  key: HarnessKey,
  mode: ExecutionMode,
) => HarnessCapabilities | undefined;

/** O suficiente de um adapter para medir a matriz: a chave, o modo e a matriz. */
export interface MeasurableAdapter {
  readonly key: HarnessKey;
  readonly executionMode?: ExecutionMode | undefined;
  readonly capabilities: HarnessCapabilities;
}

/**
 * A matriz medida por par `(harness, modo)`, a partir dos adapters que este
 * Worker registrou — a mesma lista que o `HarnessRegistry` do runtime e o
 * preflight de boot recebem.
 *
 * Quando o par não tem adapter mas o outro modo tem, a resposta é a matriz
 * desse outro adapter com a execução **neste** modo desligada: a matriz é do
 * harness e é a mesma nos dois adapters de propósito, e "este Worker não tem
 * como rodar o harness neste modo" é exatamente o que `hostExecution` ou
 * `dockerExecution` em `false` dizem. Sem isso, um Run em `DOCKER` de um
 * harness que só tem adapter de host aqui passaria pelo matching com a
 * matriz do snapshot e morreria mais adiante, no registry do runtime, com um
 * erro genérico e depois de trava e worktree. Sem adapter em modo nenhum,
 * `undefined`: vale o snapshot, e o registry diz o resto.
 */
export function measureCapabilitiesFrom(
  adapters: readonly MeasurableAdapter[],
): MeasureCapabilities {
  const find = (key: HarnessKey, mode: ExecutionMode): MeasurableAdapter | undefined =>
    adapters.find((adapter) => adapter.key === key && (adapter.executionMode ?? "HOST") === mode);

  return (key, mode) => {
    const exato = find(key, mode);
    if (exato !== undefined) return exato.capabilities;
    const outro = find(key, mode === "HOST" ? "DOCKER" : "HOST");
    if (outro === undefined) return undefined;
    return {
      ...outro.capabilities,
      ...(mode === "HOST" ? { hostExecution: false } : { dockerExecution: false }),
    };
  };
}

export interface CapabilityDivergence {
  readonly key: HarnessCapabilityKey;
  readonly snapshot: boolean;
  readonly measured: boolean;
}

export interface RunCapabilityCheck {
  /** A matriz que valeu: a medida no boot, ou a do snapshot quando não há adapter. */
  readonly capabilities: HarnessCapabilities;
  readonly source: "ADAPTER" | "SNAPSHOT";
  readonly divergences: readonly CapabilityDivergence[];
  readonly blockers: readonly CapabilityIssue[];
  readonly warnings: readonly CapabilityIssue[];
}

export interface CheckRunCapabilitiesInput {
  readonly run: Pick<Run, "loadoutSnapshot" | "executionProfileSnapshot" | "resumedFromRunId">;
  /** A matriz do adapter que vai executar. Ausente quando o par não está registrado. */
  readonly measured: HarnessCapabilities | undefined;
  /** O Loadout é o Escriba do Grimório, que exige resultado estruturado. */
  readonly requiresStructuredOutput: boolean;
}

export function checkRunCapabilities(input: CheckRunCapabilitiesInput): RunCapabilityCheck {
  const { run, measured } = input;
  const snapshot = run.loadoutSnapshot.harness.capabilities;
  const capabilities = measured ?? snapshot;

  const divergences: CapabilityDivergence[] =
    measured === undefined
      ? []
      : HARNESS_CAPABILITY_KEY_VALUES.filter((key) => snapshot[key] !== measured[key]).map(
          (key) => ({ key, snapshot: snapshot[key], measured: measured[key] }),
        );

  const report = matchCapabilities({
    snapshot: run.loadoutSnapshot,
    harnessCapabilities: capabilities,
    executionProfile: { mode: run.executionProfileSnapshot.mode },
    intent: {
      resume: run.resumedFromRunId !== null,
      requiresStructuredOutput: input.requiresStructuredOutput,
    },
  });

  return {
    capabilities,
    source: measured === undefined ? "SNAPSHOT" : "ADAPTER",
    divergences,
    blockers: report.blockers,
    warnings: report.warnings,
  };
}

/** A frase do diário para uma divergência entre snapshot e adapter. */
export function describeDivergences(
  divergences: readonly CapabilityDivergence[],
  adapterId?: string,
): string {
  const lista = divergences
    .map(
      (item) => `${item.key}: snapshot ${String(item.snapshot)}, adapter ${String(item.measured)}`,
    )
    .join("; ");
  return (
    "A matriz de capabilities congelada no Run difere da medida neste Worker" +
    (adapterId === undefined ? "" : ` (${adapterId})`) +
    `; vale a medida, porque é ela que executa. ${lista}.`
  );
}

/** A mensagem do erro tipado: os códigos, e as frases canônicas do domínio. */
export function describeBlockers(blockers: readonly CapabilityIssue[]): string {
  const codigos = blockers.map((issue) => issue.code).join(", ");
  return (
    `O Run foi barrado pelo capability matching (${codigos}) e nenhum agente subiu. ` +
    blockers.map((issue) => issue.message).join(" ")
  );
}
