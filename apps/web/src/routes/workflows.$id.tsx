import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, History, Pencil, Trash2, WandSparkles } from "lucide-react";
import { useState } from "react";

import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { DefinitionText } from "@/components/workflow/definition-text";
import { DeleteWorkflowDialog } from "@/components/workflow/delete-workflow-dialog";
import { WorkflowEditorDialog } from "@/components/workflow/workflow-editor-dialog";
import { WorkflowGraph } from "@/components/workflow/workflow-graph";
import type { WorkflowRecord } from "@/lib/api-types";
import { formatDateTime, relativeTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";
import { useWorkflow, useWorkflowVersions } from "@/lib/workflows";
import { WORKFLOW_STEP_TYPE } from "@/lib/workflow-domain";

export const Route = createFileRoute("/workflows/$id")({
  component: WorkflowDetailPage,
});

function WorkflowDetailPage() {
  const { id } = Route.useParams();
  const { t } = useGlossary();
  const workflow = useWorkflow(id);

  if (workflow.isPending) {
    return <p className="text-muted-foreground text-sm">Lendo…</p>;
  }

  if (workflow.isError) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-destructive text-sm">{workflow.error.message}</p>
        <Link className="text-sm underline underline-offset-2" to="/workflows">
          {t("nav.workflows")}
        </Link>
      </div>
    );
  }

  return <Detail workflow={workflow.data} />;
}

/**
 * Um Ritual: o grafo, a definição e as versões que Expedições congelaram.
 *
 * O grafo é leitura; a edição é texto, no mesmo diálogo da criação. As
 * versões ficam ao lado da definição vigente de propósito: é a diferença
 * entre "o que vale para a próxima Expedição" e "o que as anteriores usaram".
 */
function Detail({ workflow }: { workflow: WorkflowRecord }) {
  const { t, theme, format } = useGlossary();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const steps = workflow.definition.steps;
  const gates = steps.filter((step) => step.type === "approval").length;

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <nav
          aria-label="Trilha"
          className="text-muted-foreground flex items-center gap-1.5 text-xs"
        >
          <Link className="hover:text-foreground" to="/workflows">
            {t("nav.workflows")}
          </Link>
          <ChevronRight aria-hidden className="size-3" />
          <span className="text-foreground max-w-md truncate">{workflow.name}</span>
        </nav>

        <div className="flex items-start justify-between gap-6">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-muted-foreground flex items-center gap-1.5 text-[11px] tracking-[0.1em] uppercase">
              <WandSparkles aria-hidden className="size-3" />
              <span>{t("entity.workflow")}</span>
            </span>
            <h1
              className={cn(
                "max-w-3xl text-[30px] leading-9.5 font-semibold",
                theme === "dnd" && "font-display",
              )}
            >
              {workflow.name}
            </h1>
            <p className="text-muted-foreground max-w-3xl text-sm leading-5">
              {workflow.description ?? "Sem descrição."}
            </p>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs">
              <span>
                {format(steps.length === 1 ? "{n} {one}" : "{n} {many}", {
                  n: steps.length,
                  one: t("entity.workflowStep").toLowerCase(),
                  many: t("entity.workflowStep.plural").toLowerCase(),
                })}
              </span>
              <span aria-hidden>·</span>
              <span>
                {format(gates === 1 ? "{n} {one}" : "{n} {many}", {
                  n: gates,
                  one: t("entity.approvalGate"),
                  many: t("entity.approvalGate.plural"),
                })}
              </span>
              <span aria-hidden>·</span>
              <span data-workflow-latest-version={workflow.latestVersion ?? 0}>
                {workflow.latestVersion === null
                  ? "nenhuma versão congelada"
                  : format("versão {n} congelada", { n: workflow.latestVersion })}
              </span>
              <span aria-hidden>·</span>
              <span>{format("Atualizado {when}", { when: relativeTime(workflow.updatedAt) })}</span>
            </div>
          </div>

          <div className="flex flex-none items-center gap-2">
            <Button
              onClick={() => {
                setEditing(true);
              }}
              size="sm"
              variant="outline"
            >
              <Pencil aria-hidden />
              <span>Editar</span>
            </Button>
            <Button
              className="text-muted-foreground"
              onClick={() => {
                setDeleting(true);
              }}
              size="sm"
              variant="ghost"
            >
              <Trash2 aria-hidden />
              <span>Apagar</span>
            </Button>
          </div>
        </div>
      </div>

      <Panel className="overflow-hidden">
        <div className="border-border flex h-11 items-center justify-between gap-3 border-b px-4">
          <span className="text-sm font-medium">{t("entity.workflowStep.plural")}</span>
          <span className="text-muted-foreground flex flex-wrap items-center gap-2 text-[11px]">
            {(Object.keys(WORKFLOW_STEP_TYPE) as (keyof typeof WORKFLOW_STEP_TYPE)[]).map(
              (type) => {
                const count = steps.filter((step) => step.type === type).length;
                if (count === 0) return null;
                const { icon: Icon, label, color } = WORKFLOW_STEP_TYPE[type];
                return (
                  <span key={type} className="flex items-center gap-1">
                    <Icon aria-hidden className="size-3" style={{ color }} />
                    <span>{`${String(count)} ${t(label)}`}</span>
                  </span>
                );
              },
            )}
          </span>
        </div>
        <WorkflowGraph definition={workflow.definition} />
      </Panel>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <DefinitionText definition={workflow.definition} />
        <Versions workflowId={workflow.id} />
      </div>

      <WorkflowEditorDialog onOpenChange={setEditing} open={editing} workflow={workflow} />
      <DeleteWorkflowDialog
        onDeleted={() => {
          void navigate({ to: "/workflows" });
        }}
        onOpenChange={setDeleting}
        open={deleting}
        workflow={workflow}
      />
    </>
  );
}

/** As versões congeladas, da mais recente para a mais antiga. */
function Versions({ workflowId }: { workflowId: string }) {
  const { t, format } = useGlossary();
  const [page, setPage] = useState(1);
  const versions = useWorkflowVersions(workflowId, page);
  const items = versions.data?.items ?? [];
  const total = versions.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / 20));

  return (
    <Panel className="flex flex-col overflow-hidden" data-workflow-versions-list>
      <div className="border-border flex h-11 flex-none items-center justify-between gap-3 border-b px-4">
        <div className="flex items-center gap-2">
          <History aria-hidden className="text-muted-foreground size-3.75" />
          <span className="text-sm font-medium">Versões</span>
        </div>
        <span className="text-muted-foreground text-[11px]">
          {versions.data === undefined ? "" : format("{n} congeladas", { n: total })}
        </span>
      </div>

      {versions.isError && (
        <p className="text-destructive px-4 py-4 text-sm">{versions.error.message}</p>
      )}
      {!versions.isError && items.length === 0 && (
        <p className="text-muted-foreground px-4 py-3.5 text-[12.5px] leading-4.5">
          {versions.isPending
            ? "Lendo…"
            : format(
                "Nenhuma ainda. A primeira é congelada quando uma {run} parte com este {workflow}; editar antes disso só muda a definição vigente.",
                { run: t("entity.run"), workflow: t("entity.workflow") },
              )}
        </p>
      )}

      {items.length > 0 && (
        <ul className="m-0 flex list-none flex-col p-0">
          {items.map((version) => (
            <li
              key={version.id}
              className="border-border flex items-center justify-between gap-3 border-b px-4 py-2.5 last:border-b-0"
              data-workflow-version={version.version}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-mono text-[12.5px] font-medium">
                  {`v${String(version.version)}`}
                </span>
                <span className="text-muted-foreground text-[11px]">
                  {format("{n} {steps}", {
                    n: version.definition.steps.length,
                    steps: t("entity.workflowStep.plural").toLowerCase(),
                  })}
                </span>
              </span>
              <span className="text-muted-foreground flex-none text-[11.5px]">
                {formatDateTime(version.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {total > 20 && (
        <div className="flex items-center justify-between px-4 py-2.5">
          <Button
            disabled={page <= 1}
            onClick={() => {
              setPage(page - 1);
            }}
            size="xs"
            variant="outline"
          >
            Anterior
          </Button>
          <span className="text-muted-foreground text-xs">
            {format("{page} de {lastPage}", { page, lastPage })}
          </span>
          <Button
            disabled={page >= lastPage}
            onClick={() => {
              setPage(page + 1);
            }}
            size="xs"
            variant="outline"
          >
            Próxima
          </Button>
        </div>
      )}
    </Panel>
  );
}
