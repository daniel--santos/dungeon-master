import { Plus, Signpost, SquarePen, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { RoutingRuleDialog } from "@/components/autonomy/routing-rule-dialog";
import {
  CHIP,
  ConditionChips,
  ListHeader,
  ScopeChip,
  tint,
  useProjectTitles,
} from "@/components/autonomy/shared";
import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { DeleteRegistryDialog } from "@/components/registry/delete-registry-dialog";
import { Button } from "@/components/ui/button";
import type { RoutingRuleRecord } from "@/lib/api-types";
import { useDeleteRoutingRule, useRoutingRules } from "@/lib/autonomy";
import { AUTONOMY_COLOR, ROUTING_KIND } from "@/lib/autonomy-domain";
import { useLoadouts, useModels } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";
import type { AutonomyScope } from "@/lib/search";
import { cn } from "@/lib/utils";
import { useWorkflows } from "@/lib/workflows";

export interface RoutingRuleListProps {
  readonly projectId: string;
  readonly projectTitle: string;
  readonly scope: AutonomyScope;
}

/**
 * As regras de roteamento que valem para esta Campanha (Fase 9C): a espécie,
 * o alvo preferido e os reservas pelo nome, a prioridade, as condições e o
 * escopo. Um alvo apagado aparece como tal, porque a regra continua a existir
 * e a partida vai pular para o reserva seguinte.
 */
export function RoutingRuleList({ projectId, projectTitle, scope }: RoutingRuleListProps) {
  const { t, format } = useGlossary();
  const rules = useRoutingRules(scope === "project" ? { projectId } : {});
  const remove = useDeleteRoutingRule();
  const projectTitles = useProjectTitles();
  const models = useModels();
  const loadouts = useLoadouts();
  const workflows = useWorkflows();

  const [editing, setEditing] = useState<RoutingRuleRecord | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<RoutingRuleRecord | null>(null);

  const items = rules.data?.items ?? [];

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const model of models.data?.items ?? []) map.set(model.id, model.name);
    for (const loadout of loadouts.data?.items ?? []) map.set(loadout.id, loadout.name);
    for (const workflow of workflows.data?.items ?? []) map.set(workflow.id, workflow.name);
    return map;
  }, [loadouts.data, models.data, workflows.data]);

  function create() {
    setEditing(undefined);
    setOpen(true);
  }

  return (
    <>
      <Panel className="flex flex-col px-5 pt-4 pb-3.5" data-routing-list={items.length}>
        <ListHeader
          action={
            <Button onClick={create} size="xs" variant="outline">
              <Plus aria-hidden />
              <span>{t("routing.create.title")}</span>
            </Button>
          }
          count={rules.data?.total}
          description={t("routing.description")}
          icon={Signpost}
          title={t("entity.routingRule.plural")}
        />

        {rules.isPending && <p className="text-muted-foreground py-6 text-sm">Lendo…</p>}
        {rules.error !== null && (
          <p className="text-destructive py-6 text-sm">{rules.error.message}</p>
        )}

        {!rules.isPending && rules.error === null && items.length === 0 && (
          <EmptyState
            action={
              <Button onClick={create} size="sm" variant="outline">
                <Plus aria-hidden />
                <span>{t("routing.create.title")}</span>
              </Button>
            }
            icon={Signpost}
            title={format("Nenhum {rule} ainda", { rule: t("entity.routingRule") })}
          >
            {t("routing.list.empty")}
          </EmptyState>
        )}

        {items.map((rule, index) => (
          <div
            key={rule.id}
            className={cn(
              "flex items-start gap-3 py-3",
              index > 0 && "border-border border-t",
              !rule.enabled && "opacity-60",
            )}
            data-routing-rule={rule.name}
            data-routing-kind={rule.kind}
          >
            <span
              className="border-border mt-0.5 flex size-8 flex-none items-center justify-center rounded-lg border"
              style={{ backgroundColor: tint(AUTONOMY_COLOR, 12) }}
            >
              <Signpost aria-hidden className="size-3.75" style={{ color: AUTONOMY_COLOR }} />
            </span>

            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium">{rule.name}</span>
                <span className={CHIP}>{t(ROUTING_KIND[rule.kind])}</span>
                <span className="text-muted-foreground font-mono text-[10.5px]">
                  {format("prioridade {n}", { n: rule.priority })}
                </span>
                <ScopeChip
                  currentProjectId={projectId}
                  projectId={rule.projectId}
                  projectTitles={projectTitles}
                />
                {!rule.enabled && (
                  <span className="text-muted-foreground text-[10.5px]">desligada</span>
                )}
              </div>

              <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
                <span className="flex items-center gap-1">
                  <span>{t("routing.target")}:</span>
                  <span
                    className={cn(
                      "text-foreground font-medium",
                      !names.has(rule.targetId) && "text-destructive",
                    )}
                    data-routing-target={rule.targetId}
                  >
                    {names.get(rule.targetId) ?? t("routing.target.missing")}
                  </span>
                </span>
                {rule.fallbackIds.length > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="flex flex-wrap items-center gap-1">
                      <span>{t("routing.fallbacks")}:</span>
                      {rule.fallbackIds.map((id, position) => (
                        <span key={id} data-routing-fallback={id}>
                          {`${String(position + 1)}. ${names.get(id) ?? t("routing.target.missing")}`}
                        </span>
                      ))}
                    </span>
                  </>
                )}
              </span>

              <ConditionChips conditions={rule.conditions} />
            </div>

            <div className="flex flex-none items-center gap-1">
              <Button
                aria-label={`Editar ${rule.name}`}
                onClick={() => {
                  setEditing(rule);
                  setOpen(true);
                }}
                size="icon-sm"
                variant="ghost"
              >
                <SquarePen aria-hidden />
              </Button>
              <Button
                aria-label={`Excluir ${rule.name}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  setRemoving(rule);
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

      <RoutingRuleDialog
        onOpenChange={setOpen}
        open={open}
        projectId={projectId}
        projectTitle={projectTitle}
        rule={editing}
      />

      <DeleteRegistryDialog
        action={format("Apagar {rule}", { rule: t("entity.routingRule") })}
        body={t("routing.delete.body")}
        data-routing-delete-dialog=""
        done={t("routing.delete.done")}
        onOpenChange={(next) => {
          if (!next) setRemoving(null);
        }}
        pending={remove.isPending}
        remove={(id) => remove.mutateAsync(id)}
        target={removing}
        title={t("routing.delete.title")}
      />
    </>
  );
}
