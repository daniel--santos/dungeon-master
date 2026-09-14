import type { RuleConditionKey } from "@dungeon-master/contracts";
import { Globe, type LucideIcon } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import type { RuleConditionsRecord } from "@/lib/api-types";
import {
  AUTONOMY_COLOR,
  conditionValues,
  DECIDED_BY_ICON,
  parseDecidedBy,
  presentConditions,
  RULE_CONDITION,
} from "@/lib/autonomy-domain";
import { TASK_KIND, TASK_PRIORITY } from "@/lib/domain";
import { ENFORCEMENT, EXECUTION_MODE } from "@/lib/execution-domain";
import { useHarnesses, useLoadouts } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";
import { useProjects } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { WORKFLOW_STEP_TYPE } from "@/lib/workflow-domain";

/**
 * As peças que as quatro listas da autonomia repetem (Fase 9C): o chip de
 * escopo, os chips de condição e a linha que nomeia quem decidiu.
 */

export const CHIP =
  "border-border inline-flex h-[22px] w-fit max-w-full items-center gap-1.5 rounded-lg border bg-white/[0.04] px-2 text-xs whitespace-nowrap";

export function tint(color: string, percent: number): string {
  return `color-mix(in oklch, ${color} ${String(percent)}%, transparent)`;
}

/** Global, ou o Project a que a regra pertence (pelo título quando conhecido). */
export function ScopeChip({
  projectId,
  projectTitles,
  currentProjectId,
}: {
  projectId: string | null;
  projectTitles: ReadonlyMap<string, string>;
  /** Na tela de uma Campanha, as regras dela não repetem o nome. */
  currentProjectId?: string;
}) {
  const { t } = useGlossary();

  if (projectId === null) {
    return (
      <span className={CHIP} data-rule-scope="global">
        <Globe aria-hidden className="text-muted-foreground size-3" />
        <span>{t("autonomy.scope.global")}</span>
      </span>
    );
  }

  if (projectId === currentProjectId) return null;

  return (
    <span className={cn(CHIP, "text-muted-foreground")} data-rule-scope={projectId}>
      <span className="truncate">{projectTitles.get(projectId) ?? "…"}</span>
    </span>
  );
}

/** Os títulos dos Projects, para as regras globais e as de outras Campanhas. */
export function useProjectTitles(): ReadonlyMap<string, string> {
  const projects = useProjects({ pageSize: 100 });
  return useMemo(
    () => new Map((projects.data?.items ?? []).map((project) => [project.id, project.title])),
    [projects.data],
  );
}

/**
 * Resolve o texto de um valor de condição pelo glossário: o tipo da Task, a
 * prioridade, o modo, o enforcement, o tipo de step; um Loadout ou Project
 * pelo nome; o resto como veio.
 */
export function useConditionValueLabel(): (key: RuleConditionKey, value: string) => string {
  const { t } = useGlossary();
  const harnesses = useHarnesses();
  const loadouts = useLoadouts();
  const projectTitles = useProjectTitles();

  return useMemo(() => {
    const harnessNames = new Map<string, string>(
      (harnesses.data?.items ?? []).map((harness) => [harness.key, harness.name]),
    );
    const loadoutNames = new Map<string, string>(
      (loadouts.data?.items ?? []).map((loadout) => [loadout.id, loadout.name]),
    );

    return (key, value) => {
      switch (key) {
        case "executionMode": {
          if (!(value in EXECUTION_MODE)) return value;
          // Segurança nunca é tematizada a ponto de sumir: "Campo aberto" vem
          // sempre com "sem isolamento", também num chip de condição.
          const mode = EXECUTION_MODE[value as keyof typeof EXECUTION_MODE];
          return mode.warning === null ? t(mode.label) : `${t(mode.label)} · ${t(mode.warning)}`;
        }
        case "harnessKey":
          return harnessNames.get(value) ?? value;
        case "taskKind":
          return value in TASK_KIND ? t(TASK_KIND[value as keyof typeof TASK_KIND].label) : value;
        case "taskPriority":
          return value in TASK_PRIORITY
            ? t(TASK_PRIORITY[value as keyof typeof TASK_PRIORITY].label)
            : value;
        case "enforcement":
          return value in ENFORCEMENT
            ? t(ENFORCEMENT[value as keyof typeof ENFORCEMENT].label)
            : value;
        case "stepType":
          return value in WORKFLOW_STEP_TYPE
            ? t(WORKFLOW_STEP_TYPE[value as keyof typeof WORKFLOW_STEP_TYPE].label)
            : value;
        case "hasCommandTools":
          return value === "true" ? "sim" : "não";
        case "loadoutId":
          return loadoutNames.get(value) ?? value;
        case "projectId":
          return projectTitles.get(value) ?? value;
        case "maxEstimatedTokens":
          return `≤ ${value}`;
        case "minBudgetPressure":
          return `≥ ${String(Math.round(Number(value) * 100))}%`;
      }
    };
  }, [harnesses.data, loadouts.data, projectTitles, t]);
}

/** As condições de uma regra como chips: `rótulo: valor | valor`. Vazio diz "casa com tudo". */
export function ConditionChips({ conditions }: { conditions: RuleConditionsRecord }) {
  const { t } = useGlossary();
  const label = useConditionValueLabel();
  const present = presentConditions(conditions);

  if (present.length === 0) {
    return (
      <span className="text-muted-foreground text-[11.5px]" data-rule-conditions="none">
        {t("policy.conditions.hint")}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-rule-conditions={present.length}>
      {present.map((key) => (
        <span key={key} className={CHIP} data-rule-condition={key}>
          <span className="text-muted-foreground">{t(RULE_CONDITION[key].label)}:</span>
          <span className="truncate">
            {conditionValues(conditions, key)
              .map((value) => label(key, value))
              .join(" · ")}
          </span>
        </span>
      ))}
    </div>
  );
}

export interface DecidedByNames {
  readonly policies?: ReadonlyMap<string, string>;
  readonly routingRules?: ReadonlyMap<string, string>;
  readonly budgets?: ReadonlyMap<string, string>;
  readonly breakers?: ReadonlyMap<string, string>;
}

/**
 * Quem decidiu, em texto: `POLICY:<id>` vira o nome da política, e assim por
 * diante. Sem o nome à mão (a regra foi apagada, ou a lista ainda não veio),
 * o id encurtado aparece no lugar, em vez de nada.
 */
export function useDecidedByText(names: DecidedByNames = {}): (decidedBy: string) => string {
  const { t, format } = useGlossary();

  return useMemo(() => {
    const nameOf = (map: ReadonlyMap<string, string> | undefined, id: string) =>
      map?.get(id) ?? `#${id.slice(0, 8)}`;

    return (decidedBy: string) => {
      const parsed = parseDecidedBy(decidedBy);
      switch (parsed.kind) {
        case "policy":
          return format(t("autonomy.decidedBy.policy"), {
            name: nameOf(names.policies, parsed.id),
          });
        case "routing":
          return format(t("autonomy.decidedBy.routing"), {
            name: nameOf(names.routingRules, parsed.id),
          });
        case "budget":
          return format(t("autonomy.decidedBy.budget"), { name: nameOf(names.budgets, parsed.id) });
        case "breaker":
          return format(t("autonomy.decidedBy.breaker"), {
            name: nameOf(names.breakers, parsed.id),
          });
        case "tie":
          return format(t("autonomy.decidedBy.tie"), {
            names: parsed.ids.map((id) => nameOf(names.policies, id)).join(", "),
          });
        case "autonomy":
          return format(t("autonomy.decidedBy.autonomy"), { level: parsed.level });
        case "default":
          return t("autonomy.decidedBy.default");
        case "reset":
          return t("autonomy.decidedBy.reset");
        case "unknown":
          return t("autonomy.decidedBy.unknown");
      }
    };
  }, [format, names.breakers, names.budgets, names.policies, names.routingRules, t]);
}

/** A linha "quem decidiu · por quê", com o ícone de quem decidiu. */
export function DecidedByLine({
  decidedBy,
  reason,
  names,
  className,
  ...rest
}: {
  decidedBy: string;
  reason: string | null;
  names?: DecidedByNames;
  className?: string;
  readonly [attribute: `data-${string}`]: string | undefined;
}) {
  const text = useDecidedByText(names);
  const Icon = DECIDED_BY_ICON[parseDecidedBy(decidedBy).kind];

  return (
    <span
      className={cn("flex min-w-0 flex-col gap-0.5 text-[12px] leading-4.5", className)}
      data-decided-by={decidedBy}
      {...rest}
    >
      <span className="flex items-center gap-1.5 font-medium">
        <Icon aria-hidden className="size-3.25 flex-none" style={{ color: AUTONOMY_COLOR }} />
        <span className="truncate">{text(decidedBy)}</span>
      </span>
      {reason !== null && reason !== "" && (
        <span className="text-muted-foreground whitespace-pre-wrap">{reason}</span>
      )}
    </span>
  );
}

/** O cabeçalho de uma das listas: ícone, título, contagem e descrição. */
export function ListHeader({
  icon: Icon,
  title,
  count,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  count: number | undefined;
  description: string;
  action?: ReactNode;
}) {
  const { format } = useGlossary();

  return (
    <div className="flex flex-col gap-1.5 pb-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Icon aria-hidden className="size-3.75" style={{ color: AUTONOMY_COLOR }} />
          <span className="text-sm font-medium">{title}</span>
          {count !== undefined && (
            <span className="text-muted-foreground text-xs">
              {format("{n} cadastrados", { n: count })}
            </span>
          )}
        </div>
        {action}
      </div>
      <p className="text-muted-foreground m-0 text-[12.5px] leading-5">{description}</p>
    </div>
  );
}
