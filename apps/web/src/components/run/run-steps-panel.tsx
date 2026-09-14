import type { RunStepStatus } from "@dungeon-master/contracts";
import { ListOrdered } from "lucide-react";
import type { ReactNode } from "react";

import { Panel } from "@/components/panel";
import type { RunStepRecord, RunStepResultRecord } from "@/lib/api-types";
import { useRunSteps } from "@/lib/approvals";
import { useGlossary } from "@/lib/glossary";
import { formatDuration } from "@/lib/runs";
import { cn } from "@/lib/utils";
import {
  APPROVAL_GATE_STATUS,
  RUN_STEP_STATUS,
  STEP_SKIP_REASON,
  WORKFLOW_STEP_TYPE,
} from "@/lib/workflow-domain";

const CHIP =
  "border-border inline-flex h-[22px] w-fit items-center gap-1.5 rounded-lg border bg-white/[0.04] px-2 text-xs whitespace-nowrap";

const NUMBER = new Intl.NumberFormat("pt-BR");

/** O chip de estado de um RunStep, no mesmo desenho do chip de Run. */
export function RunStepStatusChip({
  status,
  className,
}: {
  status: RunStepStatus;
  className?: string;
}) {
  const { t } = useGlossary();
  const { label, dot, dim, pulse } = RUN_STEP_STATUS[status];

  return (
    <span
      className={cn(CHIP, dim && "text-muted-foreground", className)}
      data-run-step-status={status}
    >
      <span
        aria-hidden
        className={cn("size-1.5 flex-none rounded-full", pulse && "animate-pulse")}
        style={{ backgroundColor: dot }}
      />
      <span>{t(label)}</span>
    </span>
  );
}

function tint(color: string, percent: number): string {
  return `color-mix(in oklch, ${color} ${String(percent)}%, transparent)`;
}

/** Uma linha só, cortada no que cabe. */
function oneLine(value: string, limit = 160): string {
  const flat = value.replace(/\s+/gu, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** As últimas linhas de uma saída, para a cauda de um comando. */
function tail(value: string | undefined, lines = 3): string | null {
  if (value === undefined) return null;
  const kept = value.trimEnd().split("\n").slice(-lines).join("\n");
  return kept === "" ? null : kept;
}

/** Duração de um step: entre início e fim, ou até agora enquanto roda. */
function stepDurationMs(step: RunStepRecord, now: number): number | null {
  if (step.startedAt === null) return null;
  const started = new Date(step.startedAt).getTime();
  if (Number.isNaN(started)) return null;
  const finished = step.finishedAt === null ? now : new Date(step.finishedAt).getTime();
  return Math.max(0, (Number.isNaN(finished) ? now : finished) - started);
}

export interface RunStepsPanelProps {
  readonly runId: string;
  /** O Run ainda pode mudar: os steps são relidos sozinhos. */
  readonly live: boolean;
  /** Redesenhado a cada segundo pelo cockpit, para a duração do step em curso. */
  readonly now: number;
}

/**
 * Os Passos do ritual de uma Expedição (Fase 4C).
 *
 * Uma linha por RunStep, na ordem topológica da captura, com o que cada tipo
 * de resultado tem de mais útil: o veredito e o resumo do agente, o código de
 * saída e a cauda do comando, o passou/falhou da validação, a decisão e a nota
 * da aprovação, quantos candidatos o passo de conhecimento juntou. Um passo
 * pulado diz por quê. Os dados são do banco, por query; o Diário ao vivo só
 * avisa que é hora de reler.
 */
export function RunStepsPanel({ runId, live, now }: RunStepsPanelProps) {
  const { t, format } = useGlossary();
  const steps = useRunSteps(runId, live);
  const items = steps.data?.items ?? [];

  return (
    <Panel className="flex flex-col overflow-hidden" data-run-steps>
      <div className="border-border flex h-11 flex-none items-center justify-between gap-3 border-b px-4">
        <div className="flex items-center gap-2">
          <ListOrdered aria-hidden className="text-muted-foreground size-3.75" />
          <span className="text-sm font-medium">{t("entity.workflowStep.plural")}</span>
        </div>
        <span className="text-muted-foreground text-[11px]">
          {format("{done} de {total} {status}", {
            done: items.filter((step) => step.status === "SUCCEEDED").length,
            total: items.length,
            status: t("runStep.status.succeeded").toLowerCase(),
          })}
        </span>
      </div>

      {steps.isError && <p className="text-destructive px-4 py-4 text-sm">{steps.error.message}</p>}
      {steps.isPending && <p className="text-muted-foreground px-4 py-4 text-sm">Lendo…</p>}
      {!steps.isPending && !steps.isError && items.length === 0 && (
        <p className="text-muted-foreground px-4 py-4 text-[12.5px]">
          {format("Esta {run} não tem {steps}.", {
            run: t("entity.run"),
            steps: t("entity.workflowStep.plural").toLowerCase(),
          })}
        </p>
      )}

      {items.length > 0 && (
        <ol className="m-0 flex list-none flex-col p-0">
          {items.map((step) => (
            <StepRow key={step.id} now={now} step={step} />
          ))}
        </ol>
      )}
    </Panel>
  );
}

function StepRow({ step, now }: { step: RunStepRecord; now: number }) {
  const { t, format } = useGlossary();
  const { icon: Icon, label, color } = WORKFLOW_STEP_TYPE[step.type];
  const duration = stepDurationMs(step, now);
  const active = step.status === "RUNNING" || step.status === "WAITING_APPROVAL";

  return (
    <li
      className={cn(
        "border-border flex items-start gap-3 border-b px-4 py-3 last:border-b-0",
        active && "bg-white/[0.03]",
      )}
      data-run-step={step.key}
    >
      <span className="text-muted-foreground w-5 flex-none pt-1 text-right font-mono text-[11px]">
        {step.position + 1}
      </span>

      <span
        className="mt-0.5 flex size-6 flex-none items-center justify-center rounded-full border"
        style={{ borderColor: tint(color, 40), backgroundColor: tint(color, 12), color }}
        title={t(label)}
      >
        <Icon aria-hidden className="size-3.25" strokeWidth={1.8} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] leading-4.5 font-medium">{step.name}</span>
          <span className="text-muted-foreground font-mono text-[10.5px]">{step.key}</span>
          <span className="text-muted-foreground text-[11px]">{t(label)}</span>
          <span className="flex-1" />
          <RunStepStatusChip status={step.status} />
        </div>

        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px]">
          <span>
            {step.attempt === 0
              ? format("nenhuma tentativa", {})
              : format("tentativa {n}", { n: step.attempt })}
          </span>
          {duration !== null && <span className="font-mono">{formatDuration(duration)}</span>}
        </div>

        <StepOutcome step={step} />
      </div>
    </li>
  );
}

/**
 * O que o step deixou: o resultado por tipo, ou o motivo de não ter rodado.
 *
 * Um step pulado carrega o `StepSkipReason` tipado em `error.details`
 * (`RunStepError`, no contrato); quando ele não veio, o `message` já diz o
 * bastante.
 */
function StepOutcome({ step }: { step: RunStepRecord }) {
  const { t } = useGlossary();

  const skip = readSkipReason(step);
  if (step.status === "SKIPPED") {
    return (
      <Detail data-step-skip>
        {skip !== null ? (
          <>
            <span className="text-foreground">{t(STEP_SKIP_REASON[skip.code])}</span>
            {skip.detail !== null && <span>{`: ${skip.detail}`}</span>}
          </>
        ) : (
          (step.error?.message ?? t("runStep.status.skipped"))
        )}
      </Detail>
    );
  }

  if (step.result !== null) return <ResultSummary result={step.result} />;

  if (step.error !== null) {
    return (
      <Detail>
        {step.error.code !== undefined && (
          <code className="mr-1.5 font-mono text-[10.5px]">{step.error.code}</code>
        )}
        {oneLine(step.error.message)}
      </Detail>
    );
  }

  return null;
}

interface SkipReasonView {
  readonly code: "PREDICATE_FALSE" | "DEPENDENCY_NOT_SUCCEEDED";
  readonly detail: string | null;
}

function readSkipReason(step: RunStepRecord): SkipReasonView | null {
  const reason = step.error?.details;
  if (reason === undefined) return null;

  if (reason.code === "PREDICATE_FALSE") {
    return { code: reason.code, detail: reason.detail === "" ? null : reason.detail };
  }
  return { code: reason.code, detail: `${reason.dependency} · ${reason.status}` };
}

function ResultSummary({ result }: { result: RunStepResultRecord }) {
  const { t, format } = useGlossary();

  switch (result.kind) {
    case "agent":
      return (
        <Detail data-step-result="agent">
          <span className="text-foreground">{result.status}</span>
          {result.summary !== undefined && result.summary !== "" && (
            <span>{` · ${oneLine(result.summary)}`}</span>
          )}
        </Detail>
      );

    case "command": {
      const output = tail(result.stderrTail) ?? tail(result.stdoutTail);
      return (
        <Detail data-step-result="command">
          <span className="text-foreground">
            {result.exitCode === null
              ? "encerrado por sinal"
              : format("exit code {n}", { n: result.exitCode })}
          </span>
          {output !== null && (
            <pre className="text-muted-foreground m-0 mt-1 max-h-24 overflow-auto font-mono text-[11px] leading-4 whitespace-pre-wrap">
              {output}
            </pre>
          )}
        </Detail>
      );
    }

    case "validation": {
      const output = tail(result.stderrTail) ?? tail(result.stdoutTail);
      return (
        <Detail data-step-result="validation">
          <span
            className="font-medium"
            style={{
              color: result.verdict === "passed" ? "var(--accent-green)" : "var(--destructive)",
            }}
          >
            {result.verdict === "passed" ? "passou" : "falhou"}
          </span>
          <span>
            {result.exitCode === null
              ? " · encerrado por sinal"
              : ` · ${format("exit code {n}", { n: result.exitCode })}`}
          </span>
          {output !== null && (
            <pre className="text-muted-foreground m-0 mt-1 max-h-24 overflow-auto font-mono text-[11px] leading-4 whitespace-pre-wrap">
              {output}
            </pre>
          )}
        </Detail>
      );
    }

    case "approval": {
      const status = result.decision === "approve" ? "GRANTED" : "REJECTED";
      return (
        <Detail data-step-result="approval">
          <span className="text-foreground">{t(APPROVAL_GATE_STATUS[status].label)}</span>
          {result.note !== null && result.note !== "" && (
            <span>{` · ${oneLine(result.note)}`}</span>
          )}
        </Detail>
      );
    }

    case "knowledge":
      return (
        <Detail data-step-result="knowledge">
          {format(result.candidates.length === 1 ? "{n} candidato" : "{n} candidatos", {
            n: NUMBER.format(result.candidates.length),
          })}
        </Detail>
      );
  }
}

function Detail({
  children,
  ...rest
}: { children: ReactNode } & Record<`data-${string}`, string | undefined>) {
  return (
    <div className="text-muted-foreground text-[12px] leading-4.5" {...rest}>
      {children}
    </div>
  );
}
