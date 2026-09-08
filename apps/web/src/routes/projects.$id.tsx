import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Archive, ArchiveRestore, BookOpen, ListChecks, Plus, Waypoints } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Panel, PanelHeader } from "@/components/panel";
import { ActivityLog } from "@/components/projects/activity-log";
import { ProjectDialog } from "@/components/projects/project-dialog";
import { TaskCounts, totalTasks } from "@/components/projects/task-counts";
import { WorkspaceBadge } from "@/components/projects/workspace-badge";
import { ProposalsPanel } from "@/components/proposal/proposals-panel";
import { CreateTaskDialog } from "@/components/task/create-task-dialog";
import { TaskTable } from "@/components/task/task-table";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/datetime";
import type { SortOrder, TaskSortField } from "@/lib/domain";
import { useGlossary } from "@/lib/glossary";
import { usePendingKnowledge } from "@/lib/knowledge";
import { KNOWLEDGE_PENDING_COLOR } from "@/lib/knowledge-domain";
import { PROPOSAL_COLOR } from "@/lib/proposal-domain";
import { useProject, useProjectActivity, useSetProjectArchived } from "@/lib/projects";
import { projectDetailSearchSchema } from "@/lib/search";
import { useTasks } from "@/lib/tasks";
import { cn } from "@/lib/utils";

const ACTIVITY_PAGE_SIZE = 20;
const TASK_PAGE_SIZE = 25;

export const Route = createFileRoute("/projects/$id")({
  validateSearch: projectDetailSearchSchema,
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/projects/$id" });
  const { t, theme, format } = useGlossary();

  const project = useProject(id);
  const archive = useSetProjectArchived();
  const activity = useProjectActivity(id, search.activityPage, ACTIVITY_PAGE_SIZE);
  // Fase 6B: o atalho para o Grimório leva o número de Páginas que esperam o Selo.
  const pendingKnowledge = usePendingKnowledge(id);
  const pendingCount = pendingKnowledge.data?.total ?? 0;

  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sort, setSort] = useState<TaskSortField>("updatedAt");
  const [order, setOrder] = useState<SortOrder>("desc");
  const [page, setPage] = useState(1);

  const tasks = useTasks({ projectId: id, sort, order, page, pageSize: TASK_PAGE_SIZE });
  const projectTitles = useMemo(
    () => new Map(project.data === undefined ? [] : [[project.data.id, project.data.title]]),
    [project.data],
  );

  if (project.isPending) {
    return <p className="text-muted-foreground text-sm">Lendo…</p>;
  }

  if (project.isError) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-destructive text-sm">{project.error.message}</p>
        <Link className="text-sm underline underline-offset-2" to="/projects">
          {t("nav.projects")}
        </Link>
      </div>
    );
  }

  const detail = project.data;
  const archived = detail.status === "ARCHIVED";

  function toggleArchived() {
    archive.mutate(
      { id, archived: !archived },
      {
        onError: (error: Error) => {
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <nav
          aria-label="Trilha"
          className="text-muted-foreground flex items-center gap-1.5 text-xs"
        >
          <Link className="hover:text-foreground" to="/projects">
            {t("nav.projects")}
          </Link>
        </nav>

        <div className="flex items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1
              className={cn(
                "text-[30px] leading-9 font-semibold",
                theme === "dnd" ? "font-display" : "tracking-[-0.02em]",
              )}
            >
              {detail.title}
            </h1>
            <p className="text-muted-foreground text-sm leading-5">
              {detail.description ??
                format("Sem descrição. Existe desde {when}.", {
                  when: formatDate(detail.createdAt),
                })}
            </p>
            <WorkspaceBadge className="mt-1 self-start" project={detail} />
          </div>

          <div className="flex flex-none items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link
                data-project-knowledge-link
                params={{ id }}
                search={{ tab: "items", page: 1 }}
                to="/projects/$id/knowledge"
              >
                <BookOpen aria-hidden />
                <span>{t("nav.knowledge")}</span>
                {pendingCount > 0 && (
                  <span
                    aria-label={t("knowledge.pending.title")}
                    className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full border px-1.25 font-mono text-[10.5px] leading-none"
                    data-project-pending-knowledge={pendingCount}
                    style={{
                      borderColor: `color-mix(in oklch, ${KNOWLEDGE_PENDING_COLOR} 45%, transparent)`,
                      backgroundColor: `color-mix(in oklch, ${KNOWLEDGE_PENDING_COLOR} 14%, transparent)`,
                      color: KNOWLEDGE_PENDING_COLOR,
                    }}
                  >
                    {pendingCount}
                  </span>
                )}
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link data-project-graph-link params={{ id }} to="/projects/$id/graph">
                <Waypoints aria-hidden />
                <span>{t("entity.taskGraph")}</span>
              </Link>
            </Button>
            <Button
              onClick={() => {
                setEditing(true);
              }}
              size="sm"
              variant="outline"
            >
              Editar
            </Button>
            <Button disabled={archive.isPending} onClick={toggleArchived} size="sm" variant="ghost">
              {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
              <span>{archived ? "Desarquivar" : "Arquivar"}</span>
            </Button>
          </div>
        </div>
      </div>

      <Panel className="flex flex-col gap-3 p-5">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm font-medium">Visão geral</span>
          <span className="text-muted-foreground flex items-center gap-x-3 text-xs">
            {detail.openProposalCount > 0 && (
              <span
                data-project-open-proposals={detail.openProposalCount}
                style={{ color: PROPOSAL_COLOR }}
              >
                {format(
                  detail.openProposalCount === 1 ? "{n} {one} em aberto" : "{n} {many} em aberto",
                  {
                    n: detail.openProposalCount,
                    one: t("entity.proposedTask"),
                    many: t("entity.proposedTask.plural"),
                  },
                )}
              </span>
            )}
            <span>
              {format(totalTasks(detail.taskCounts) === 1 ? "{n} {one}" : "{n} {many}", {
                n: totalTasks(detail.taskCounts),
                one: t("entity.task"),
                many: t("entity.task.plural"),
              })}
            </span>
          </span>
        </div>
        <TaskCounts counts={detail.taskCounts} />
        {archived && (
          <p className="text-muted-foreground text-xs">
            {format("No arquivo desde {when}. Não aceita {tasks} novas enquanto estiver assim.", {
              when: detail.archivedAt === null ? "—" : formatDate(detail.archivedAt),
              tasks: t("entity.task.plural"),
            })}
          </p>
        )}
      </Panel>

      <ProposalsPanel projectId={id} showOriginTask />

      <Panel className="overflow-hidden">
        <PanelHeader
          title={t("entity.task.plural")}
          aside={
            <Button
              disabled={archived}
              onClick={() => {
                setCreating(true);
              }}
              size="xs"
              variant="outline"
            >
              <Plus aria-hidden />
              <span>{format("Nova {task}", { task: t("entity.task") })}</span>
            </Button>
          }
        />
        <TaskTable
          empty={
            <EmptyState
              icon={ListChecks}
              title={format("Nenhuma {task} aqui", { task: t("entity.task") })}
            >
              {format("O que for capturado e promovido para cá aparece nesta tabela.", {})}
            </EmptyState>
          }
          error={tasks.error}
          isPending={tasks.isPending}
          onPageChange={setPage}
          onSortChange={(nextSort, nextOrder) => {
            setSort(nextSort);
            setOrder(nextOrder);
            setPage(1);
          }}
          order={order}
          page={page}
          pageSize={TASK_PAGE_SIZE}
          projectTitles={projectTitles}
          showProject={false}
          sort={sort}
          tasks={tasks.data?.items ?? []}
          total={tasks.data?.total ?? 0}
        />
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader title="Diário" aside="Mais recentes primeiro" />
        <ActivityLog
          error={activity.error}
          isPending={activity.isPending}
          items={activity.data?.items ?? []}
          onPageChange={(next) => {
            void navigate({ search: { activityPage: next } });
          }}
          page={search.activityPage}
          pageSize={ACTIVITY_PAGE_SIZE}
          total={activity.data?.total ?? 0}
        />
      </Panel>

      <ProjectDialog open={editing} onOpenChange={setEditing} project={detail} />
      <CreateTaskDialog open={creating} onOpenChange={setCreating} projectId={id} />
    </>
  );
}
