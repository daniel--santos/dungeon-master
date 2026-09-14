import { Plus, ScrollText, ShieldAlert, SquarePen, Trash2 } from "lucide-react";
import { useState } from "react";

import { PolicyDialog } from "@/components/autonomy/policy-dialog";
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
import type { ApprovalPolicyRecord, ProjectAutonomyRecord } from "@/lib/api-types";
import { useApprovalPolicies, useDeleteApprovalPolicy } from "@/lib/autonomy";
import { isPolicyInert, POLICY_ACTION, POLICY_SUBJECT } from "@/lib/autonomy-domain";
import { useGlossary } from "@/lib/glossary";
import type { AutonomyScope } from "@/lib/search";
import { cn } from "@/lib/utils";

export interface PolicyListProps {
  readonly projectId: string;
  readonly projectTitle: string;
  readonly scope: AutonomyScope;
  readonly autonomy: ProjectAutonomyRecord | undefined;
}

/**
 * As políticas de aprovação que decidem por esta Campanha (Fase 9C).
 *
 * Cada linha mostra o assunto, a ação, a prioridade, as condições e o
 * escopo; uma política que aprova sozinha num nível que não libera a
 * automação leva a marca de inerte, com o mesmo texto do formulário. A lista
 * vem da maior prioridade para a menor, que é a ordem em que a API decide.
 */
export function PolicyList({ projectId, projectTitle, scope, autonomy }: PolicyListProps) {
  const { t, format } = useGlossary();
  const policies = useApprovalPolicies(scope === "project" ? { projectId } : {});
  const remove = useDeleteApprovalPolicy();
  const projectTitles = useProjectTitles();

  const [editing, setEditing] = useState<ApprovalPolicyRecord | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<ApprovalPolicyRecord | null>(null);

  const items = policies.data?.items ?? [];

  function create() {
    setEditing(undefined);
    setOpen(true);
  }

  return (
    <>
      <Panel className="flex flex-col px-5 pt-4 pb-3.5" data-policy-list={items.length}>
        <ListHeader
          action={
            <Button onClick={create} size="xs" variant="outline">
              <Plus aria-hidden />
              <span>{t("policy.create.title")}</span>
            </Button>
          }
          count={policies.data?.total}
          description={t("policy.description")}
          icon={ScrollText}
          title={t("entity.policy.plural")}
        />

        <p className="text-muted-foreground m-0 pb-2 text-[11.5px] leading-4">
          {t("autonomy.failClosed")}
        </p>

        {policies.isPending && <p className="text-muted-foreground py-6 text-sm">Lendo…</p>}
        {policies.error !== null && (
          <p className="text-destructive py-6 text-sm">{policies.error.message}</p>
        )}

        {!policies.isPending && policies.error === null && items.length === 0 && (
          <EmptyState
            action={
              <Button onClick={create} size="sm" variant="outline">
                <Plus aria-hidden />
                <span>{t("policy.create.title")}</span>
              </Button>
            }
            icon={ScrollText}
            title={format("Nenhum {policy} ainda", { policy: t("entity.policy") })}
          >
            {t("policy.list.empty")}
          </EmptyState>
        )}

        {items.map((policy, index) => {
          const inert = isPolicyInert(policy, autonomy?.allows);
          const action = POLICY_ACTION[policy.action];
          return (
            <div
              key={policy.id}
              className={cn(
                "flex items-start gap-3 py-3",
                index > 0 && "border-border border-t",
                !policy.enabled && "opacity-60",
              )}
              data-policy={policy.name}
              data-policy-action={policy.action}
              data-policy-inert={inert ? "true" : "false"}
            >
              <span
                className="border-border mt-0.5 flex size-8 flex-none items-center justify-center rounded-lg border"
                style={{ backgroundColor: tint(action.color, 12) }}
              >
                <ScrollText aria-hidden className="size-3.75" style={{ color: action.color }} />
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium">{policy.name}</span>
                  <span className={CHIP}>{t(POLICY_SUBJECT[policy.subject])}</span>
                  <span
                    className={CHIP}
                    style={{ borderColor: tint(action.color, 45), color: action.color }}
                  >
                    {t(action.label)}
                  </span>
                  <span className="text-muted-foreground font-mono text-[10.5px]">
                    {format("prioridade {n}", { n: policy.priority })}
                  </span>
                  <ScopeChip
                    currentProjectId={projectId}
                    projectId={policy.projectId}
                    projectTitles={projectTitles}
                  />
                  {!policy.enabled && (
                    <span className="text-muted-foreground text-[10.5px]">desligada</span>
                  )}
                  {inert && (
                    <span
                      className={cn(CHIP, "text-[oklch(0.72_0.13_75)]")}
                      data-policy-inert-badge
                      style={{ borderColor: tint("oklch(0.72 0.13 75)", 45) }}
                      title={t("policy.inert.hint")}
                    >
                      <ShieldAlert aria-hidden className="size-3" />
                      <span>{t("policy.inert")}</span>
                    </span>
                  )}
                </div>
                <ConditionChips conditions={policy.conditions} />
              </div>

              <div className="flex flex-none items-center gap-1">
                <Button
                  aria-label={`Editar ${policy.name}`}
                  onClick={() => {
                    setEditing(policy);
                    setOpen(true);
                  }}
                  size="icon-sm"
                  variant="ghost"
                >
                  <SquarePen aria-hidden />
                </Button>
                <Button
                  aria-label={`Excluir ${policy.name}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setRemoving(policy);
                  }}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </div>
          );
        })}
      </Panel>

      <PolicyDialog
        autonomy={autonomy}
        onOpenChange={setOpen}
        open={open}
        policy={editing}
        projectId={projectId}
        projectTitle={projectTitle}
      />

      <DeleteRegistryDialog
        action={format("Apagar {policy}", { policy: t("entity.policy") })}
        body={t("policy.delete.body")}
        data-policy-delete-dialog=""
        done={t("policy.delete.done")}
        onOpenChange={(next) => {
          if (!next) setRemoving(null);
        }}
        pending={remove.isPending}
        remove={(id) => remove.mutateAsync(id)}
        target={removing}
        title={t("policy.delete.title")}
      />
    </>
  );
}
