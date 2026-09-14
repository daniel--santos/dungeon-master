import { Link } from "@tanstack/react-router";
import { GitFork, Landmark } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { UsageBars } from "@/components/autonomy/budget-usage";
import { CHIP, tint } from "@/components/autonomy/shared";
import { RunStatusChip } from "@/components/execution/chips";
import { Panel } from "@/components/panel";
import type { BudgetRecord, RunListItemRecord, RunRecord } from "@/lib/api-types";
import { useBudgets } from "@/lib/autonomy";
import { AUTONOMY_COLOR, parseModelSelectedBy, RUN_CREATED_BY } from "@/lib/autonomy-domain";
import { relativeTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { runDurationMs, useRuns } from "@/lib/runs";

export interface RunOriginPanelProps {
  readonly run: RunRecord;
  /** O relógio do cockpit, para a duração de um Run ainda vivo. */
  readonly now: number;
}

/** Quantos Runs da Campanha a lista de filhos varre. */
const CHILDREN_SCAN_PAGE_SIZE = 100;

/**
 * A origem e o parentesco de uma Expedição (Fase 9C): quem a abriu — o
 * usuário, uma política ou outro agente —, a Expedição mãe e o passo que
 * delegou, e as filhas que ela abriu.
 *
 * As filhas são as Expedições da mesma Campanha cujo `parentRunId` é este
 * Run. `GET /runs` não filtra por mãe ainda, então a lista vem da Campanha
 * inteira e é filtrada aqui; pendência de API registrada no relatório da
 * fase. Sem delegação (9B) a lista fica vazia, e o painel diz isso em vez de
 * sumir: a origem de um Run é sempre informação.
 *
 * Embaixo, o orçamento por Run (`PER_RUN`) que vale para esta Expedição, com
 * o consumo dela mesma medido contra o teto: tokens do resultado e a
 * duração. `GET /budgets/{id}/usage` mede o último Run terminal do escopo,
 * não este; por isso a conta é feita aqui, sobre os dados do próprio Run, e
 * um resultado sem tokens vira "consumo incerto".
 */
export function RunOriginPanel({ run, now }: RunOriginPanelProps) {
  const { t, format } = useGlossary();
  const origin = RUN_CREATED_BY[run.createdBy];
  const OriginIcon = origin.icon;

  const siblings = useRuns({
    ...(run.projectId === null ? { taskId: run.taskId } : { projectId: run.projectId }),
    pageSize: CHILDREN_SCAN_PAGE_SIZE,
  });
  const children = useMemo(
    () => (siblings.data?.items ?? []).filter((item) => item.parentRunId === run.id),
    [run.id, siblings.data],
  );

  const modelSelectedBy = parseModelSelectedBy(run.loadoutSnapshot.modelSelectedBy);

  return (
    <Panel className="flex flex-col gap-3 px-4 pt-3.5 pb-4" data-run-origin={run.createdBy}>
      <div className="flex items-center gap-2">
        <GitFork aria-hidden className="size-3.5" style={{ color: AUTONOMY_COLOR }} />
        <span className="text-[13px] font-medium">{t("run.origin")}</span>
      </div>

      <MetaRow label={t("run.origin")}>
        <span
          className={CHIP}
          data-run-origin-chip={run.createdBy}
          style={{ borderColor: tint(AUTONOMY_COLOR, 40) }}
        >
          <OriginIcon aria-hidden className="size-3" style={{ color: AUTONOMY_COLOR }} />
          <span>{t(origin.label)}</span>
        </span>
      </MetaRow>

      {run.parentRunId !== null && (
        <>
          <MetaRow label={t("run.parent")}>
            <Link
              className="underline-offset-2 hover:underline"
              data-run-parent={run.parentRunId}
              params={{ id: run.parentRunId }}
              to="/runs/$id"
            >
              {format("Abrir o {cockpit}", { cockpit: t("run.cockpit") })}
            </Link>
          </MetaRow>
          {run.parentStepKey !== null && (
            <MetaRow label={t("run.parentStep")}>
              <code className="font-mono text-[11px]" data-run-parent-step={run.parentStepKey}>
                {run.parentStepKey}
              </code>
            </MetaRow>
          )}
        </>
      )}

      {/* `NONE` (nem Equipamento, nem padrão da Guilda) não é uma escolha: a
          linha some, e o Runtime ao lado já mostra o Patrono como "—". */}
      {modelSelectedBy !== null && modelSelectedBy.kind !== "none" && (
        <MetaRow label={t("run.model.selectedBy")}>
          <span data-run-model-selected-by={run.loadoutSnapshot.modelSelectedBy}>
            {modelSelectedBy.kind === "loadout"
              ? t("run.model.loadout")
              : modelSelectedBy.kind === "harnessDefault"
                ? t("run.model.harnessDefault")
                : t("entity.routingRule")}
          </span>
        </MetaRow>
      )}

      <div className="flex flex-col gap-1.5" data-run-children={children.length}>
        <span className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
          {t("run.children.title")}
        </span>
        {siblings.isError && (
          <span className="text-destructive text-[12px]">{siblings.error.message}</span>
        )}
        {!siblings.isError && children.length === 0 && (
          <span className="text-muted-foreground text-[12px]">
            {siblings.isPending ? "Lendo…" : t("run.children.empty")}
          </span>
        )}
        {children.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {children.map((child) => (
              <ChildRow key={child.id} child={child} now={now} />
            ))}
          </ul>
        )}
      </div>

      <PerRunBudget now={now} run={run} />
    </Panel>
  );
}

function ChildRow({ child, now }: { child: RunListItemRecord; now: number }) {
  const { format } = useGlossary();
  const duration = runDurationMs(child, now);

  return (
    <li className="flex items-center gap-2 text-[12px]" data-run-child={child.id}>
      <Link
        className="min-w-0 flex-1 truncate underline-offset-2 hover:underline"
        params={{ id: child.id }}
        to="/runs/$id"
      >
        {child.taskTitle}
      </Link>
      {child.parentStepKey !== null && (
        <code className="text-muted-foreground font-mono text-[10.5px]">{child.parentStepKey}</code>
      )}
      <RunStatusChip status={child.status} />
      <span className="text-muted-foreground flex-none text-[10.5px]">
        {duration === null
          ? relativeTime(child.createdAt)
          : format("{minutes} min", { minutes: Math.max(1, Math.round(duration / 60_000)) })}
      </span>
    </li>
  );
}

/** Os orçamentos `PER_RUN` que valem para este Run: globais, os da Campanha e os do Equipamento. */
function applicablePerRun(
  budgets: readonly BudgetRecord[],
  run: RunRecord,
): readonly BudgetRecord[] {
  return budgets.filter(
    (budget) =>
      budget.enabled &&
      budget.window === "PER_RUN" &&
      (budget.scope === "GLOBAL" ||
        (budget.scope === "PROJECT" && budget.projectId === run.projectId) ||
        (budget.scope === "LOADOUT" && budget.loadoutId === run.loadoutId)),
  );
}

function PerRunBudget({ run, now }: { run: RunRecord; now: number }) {
  const { t } = useGlossary();
  const budgets = useBudgets({});
  const applicable = useMemo(
    () => applicablePerRun(budgets.data?.items ?? [], run),
    [budgets.data, run],
  );

  if (applicable.length === 0) return null;

  const usage = run.result?.usage;
  const tokens =
    usage === undefined
      ? undefined
      : (usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
  // Um Run que começou e terminou sem número deixa a soma incerta, como a
  // API faz na janela; um Run que nem começou ainda não consumiu nada.
  const started = run.startedAt !== null;
  const tokensKnown = !started || tokens !== undefined || run.status === "CANCELLED";
  const wallClock = runDurationMs(run, now) ?? 0;

  return (
    <div className="flex flex-col gap-2" data-run-budget-per-run={applicable.length}>
      <span className="text-muted-foreground flex items-center gap-1.5 text-[11px] tracking-[0.06em] uppercase">
        <Landmark aria-hidden className="size-3" style={{ color: AUTONOMY_COLOR }} />
        <span>{t("budget.run.title")}</span>
      </span>
      {applicable.map((budget) => {
        const values = { maxTokens: tokens ?? 0, maxWallClockMs: wallClock };
        const exceeded = (["maxTokens", "maxWallClockMs"] as const).filter((key) => {
          const limit = budget.limits[key];
          return limit !== null && values[key] >= limit;
        });
        const pressure = Math.max(
          0,
          ...(["maxTokens", "maxWallClockMs"] as const).map((key) => {
            const limit = budget.limits[key];
            return limit === null ? 0 : values[key] / limit;
          }),
        );
        return (
          <div key={budget.id} className="flex flex-col gap-1" data-run-budget={budget.name}>
            <span className="text-[12px] font-medium">{budget.name}</span>
            <UsageBars
              exceeded={exceeded}
              limits={budget.limits}
              pressure={pressure}
              runsWithoutUsage={tokensKnown ? 0 : 1}
              tokensKnown={tokensKnown}
              values={values}
            />
          </div>
        );
      })}
      <span className="text-muted-foreground text-[10.5px] leading-4">{t("budget.run.hint")}</span>
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.75">
      <span className="text-muted-foreground flex-none text-xs">{label}</span>
      <span className="min-w-0 truncate text-right text-[12.5px]">{children}</span>
    </div>
  );
}
