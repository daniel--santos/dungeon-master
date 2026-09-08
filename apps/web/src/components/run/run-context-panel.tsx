import type { ContextSectionKind } from "@dungeon-master/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Backpack,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Scissors,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import type {
  ContextExclusionRecord,
  ContextItemRecord,
  ContextSectionRecord,
  RunContextRecord,
  RunRecord,
} from "@/lib/api-types";
import {
  budgetPercent,
  CONTEXT_COLOR,
  CONTEXT_EXCLUSION,
  CONTEXT_ORIGIN_LABEL,
  CONTEXT_REASON,
  CONTEXT_SECTION,
  CONTEXT_STATUS,
  contextItemOrigin,
  useRunContext,
  type ContextItemOrigin,
  type ContextPanelStatus,
} from "@/lib/context";
import { isLiveRunStatus } from "@/lib/execution-domain";
import { useGlossary } from "@/lib/glossary";
import { runKeys } from "@/lib/runs";
import { cn } from "@/lib/utils";

const NUMBER = new Intl.NumberFormat("pt-BR");
const SCORE = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

const CHIP =
  "border-border inline-flex h-[22px] w-fit items-center gap-1.5 rounded-lg border bg-white/[0.04] px-2 text-xs whitespace-nowrap";

function tint(color: string, percent: number): string {
  return `color-mix(in oklch, ${color} ${String(percent)}%, transparent)`;
}

/** "1 item" ou "{n} itens", pelo glossário. */
function useItemsLabel(): (count: number) => string {
  const { t, format } = useGlossary();
  return (count) =>
    format(count === 1 ? t("context.items.one") : t("context.items"), {
      n: NUMBER.format(count),
    });
}

/** O chip de estado das provisões, no mesmo desenho do chip de Run. */
export function ContextStatusChip({
  status,
  className,
}: {
  status: ContextPanelStatus;
  className?: string;
}) {
  const { t } = useGlossary();
  const { label, dot, dim, pulse } = CONTEXT_STATUS[status];

  return (
    <span
      className={cn(CHIP, dim && "text-muted-foreground", className)}
      data-context-status={status}
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

export interface RunContextPanelProps {
  readonly run: RunRecord;
}

/**
 * As provisões da Expedição (Fase 7C): o que o agente recebeu de contexto,
 * por quê, e o que ficou de fora.
 *
 * O painel lê o registro do Context Engine e o mostra inteiro: o estado, o
 * medidor de orçamento (o total e cada seção), cada item com o motivo, o
 * score da busca quando houve, os tokens e a marca de cortado, o link para a
 * origem (a Página do Grimório, a Missão, a Expedição que produziu o
 * artefato), os excluídos com o motivo, e o texto exato que foi ao prompt,
 * num painel recolhível com botão de copiar.
 *
 * Nada aqui edita: o contexto é montado uma vez, quando o Worker tira o Run
 * da fila, e o mesmo texto vale para todos os passos e para qualquer
 * retomada, porque é isso que preserva o cache de prompt (documento técnico,
 * seção 20.1). Uma retomada herda o contexto do Run de origem, e o painel
 * diz de qual.
 *
 * Enquanto o Run está na fila a API responde `404`, e o painel diz "ainda
 * não montado" em vez de erro; a query relê no ritmo da query do Run, e
 * toda mudança de estado do Run força uma releitura, porque o `200` chega
 * junto com o claim do Worker.
 *
 * Todo texto do registro é dado, escrito por modelo ou pelo usuário, e vai
 * para a tela como texto: nunca como HTML.
 */
export function RunContextPanel({ run }: RunContextPanelProps) {
  const { t, format } = useGlossary();
  const itemsLabel = useItemsLabel();
  const queryClient = useQueryClient();
  const live = isLiveRunStatus(run.status);
  const context = useRunContext(run.id, live);
  const [expanded, setExpanded] = useState(true);

  // O Run mudou de estado: se o contexto ainda não veio, é hora de reler. O
  // efeito compara com o estado anterior para não reler na montagem, que a
  // query já faz sozinha.
  const previousStatus = useRef(run.status);
  useEffect(() => {
    if (previousStatus.current === run.status) return;
    previousStatus.current = run.status;
    void queryClient.invalidateQueries({ queryKey: runKeys.context(run.id) });
  }, [queryClient, run.id, run.status]);

  const data = context.data;
  const status: ContextPanelStatus = data === undefined || data === null ? "PENDING" : data.status;

  return (
    <Panel
      className="flex flex-col overflow-hidden"
      data-run-context={context.isPending ? "LOADING" : status}
    >
      <div className="border-border flex min-h-11 flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <Backpack aria-hidden className="size-3.75" style={{ color: CONTEXT_COLOR }} />
          <span className="text-sm font-medium">{t("context.title")}</span>
        </div>

        {context.isPending ? (
          <span className="text-muted-foreground text-[11px]">Lendo…</span>
        ) : (
          <ContextStatusChip status={status} />
        )}

        {data !== undefined && data !== null && data.status === "ASSEMBLED" && (
          <span className="text-muted-foreground text-[11px]" data-context-usage>
            {format(t("context.budget.usage"), {
              used: NUMBER.format(data.usage.estimatedTokens),
              total: NUMBER.format(data.budget.totalTokens),
            })}
            <span aria-hidden> · </span>
            {itemsLabel(data.usage.itemCount)}
          </span>
        )}

        <span className="flex-1" />

        <Button
          aria-expanded={expanded}
          data-context-toggle
          onClick={() => {
            setExpanded((current) => !current);
          }}
          size="xs"
          variant="ghost"
        >
          {expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
          <span>{expanded ? t("context.collapse") : t("context.expand")}</span>
        </Button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-4 px-4 py-4">
          {context.isError && (
            <p className="text-destructive m-0 text-sm">{context.error.message}</p>
          )}

          {!context.isError && !context.isPending && (
            <ContextBody context={data ?? null} run={run} />
          )}
        </div>
      )}
    </Panel>
  );
}

function ContextBody({ context, run }: { context: RunContextRecord | null; run: RunRecord }) {
  const { t } = useGlossary();

  if (context === null) {
    return (
      <p className="text-muted-foreground m-0 text-[12.5px] leading-5" data-context-pending>
        {t("context.pending.hint")}
      </p>
    );
  }

  return (
    <>
      <p className="text-muted-foreground m-0 text-[12.5px] leading-5">
        {t(CONTEXT_STATUS[context.status].hint)}
      </p>

      {context.inheritedFromRunId !== null && (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] border px-3 py-2 text-[12.5px]"
          data-context-inherited={context.inheritedFromRunId}
          style={{ borderColor: tint(CONTEXT_COLOR, 40), backgroundColor: tint(CONTEXT_COLOR, 8) }}
        >
          <span>{t("context.inherited")}</span>
          <Link
            className="hover:text-foreground text-muted-foreground flex items-center gap-1 underline-offset-2 hover:underline"
            data-context-inherited-open
            params={{ id: context.inheritedFromRunId }}
            to="/runs/$id"
          >
            <span>{t("context.inherited.open")}</span>
            <ArrowRight aria-hidden className="size-3" />
          </Link>
        </div>
      )}

      {context.status === "FAILED" && (
        <div
          className="flex items-start gap-2.5 rounded-[10px] border border-[var(--destructive)]/40 bg-[var(--destructive)]/8 px-3 py-2.5"
          data-context-error
          role="alert"
        >
          <TriangleAlert aria-hidden className="text-destructive mt-0.5 size-3.5 flex-none" />
          <span className="text-[12.5px] leading-5 whitespace-pre-wrap">
            {context.error ?? t("context.status.failed")}
          </span>
        </div>
      )}

      {context.status === "DISABLED" && (
        <Link
          className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-[12.5px] underline-offset-2 hover:underline"
          data-context-open-settings
          to="/settings"
        >
          <span>{t("nav.settings")}</span>
          <ArrowRight aria-hidden className="size-3" />
        </Link>
      )}

      {context.status === "ASSEMBLED" && (
        <>
          <BudgetMeter context={context} />
          <div className="flex flex-col gap-3">
            {context.sections.map((section) => (
              <SectionBlock key={section.kind} projectId={context.projectId} section={section} />
            ))}
          </div>
          <ExcludedList excluded={context.excluded} />
          <ContextText text={context.text} />
        </>
      )}

      <PolicyLine context={context} run={run} />
    </>
  );
}

/* ------------------------------------------------------------- medidor */

function Bar({
  used,
  total,
  color,
  label,
  attr,
}: {
  used: number;
  total: number;
  color: string;
  label: string;
  attr: string;
}) {
  const percent = budgetPercent(used, total);
  return (
    <div
      aria-label={label}
      aria-valuemax={total}
      aria-valuemin={0}
      aria-valuenow={used}
      className="bg-border h-1.5 w-full overflow-hidden rounded-full"
      data-context-meter={attr}
      data-context-meter-percent={percent}
      role="meter"
    >
      <span
        className="block h-full rounded-full"
        style={{ width: `${String(percent)}%`, backgroundColor: color }}
      />
    </div>
  );
}

/**
 * O medidor: o total sobre o orçamento, e cada seção sobre o teto dela.
 *
 * O teto por seção é derivado do total (fatias fixas, `packages/context`),
 * então uma barra cheia numa seção e vazia noutra é exatamente o que
 * aconteceu: a seção estourou o teto dela mesmo com o total folgado.
 */
function BudgetMeter({ context }: { context: RunContextRecord }) {
  const { t, format } = useGlossary();
  const { budget, usage } = context;

  return (
    <div className="flex flex-col gap-2.5" data-context-budget>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[12.5px] font-medium">{t("context.budget.title")}</span>
        <span className="text-muted-foreground text-[11.5px]">
          {format(t("context.budget.usage"), {
            used: NUMBER.format(usage.estimatedTokens),
            total: NUMBER.format(budget.totalTokens),
          })}
          <span aria-hidden> · </span>
          {format(t("context.budget.frame"), { n: NUMBER.format(budget.frameTokens) })}
        </span>
      </div>
      <Bar
        attr="total"
        color={CONTEXT_COLOR}
        label={t("context.budget.title")}
        total={budget.totalTokens}
        used={usage.estimatedTokens}
      />

      <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {context.sections.map((section) => {
          const { label, icon: Icon } = CONTEXT_SECTION[section.kind];
          return (
            <div key={section.kind} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-[11.5px]">
                <Icon aria-hidden className="text-muted-foreground size-3" />
                <span className="min-w-0 truncate">{t(label)}</span>
                <span className="flex-1" />
                <span className="text-muted-foreground font-mono text-[10.5px]">
                  {`${NUMBER.format(section.tokens)} / ${NUMBER.format(section.budgetTokens)}`}
                </span>
                {section.truncated && <TruncatedMark />}
              </div>
              <Bar
                attr={section.kind}
                color={section.truncated ? "oklch(0.72 0.13 75)" : CONTEXT_COLOR}
                label={t(label)}
                total={section.budgetTokens}
                used={section.tokens}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TruncatedMark() {
  const { t } = useGlossary();
  return (
    <span
      className="flex h-4 flex-none items-center gap-1 rounded-full border px-1.5 text-[10px]"
      data-context-truncated
      style={{ borderColor: tint("oklch(0.72 0.13 75)", 45), color: "oklch(0.72 0.13 75)" }}
    >
      <Scissors aria-hidden className="size-2.5" />
      <span>{t("context.truncated")}</span>
    </span>
  );
}

/* --------------------------------------------------------------- seções */

function SectionBlock({
  section,
  projectId,
}: {
  section: ContextSectionRecord;
  projectId: string;
}) {
  const { t, format } = useGlossary();
  const itemsLabel = useItemsLabel();
  const { label, icon: Icon } = CONTEXT_SECTION[section.kind];

  return (
    <section
      className="border-border flex flex-col gap-1.5 rounded-[10px] border px-3 py-2.5"
      data-context-section={section.kind}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Icon aria-hidden className="size-3.5" style={{ color: CONTEXT_COLOR }} />
        <span className="text-[12.5px] font-medium">{t(label)}</span>
        <span className="text-muted-foreground text-[11px]">
          {itemsLabel(section.items.length)}
          <span aria-hidden> · </span>
          {format(t("context.tokens"), { n: NUMBER.format(section.tokens) })}
        </span>
        <span className="flex-1" />
        {section.truncated && <TruncatedMark />}
      </div>

      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {section.items.map((item) => (
          <ItemRow
            key={`${section.kind}:${item.id}`}
            item={item}
            origin={contextItemOrigin(item, projectId)}
            section={section.kind}
          />
        ))}
      </ul>
    </section>
  );
}

function OriginLink({ origin }: { origin: Exclude<ContextItemOrigin, null> }) {
  const { t } = useGlossary();
  const className =
    "hover:text-foreground text-muted-foreground flex flex-none items-center gap-1 text-[11.5px] underline-offset-2 hover:underline";
  const body = (
    <>
      <span>{t(CONTEXT_ORIGIN_LABEL[origin.kind])}</span>
      <ArrowRight aria-hidden className="size-3" />
    </>
  );

  switch (origin.kind) {
    case "knowledge":
      return (
        <Link
          className={className}
          data-context-item-link={origin.itemId}
          params={{ id: origin.projectId }}
          search={{ tab: "items", page: 1, item: origin.itemId }}
          to="/projects/$id/knowledge"
        >
          {body}
        </Link>
      );
    case "task":
      return (
        <Link
          className={className}
          data-context-item-link={origin.taskId}
          params={{ id: origin.taskId }}
          to="/tasks/$id"
        >
          {body}
        </Link>
      );
    case "run":
      return (
        <Link
          className={className}
          data-context-item-link={origin.runId}
          params={{ id: origin.runId }}
          to="/runs/$id"
        >
          {body}
        </Link>
      );
  }
}

function ItemRow({
  item,
  origin,
  section,
}: {
  item: ContextItemRecord;
  origin: ContextItemOrigin;
  section: ContextSectionKind;
}) {
  const { t, format } = useGlossary();

  return (
    <li
      className="flex flex-col gap-0.5"
      data-context-item={item.id}
      data-context-item-kind={item.kind}
      data-context-item-section={section}
    >
      <div className="flex items-center gap-2.5">
        <span className="min-w-0 flex-1 truncate text-[12.5px]" data-context-item-title>
          {item.title}
        </span>
        {item.truncated && <TruncatedMark />}
        {origin !== null && <OriginLink origin={origin} />}
      </div>
      <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-[11px]">
        <span data-context-item-reason={item.reason}>{t(CONTEXT_REASON[item.reason])}</span>
        {item.score !== null && (
          <>
            <span aria-hidden>·</span>
            <span data-context-item-score>
              {format(t("context.score"), { score: SCORE.format(item.score) })}
            </span>
          </>
        )}
        <span aria-hidden>·</span>
        <span className="font-mono text-[10.5px]" data-context-item-tokens={item.tokens}>
          {format(t("context.tokens"), { n: NUMBER.format(item.tokens) })}
        </span>
      </span>
    </li>
  );
}

/* ------------------------------------------------------------ excluídos */

function ExcludedList({ excluded }: { excluded: readonly ContextExclusionRecord[] }) {
  const { t, format } = useGlossary();

  return (
    <div className="flex flex-col gap-1.5" data-context-excluded={excluded.length}>
      <span className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
        {t("context.excluded.title")}
        {excluded.length > 0 && (
          <>
            <span aria-hidden> · </span>
            <span className="font-mono normal-case">{excluded.length}</span>
          </>
        )}
      </span>

      {excluded.length === 0 ? (
        <p className="text-muted-foreground m-0 text-[12px]">{t("context.excluded.none")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {excluded.map((exclusion) => (
            <li
              key={`${exclusion.section}:${exclusion.item.id}`}
              className="flex flex-col gap-0.5"
              data-context-excluded-item={exclusion.item.id}
              data-context-excluded-reason={exclusion.reason}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-muted-foreground flex-none text-[11px]">
                  {t(CONTEXT_SECTION[exclusion.section].label)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px]">
                  {exclusion.item.title}
                </span>
              </div>
              <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-[11px]">
                <span>{t(CONTEXT_EXCLUSION[exclusion.reason])}</span>
                <span aria-hidden>·</span>
                <span className="font-mono text-[10.5px]">
                  {format(t("context.tokens"), { n: NUMBER.format(exclusion.item.tokens) })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- texto */

/**
 * O bloco exato que foi ao prompt, recolhido por padrão.
 *
 * Um `<pre>` com quebra de linha: o texto tem tags XML escritas de propósito
 * (`<context>`, `<knowledge-item …>`) e precisa aparecer como está. Copiar
 * dá retorno visível por um segundo, como o `CopyRow` do cockpit.
 */
function ContextText({ text }: { text: string }) {
  const { t } = useGlossary();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1_500);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  return (
    <div className="flex flex-col gap-2" data-context-text-panel>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-medium">{t("context.text.title")}</span>
        <span className="text-muted-foreground font-mono text-[10.5px]">
          {`${NUMBER.format(text.length)} chars`}
        </span>
        <span className="flex-1" />
        <Button
          aria-expanded={open}
          data-context-text-toggle
          onClick={() => {
            setOpen((current) => !current);
          }}
          size="xs"
          variant="outline"
        >
          {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
          <span>{open ? t("context.text.hide") : t("context.text.show")}</span>
        </Button>
        <Button
          data-context-text-copy
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(
              () => {
                setCopied(true);
              },
              () => {
                // Um clipboard bloqueado não é erro de aplicação: o texto
                // continua na tela para ser selecionado à mão.
              },
            );
          }}
          size="xs"
          variant="outline"
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          <span>{copied ? t("context.text.copied") : t("context.text.copy")}</span>
        </Button>
      </div>

      {open && (
        <pre
          className="border-border m-0 max-h-120 overflow-auto rounded-[10px] border bg-white/[0.03] px-3 py-2.5 font-mono text-[11px] leading-4.5 whitespace-pre-wrap"
          data-context-text
        >
          {text}
        </pre>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- política */

function PolicyLine({ context, run }: { context: RunContextRecord; run: RunRecord }) {
  const { t, format } = useGlossary();
  const { policy } = context;

  return (
    <div
      className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
      data-context-policy
    >
      <span className="text-foreground">{t("context.policy.title")}</span>
      <span>
        {format(t("context.policy.source"), {
          version: `v${String(policy.source.loadout.version)}`,
        })}
      </span>
      <Fact label={t("settings.context.budgetTokens")} value={NUMBER.format(policy.budgetTokens)} />
      <Fact
        label={t("settings.context.maxKnowledgeItems")}
        value={NUMBER.format(policy.maxKnowledgeItems)}
      />
      <Fact label={t("settings.context.maxDecisions")} value={NUMBER.format(policy.maxDecisions)} />
      <Fact label={t("settings.context.maxArtifacts")} value={NUMBER.format(policy.maxArtifacts)} />
      {context.query !== null && (
        <span className="flex items-center gap-1.5" data-context-query>
          <span>{t("context.query")}</span>
          <code className="font-mono text-[10.5px] whitespace-pre-wrap">{context.query}</code>
        </span>
      )}
      <span className="flex-1" />
      <span className="font-mono text-[10.5px]">{run.loadoutSnapshot.name}</span>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      <span>{label}</span>
      <span className="text-foreground font-mono text-[10.5px]">{value}</span>
    </span>
  );
}
