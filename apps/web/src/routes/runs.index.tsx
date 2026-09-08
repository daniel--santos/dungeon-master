import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CirclePlay } from "lucide-react";
import { useCallback, useMemo } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { RunFilters, type RunFilterValue } from "@/components/run/run-filters";
import { RunTable } from "@/components/run/run-table";
import { useHarnesses } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";
import { useProjects } from "@/lib/projects";
import { useRuns } from "@/lib/runs";
import { runSearchSchema } from "@/lib/search";

export const Route = createFileRoute("/runs/")({
  validateSearch: runSearchSchema,
  component: RunsPage,
});

/**
 * Toda tentativa de resolver uma Task, com o que foi usado e como terminou.
 *
 * O filtro inteiro está na URL: `/runs?status=RUNNING` é o link que o cartão do
 * painel abre, e é o mesmo link que sobrevive a uma recarga ou a um `voltar`.
 */
function RunsPage() {
  const { t, format } = useGlossary();
  const navigate = useNavigate({ from: "/runs/" });
  const search = Route.useSearch();

  const projects = useProjects();
  const harnesses = useHarnesses();
  const runs = useRuns({
    projectId: search.projectId,
    harnessKey: search.harnessKey,
    status: search.status,
    page: search.page,
    pageSize: search.pageSize,
  });

  const filters = useMemo<RunFilterValue>(
    () => ({
      projectId: search.projectId,
      harnessKey: search.harnessKey,
      status: search.status,
    }),
    [search],
  );

  const onFilterChange = useCallback(
    (next: RunFilterValue) => {
      void navigate({
        search: (previous) => ({
          ...previous,
          projectId: next.projectId,
          harnessKey: next.harnessKey,
          status: next.status === undefined ? undefined : [...next.status],
          page: 1,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  const onPageChange = useCallback(
    (page: number) => {
      void navigate({ search: (previous) => ({ ...previous, page }) });
    },
    [navigate],
  );

  // Os três filtros vão para a API, então a página recebida já é a resposta e o
  // `total` do rodapé conta as linhas que o filtro deixa passar.
  const items = runs.data?.items ?? [];
  const running = items.filter((run) => run.status === "RUNNING").length;

  return (
    <>
      <PageHeader
        title={t("nav.runs")}
        description={format(
          "Toda tentativa de resolver uma {task}, com o que foi usado, quanto durou e como terminou.",
          { task: t("entity.task") },
        )}
      />

      <div className="flex flex-col gap-4">
        <RunFilters
          harnesses={harnesses.data?.items ?? []}
          onChange={onFilterChange}
          projects={projects.data?.items ?? []}
          running={running}
          total={runs.data?.total ?? 0}
          value={filters}
        />

        <Panel className="overflow-hidden">
          <RunTable
            empty={
              <EmptyState
                icon={CirclePlay}
                title={format("Nenhuma {run} com esse filtro", { run: t("entity.run") })}
              >
                {format(
                  "Abra uma {task} pronta e mande uma {run} partir; ela aparece aqui na hora, ainda {status}.",
                  {
                    task: t("entity.task"),
                    run: t("entity.run"),
                    status: t("run.status.queued").toLowerCase(),
                  },
                )}
              </EmptyState>
            }
            error={runs.error}
            isPending={runs.isPending}
            onPageChange={onPageChange}
            page={search.page}
            pageSize={search.pageSize}
            runs={items}
            total={runs.data?.total ?? 0}
          />
        </Panel>
      </div>
    </>
  );
}
