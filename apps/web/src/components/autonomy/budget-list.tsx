import { Landmark, Plus, SquarePen, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { BudgetDialog } from "@/components/autonomy/budget-dialog";
import { BudgetUsagePanel } from "@/components/autonomy/budget-usage";
import { CHIP, ListHeader, ScopeChip, tint, useProjectTitles } from "@/components/autonomy/shared";
import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { DeleteRegistryDialog } from "@/components/registry/delete-registry-dialog";
import { Button } from "@/components/ui/button";
import type { BudgetRecord } from "@/lib/api-types";
import { useBudgets, useDeleteBudget } from "@/lib/autonomy";
import { AUTONOMY_COLOR, BUDGET_ACTION, BUDGET_SCOPE, BUDGET_WINDOW } from "@/lib/autonomy-domain";
import { useLoadouts } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";
import type { AutonomyScope } from "@/lib/search";
import { cn } from "@/lib/utils";

export interface BudgetListProps {
  readonly projectId: string;
  readonly projectTitle: string;
  readonly scope: AutonomyScope;
}

/**
 * Os orçamentos que valem para esta Campanha (Fase 9C), cada um com o
 * consumo medido na janela atual: uma barra por teto, a pressão colorida e
 * a incerteza quando algum Run terminou sem reportar tokens.
 */
export function BudgetList({ projectId, projectTitle, scope }: BudgetListProps) {
  const { t, format } = useGlossary();
  const budgets = useBudgets(scope === "project" ? { projectId } : {});
  const remove = useDeleteBudget();
  const projectTitles = useProjectTitles();
  const loadouts = useLoadouts();

  const [editing, setEditing] = useState<BudgetRecord | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<BudgetRecord | null>(null);

  const items = budgets.data?.items ?? [];
  const loadoutNames = useMemo(
    () => new Map((loadouts.data?.items ?? []).map((loadout) => [loadout.id, loadout.name])),
    [loadouts.data],
  );

  function create() {
    setEditing(undefined);
    setOpen(true);
  }

  return (
    <>
      <Panel className="flex flex-col px-5 pt-4 pb-3.5" data-budget-list={items.length}>
        <ListHeader
          action={
            <Button onClick={create} size="xs" variant="outline">
              <Plus aria-hidden />
              <span>{t("budget.create.title")}</span>
            </Button>
          }
          count={budgets.data?.total}
          description={t("budget.description")}
          icon={Landmark}
          title={t("entity.budget.plural")}
        />

        {budgets.isPending && <p className="text-muted-foreground py-6 text-sm">Lendo…</p>}
        {budgets.error !== null && (
          <p className="text-destructive py-6 text-sm">{budgets.error.message}</p>
        )}

        {!budgets.isPending && budgets.error === null && items.length === 0 && (
          <EmptyState
            action={
              <Button onClick={create} size="sm" variant="outline">
                <Plus aria-hidden />
                <span>{t("budget.create.title")}</span>
              </Button>
            }
            icon={Landmark}
            title={format("Nenhum {budget} ainda", { budget: t("entity.budget") })}
          >
            {t("budget.list.empty")}
          </EmptyState>
        )}

        {items.map((budget, index) => (
          <div
            key={budget.id}
            className={cn(
              "flex items-start gap-3 py-3",
              index > 0 && "border-border border-t",
              !budget.enabled && "opacity-60",
            )}
            data-budget={budget.name}
            data-budget-action={budget.action}
          >
            <span
              className="border-border mt-0.5 flex size-8 flex-none items-center justify-center rounded-lg border"
              style={{ backgroundColor: tint(AUTONOMY_COLOR, 12) }}
            >
              <Landmark aria-hidden className="size-3.75" style={{ color: AUTONOMY_COLOR }} />
            </span>

            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium">{budget.name}</span>
                <span className={CHIP}>{t(BUDGET_WINDOW[budget.window])}</span>
                <span className={CHIP}>{t(BUDGET_ACTION[budget.action])}</span>
                {budget.scope === "GLOBAL" ? (
                  <ScopeChip projectId={null} projectTitles={projectTitles} />
                ) : budget.scope === "PROJECT" ? (
                  <ScopeChip
                    currentProjectId={projectId}
                    projectId={budget.projectId}
                    projectTitles={projectTitles}
                  />
                ) : (
                  <span className={cn(CHIP, "text-muted-foreground")} data-rule-scope="loadout">
                    {format("{scope} · {name}", {
                      scope: t(BUDGET_SCOPE.LOADOUT),
                      name: loadoutNames.get(budget.loadoutId ?? "") ?? "…",
                    })}
                  </span>
                )}
                {!budget.enabled && (
                  <span className="text-muted-foreground text-[10.5px]">desligado</span>
                )}
              </div>
              <BudgetUsagePanel budget={budget} />
            </div>

            <div className="flex flex-none items-center gap-1">
              <Button
                aria-label={`Editar ${budget.name}`}
                onClick={() => {
                  setEditing(budget);
                  setOpen(true);
                }}
                size="icon-sm"
                variant="ghost"
              >
                <SquarePen aria-hidden />
              </Button>
              <Button
                aria-label={`Excluir ${budget.name}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  setRemoving(budget);
                }}
                size="icon-sm"
                variant="ghost"
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          </div>
        ))}
      </Panel>

      <BudgetDialog
        budget={editing}
        onOpenChange={setOpen}
        open={open}
        projectId={projectId}
        projectTitle={projectTitle}
      />

      <DeleteRegistryDialog
        action={format("Apagar {budget}", { budget: t("entity.budget") })}
        body={t("budget.delete.body")}
        data-budget-delete-dialog=""
        done={t("budget.delete.done")}
        onOpenChange={(next) => {
          if (!next) setRemoving(null);
        }}
        pending={remove.isPending}
        remove={(id) => remove.mutateAsync(id)}
        target={removing}
        title={t("budget.delete.title")}
      />
    </>
  );
}
