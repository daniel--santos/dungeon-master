import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ListChecks, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { CreateTaskDialog } from "@/components/task/create-task-dialog";
import { TaskFilters, type TaskFilterValue } from "@/components/task/task-filters";
import { TaskTable } from "@/components/task/task-table";
import { Button } from "@/components/ui/button";
import type { SortOrder, TaskSortField } from "@/lib/domain";
import { useGlossary } from "@/lib/glossary";
import { useProjects } from "@/lib/projects";
import { taskSearchSchema } from "@/lib/search";
import { useTasks } from "@/lib/tasks";

export const Route = createFileRoute("/tasks/")({
  validateSearch: taskSearchSchema,
  component: TasksPage,
});

/**
 * A lista completa, com o filtro inteiro na URL.
 *
 * A URL é o estado: recarregar, voltar no histórico ou mandar o link para si
 * mesmo devolve a mesma tela. A ordenação e a paginação também vivem lá, porque
 * quem ordena por prioridade e manda o link espera a lista ordenada do outro lado.
 */
function TasksPage() {
  const { t, format } = useGlossary();
  const navigate = useNavigate({ from: "/tasks/" });
  const search = Route.useSearch();
  const [creating, setCreating] = useState(false);

  const projects = useProjects();
  const tasks = useTasks({
    projectId: search.projectId,
    kind: search.kind,
    priority: search.priority,
    status: search.status,
    q: search.q,
    sort: search.sort,
    order: search.order,
    page: search.page,
    pageSize: search.pageSize,
  });

  const projectTitles = useMemo(
    () => new Map((projects.data?.items ?? []).map((project) => [project.id, project.title])),
    [projects.data],
  );

  const filters = useMemo<TaskFilterValue>(
    () => ({
      projectId: search.projectId,
      kind: search.kind,
      priority: search.priority,
      status: search.status,
      q: search.q,
    }),
    [search],
  );

  const onFilterChange = useCallback(
    (next: TaskFilterValue) => {
      void navigate({
        search: (previous) => ({
          ...previous,
          projectId: next.projectId,
          kind: next.kind,
          priority: next.priority,
          status: next.status === undefined ? undefined : [...next.status],
          q: next.q,
          // Mudar o filtro invalida a página atual: a página 3 do filtro antigo
          // quase nunca existe no novo.
          page: 1,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  const onSortChange = useCallback(
    (sort: TaskSortField, order: SortOrder) => {
      void navigate({ search: (previous) => ({ ...previous, sort, order, page: 1 }) });
    },
    [navigate],
  );

  const onPageChange = useCallback(
    (page: number) => {
      void navigate({ search: (previous) => ({ ...previous, page }) });
    },
    [navigate],
  );

  const page = tasks.data;

  return (
    <>
      <PageHeader
        title={t("nav.tasks")}
        description={format(
          "Tudo que {agents} podem receber. Filtre por {project}, tipo, status e prioridade.",
          { agents: t("entity.agent.plural"), project: t("entity.project") },
        )}
        actions={
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus aria-hidden />
            <span>{format("Nova {task}", { task: t("entity.task") })}</span>
          </Button>
        }
      />

      <div className="flex flex-col gap-4">
        <TaskFilters
          onChange={onFilterChange}
          projects={projects.data?.items ?? []}
          total={page?.total ?? 0}
          value={filters}
        />

        <Panel className="overflow-hidden">
          <TaskTable
            empty={
              <EmptyState icon={ListChecks} title="Nada aqui com esse filtro">
                {format(
                  "Nenhum item casa com o que você pediu. Limpe os filtros, ou crie a primeira em {projects}.",
                  { projects: t("entity.project.plural") },
                )}
              </EmptyState>
            }
            error={tasks.error}
            isPending={tasks.isPending}
            onPageChange={onPageChange}
            onSortChange={onSortChange}
            order={search.order}
            page={search.page}
            pageSize={search.pageSize}
            projectTitles={projectTitles}
            sort={search.sort}
            tasks={page?.items ?? []}
            total={page?.total ?? 0}
          />
        </Panel>
      </div>

      <CreateTaskDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
