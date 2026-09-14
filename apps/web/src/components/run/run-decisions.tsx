import { Link } from "@tanstack/react-router";
import { ArrowRight, Gauge, Landmark, ScrollText, ShieldHalf } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { toast } from "sonner";

import { UsageBars } from "@/components/autonomy/budget-usage";
import { CHIP, DecidedByLine, tint, useDecidedByText } from "@/components/autonomy/shared";
import { Button } from "@/components/ui/button";
import type {
  BreakerAdmissionRecord,
  BudgetBreachRecord,
  PolicyDecisionRecord,
  RoutingDecisionRecord,
  TaskDetailRecord,
  TaskSuggestionsRecord,
} from "@/lib/api-types";
import { SuggestionsNotAllowedError, useApprovalPolicy, useCircuitBreaker } from "@/lib/autonomy";
import {
  AUTONOMY_COLOR,
  BUDGET_LIMIT_KEY,
  breakerReopensAt,
  formatLimitValue,
  pressureColor,
  usageValue,
} from "@/lib/autonomy-domain";
import { formatDateTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { useUpdateTask } from "@/lib/tasks";

/** Uma recusa da autonomia controlada em `POST /runs`, guardada até a próxima escolha. */
export type RunRefusal =
  | { readonly kind: "budget"; readonly breach: BudgetBreachRecord }
  | { readonly kind: "breaker"; readonly admission: BreakerAdmissionRecord }
  | { readonly kind: "policy"; readonly decision: PolicyDecisionRecord };

export interface SuggestionsBlockProps {
  readonly task: TaskDetailRecord;
  readonly data: TaskSuggestionsRecord | undefined;
  readonly error: Error | null;
  readonly pending: boolean;
  /** O Equipamento no seletor, para marcar a sugestão como pré-selecionada. */
  readonly currentLoadoutId: string;
}

/**
 * As sugestões da rédea (Fase 9C): o Equipamento, o Ritual e o Patrono que
 * as regras da Campanha escolheram com os fatos da Missão, cada um com o
 * motivo — a regra que casou ou o padrão que valeu.
 *
 * O Equipamento é pré-selecionado no seletor do diálogo, que continua livre.
 * O Ritual pertence à Missão, não à partida: aplicar a sugestão grava o
 * `workflowId` na Missão, e é a próxima partida (esta, se ainda não partiu)
 * que o congela. O Patrono só é decidido na partida, e só quando o
 * Equipamento o deixa em branco; aqui ele é informação, com o motivo.
 *
 * Abaixo do nível 1 a API responde `409 AUTOMATION_NOT_ALLOWED`, e o bloco
 * diz isso em uma linha em vez de sumir.
 */
export function SuggestionsBlock({
  task,
  data,
  error,
  pending,
  currentLoadoutId,
}: SuggestionsBlockProps) {
  const { t, format } = useGlossary();
  const update = useUpdateTask();
  const decidedBy = useDecidedByText();

  if (task.projectId === null) return null;

  if (error instanceof SuggestionsNotAllowedError) {
    return <Note state="disabled" text={t("suggestion.disabled")} />;
  }

  if (error !== null) {
    return <Note state="failed" text={error.message} />;
  }

  if (pending || data === undefined) {
    return <Note pulse state="loading" text={t("suggestion.loading")} />;
  }

  const workflowDiffers =
    data.workflow.selectedId !== null && data.workflow.selectedId !== task.workflowId;
  const pressureTone = pressureColor(data.budgetPressure);

  function applyWorkflow() {
    if (data === undefined || data.workflow.selectedId === null) return;
    update.mutate(
      { id: task.id, workflowId: data.workflow.selectedId },
      {
        onSuccess: () => {
          toast.success(t("suggestion.workflow.applied"));
        },
        onError: (mutationError: Error) => {
          toast.error(mutationError.message);
        },
      },
    );
  }

  return (
    <div
      className="flex flex-col gap-2.5 rounded-[10px] border px-3 py-2.5"
      data-run-suggestions="ready"
      style={{ borderColor: tint(AUTONOMY_COLOR, 40) }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Gauge aria-hidden className="size-3.5 flex-none" style={{ color: AUTONOMY_COLOR }} />
        <span className="text-[12.5px] font-medium">{t("suggestion.title")}</span>
        <span className="flex-1" />
        <span
          className={CHIP}
          data-run-suggestions-pressure={data.budgetPressure.toFixed(2)}
          style={{ borderColor: tint(pressureTone, 45), color: pressureTone }}
        >
          {format("{label} {percent}%", {
            label: t("suggestion.pressure"),
            percent: Math.round(data.budgetPressure * 100),
          })}
        </span>
      </div>
      <span className="text-muted-foreground text-[11.5px] leading-4.5">
        {t("suggestion.description")}
      </span>

      <SuggestionRow
        applied={data.loadout.selectedId !== null && data.loadout.selectedId === currentLoadoutId}
        decision={data.loadout}
        kind="loadout"
        label={t("entity.loadout")}
        who={decidedBy(data.loadout.decidedBy)}
      />
      <SuggestionRow
        action={
          workflowDiffers ? (
            <Button
              data-run-suggestion-apply-workflow
              disabled={update.isPending}
              onClick={applyWorkflow}
              size="xs"
              type="button"
              variant="outline"
            >
              {t("suggestion.workflow.apply")}
            </Button>
          ) : undefined
        }
        applied={data.workflow.selectedId !== null && data.workflow.selectedId === task.workflowId}
        decision={data.workflow}
        kind="workflow"
        label={t("entity.workflow")}
        who={decidedBy(data.workflow.decidedBy)}
      />
      <SuggestionRow
        applied={false}
        decision={data.model}
        kind="model"
        label={t("entity.model")}
        note={t("suggestion.model.note")}
        who={decidedBy(data.model.decidedBy)}
      />
    </div>
  );
}

function Note({ state, text, pulse = false }: { state: string; text: string; pulse?: boolean }) {
  return (
    <div
      className="border-border text-muted-foreground flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[11.5px]"
      data-run-suggestions={state}
    >
      <Gauge aria-hidden className={pulse ? "size-3.5 flex-none animate-pulse" : "size-3.5 flex-none"} />
      <span>{text}</span>
    </div>
  );
}

function SuggestionRow({
  kind,
  label,
  decision,
  who,
  applied,
  note,
  action,
}: {
  kind: "loadout" | "workflow" | "model";
  label: string;
  decision: RoutingDecisionRecord;
  who: string;
  applied: boolean;
  note?: string;
  action?: ReactNode;
}) {
  const { t } = useGlossary();

  return (
    <div
      className="flex flex-wrap items-start gap-x-3 gap-y-1"
      data-run-suggestion={kind}
      data-run-suggestion-selected={decision.selectedId ?? ""}
    >
      <span className="text-muted-foreground w-24 flex-none pt-0.5 text-[11px] tracking-[0.04em] uppercase">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium" data-run-suggestion-name>
            {decision.selectedName ?? t("suggestion.none")}
          </span>
          {applied && (
            <span
              className={CHIP}
              data-run-suggestion-applied
              style={{ borderColor: tint(AUTONOMY_COLOR, 45), color: AUTONOMY_COLOR }}
            >
              {t("suggestion.applied")}
            </span>
          )}
          {action}
        </span>
        <span className="text-muted-foreground text-[11.5px] leading-4.5">
          <span className="text-foreground/80">{who}</span>
          {" · "}
          {decision.reason}
          {note !== undefined && ` ${note}`}
        </span>
      </div>
    </div>
  );
}

export interface RefusalBlockProps {
  readonly refusal: RunRefusal;
  readonly projectId: string | null;
}

/**
 * A recusa da autonomia controlada, dentro do diálogo (Fase 9C).
 *
 * Um orçamento no teto mostra o teto atingido, o consumo já com este Run e
 * as barras da janela; um disjuntor aberto mostra o motivo e quando volta a
 * sondar (lido do próprio disjuntor, porque a admissão só traz o quanto
 * falta em texto); uma política que nega mostra qual, pelo nome. Os três
 * levam à Rédea da Campanha, onde a regra se ajusta.
 */
export function RefusalBlock({ refusal, projectId }: RefusalBlockProps) {
  const { t, format } = useGlossary();

  const breakerId = refusal.kind === "breaker" ? refusal.admission.breakerId : null;
  const breaker = useCircuitBreaker(breakerId);
  const policyId = refusal.kind === "policy" ? refusal.decision.policyId : null;
  const policy = useApprovalPolicy(policyId);
  const policyNames = useMemo(
    () =>
      policy.data === undefined
        ? new Map<string, string>()
        : new Map([[policy.data.id, policy.data.name]]),
    [policy.data],
  );

  const reopens = breaker.data === undefined ? null : breakerReopensAt(breaker.data);
  const Icon =
    refusal.kind === "budget" ? Landmark : refusal.kind === "breaker" ? ShieldHalf : ScrollText;
  const title =
    refusal.kind === "budget"
      ? t("budget.exceeded.title")
      : refusal.kind === "breaker"
        ? t("breaker.open.title")
        : t("run.refused.policy");

  return (
    <div
      className="border-destructive/40 bg-destructive/8 flex flex-col gap-2.5 rounded-[10px] border px-3 py-2.5"
      data-run-refusal={refusal.kind}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Icon aria-hidden className="text-destructive size-3.5 flex-none" />
        <span className="text-[12.5px] font-medium">{title}</span>
        <span className="flex-1" />
        {projectId !== null && (
          <Link
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11.5px] underline-offset-2 hover:underline"
            data-run-refusal-open
            params={{ id: projectId }}
            search={{
              tab:
                refusal.kind === "budget"
                  ? "budgets"
                  : refusal.kind === "breaker"
                    ? "breakers"
                    : "policies",
              scope: "project",
            }}
            to="/projects/$id/autonomy"
          >
            <span>{t("run.refused.open")}</span>
            <ArrowRight aria-hidden className="size-3" />
          </Link>
        )}
      </div>

      {refusal.kind === "budget" && (
        <div className="flex flex-col gap-2" data-run-refusal-budget={refusal.breach.budgetId}>
          <span className="text-[12.5px]">
            <span className="font-medium">{refusal.breach.name}</span>
            {refusal.breach.limit !== null && refusal.breach.limitValue !== null && (
              <span className="text-muted-foreground">
                {" · "}
                {format("{label}: {current} de {limit}", {
                  label: t(BUDGET_LIMIT_KEY[refusal.breach.limit]),
                  current: formatLimitValue(refusal.breach.limit, refusal.breach.current),
                  limit: formatLimitValue(refusal.breach.limit, refusal.breach.limitValue),
                })}
              </span>
            )}
          </span>
          <span className="text-muted-foreground text-[11.5px] leading-4.5">
            {refusal.breach.reason}
          </span>
          <UsageBars
            data-run-refusal-usage=""
            exceeded={refusal.breach.usage.exceeded}
            limits={refusal.breach.usage.limits}
            pressure={refusal.breach.usage.pressure}
            runsWithoutUsage={refusal.breach.usage.runsWithoutUsage}
            tokensKnown={refusal.breach.usage.tokensKnown}
            values={{
              maxTokens: usageValue(refusal.breach.usage, "maxTokens"),
              maxRuns: usageValue(refusal.breach.usage, "maxRuns"),
              maxWallClockMs: usageValue(refusal.breach.usage, "maxWallClockMs"),
              maxConcurrentRuns: usageValue(refusal.breach.usage, "maxConcurrentRuns"),
            }}
          />
        </div>
      )}

      {refusal.kind === "breaker" && (
        <div className="flex flex-col gap-1" data-run-refusal-breaker={refusal.admission.breakerId}>
          <span className="text-[12.5px] font-medium">{refusal.admission.name}</span>
          <span className="text-muted-foreground text-[11.5px] leading-4.5">
            {refusal.admission.reason}
          </span>
          {reopens !== null && (
            <span className="text-[11.5px]" data-run-refusal-reopens={reopens}>
              {format(t("breaker.reopensAt"), { when: formatDateTime(reopens) })}
            </span>
          )}
        </div>
      )}

      {refusal.kind === "policy" && (
        <DecidedByLine
          data-run-refusal-policy={refusal.decision.policyId ?? ""}
          decidedBy={refusal.decision.decidedBy}
          names={{ policies: policyNames }}
          reason={refusal.decision.reason}
        />
      )}

      <span className="text-muted-foreground text-[11px] leading-4">{t("run.refused.hint")}</span>
    </div>
  );
}
