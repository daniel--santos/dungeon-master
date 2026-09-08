import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus, WandSparkles } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WorkflowEditorDialog } from "@/components/workflow/workflow-editor-dialog";
import { relativeTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { useWorkflows } from "@/lib/workflows";

export const Route = createFileRoute("/workflows/")({
  component: WorkflowsPage,
});

/**
 * Os Rituais (Fase 4C): o processo de uma Expedição, separado do Herói.
 *
 * Uma lista curta e a criação por texto. Cada linha diz quantas versões já
 * foram congeladas — é o número que separa um Ritual em rascunho de um que
 * já conduziu Expedições, e é ele que decide se apagar vai ser aceito.
 */
function WorkflowsPage() {
  const { t, format } = useGlossary();
  const navigate = useNavigate();
  const workflows = useWorkflows();
  const [creating, setCreating] = useState(false);

  const items = workflows.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={t("nav.workflows")}
        description={format(
          "O processo de uma {run}, separado da inteligência do {agent}: {steps} com dependências, condições e o {gate} em que ela para para você decidir.",
          {
            run: t("entity.run"),
            agent: t("entity.agent"),
            steps: t("entity.workflowStep.plural").toLowerCase(),
            gate: t("entity.approvalGate"),
          },
        )}
        actions={
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus aria-hidden />
            <span>{format("Novo {workflow}", { workflow: t("entity.workflow") })}</span>
          </Button>
        }
      />

      <Panel className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-4">Nome</TableHead>
              <TableHead className="px-4">Descrição</TableHead>
              <TableHead className="w-24 px-4 text-right">
                {t("entity.workflowStep.plural")}
              </TableHead>
              <TableHead className="w-24 px-4 text-right">Versões</TableHead>
              <TableHead className="w-32 px-4">Atualizado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((workflow) => (
              <TableRow key={workflow.id} data-workflow={workflow.name}>
                <TableCell className="w-0 min-w-0 px-4">
                  <Link
                    className="hover:text-foreground block max-w-xs truncate font-medium underline-offset-2 hover:underline"
                    params={{ id: workflow.id }}
                    to="/workflows/$id"
                  >
                    {workflow.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground max-w-0 truncate px-4 text-[12.5px]">
                  {workflow.description ?? "—"}
                </TableCell>
                <TableCell className="w-24 px-4 text-right font-mono text-[12.5px]">
                  {workflow.definition.steps.length}
                </TableCell>
                <TableCell
                  className="w-24 px-4 text-right font-mono text-[12.5px]"
                  data-workflow-versions={workflow.latestVersion ?? 0}
                >
                  {workflow.latestVersion ?? 0}
                </TableCell>
                <TableCell className="text-muted-foreground w-32 px-4 text-[12.5px]">
                  {relativeTime(workflow.updatedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {workflows.isError && (
          <p className="text-destructive px-4 py-6 text-sm">{workflows.error.message}</p>
        )}
        {workflows.isPending && <p className="text-muted-foreground px-4 py-6 text-sm">Lendo…</p>}
        {!workflows.isPending && !workflows.isError && items.length === 0 && (
          <EmptyState
            icon={WandSparkles}
            title={format("Nenhum {workflow} ainda", { workflow: t("entity.workflow") })}
          >
            {format(
              "Escreva um em YAML ou JSON, ou comece pelo exemplo. Uma {task} escolhe o {workflow}, e cada {run} congela a definição que valia ao partir.",
              { task: t("entity.task"), workflow: t("entity.workflow"), run: t("entity.run") },
            )}
          </EmptyState>
        )}
      </Panel>

      <WorkflowEditorDialog
        onOpenChange={setCreating}
        onSaved={(workflow) => {
          void navigate({ to: "/workflows/$id", params: { id: workflow.id } });
        }}
        open={creating}
      />
    </>
  );
}
