import type { TaskStatus } from "@dungeon-master/contracts";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Map, Plus, Waypoints } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { TaskGraph } from "@/components/graph/task-graph";
import { Panel } from "@/components/panel";
import { CreateTaskDialog } from "@/components/task/create-task-dialog";
import { Button } from "@/components/ui/button";
import { TASK_STATUS, TASK_STATUSES } from "@/lib/domain";
import { useGlossary } from "@/lib/glossary";
import { useProject } from "@/lib/projects";
import { taskGraphSearchSchema } from "@/lib/search";
import { useTaskGraph } from "@/lib/task-graph";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/projects/$id_/graph")({
  validateSearch: taskGraphSearchSchema,
  component: TaskGraphPage,
});

/**
 * O Mapa da Campanha (Fase 5B): a tela do grafo de Tasks de um Project.
 *
 * Vive na própria URL, `/projects/:id/graph`, e não numa aba do Project, para
 * um link levar direto ao desenho e para o filtro de estado sobreviver na
 * barra de endereço. O que está em `/projects/:id` é o que o Project tem; o
 * que está aqui é como esse trabalho se encadeia.
 */
function TaskGraphPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/projects/$id/graph" });
  const { t, theme, format } = useGlossary();

  const project = useProject(id);
  const graph = useTaskGraph(id);
  const [creating, setCreating] = useState(false);

  const statuses = search.status ?? [];

  function toggleStatus(status: TaskStatus) {
    const next = statuses.includes(status)
      ? statuses.filter((candidate) => candidate !== status)
      : [...statuses, status];
    void navigate({
      search: { status: next.length === 0 ? undefined : next },
      replace: true,
    });
  }

  if (project.isPending || graph.isPending) {
    return <p className="text-muted-foreground text-sm">Lendo…</p>;
  }

  if (project.isError || graph.isError) {
    const message = project.isError
      ? project.error.message
      : graph.isError
        ? graph.error.message
        : "";
    return (
      <div className="flex flex-col gap-4">
        <p className="text-destructive text-sm">{message}</p>
        <Link className="text-sm underline underline-offset-2" to="/projects">
          {t("nav.projects")}
        </Link>
      </div>
    );
  }

  const detail = project.data;
  const data = graph.data;
  const empty = data.nodes.length === 0;
  const dependencies = data.edges.length;

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
          <ChevronRight aria-hidden className="size-3" />
          <Link className="hover:text-foreground" params={{ id }} to="/projects/$id">
            {detail.title}
          </Link>
          <ChevronRight aria-hidden className="size-3" />
          <span className="text-foreground">{t("entity.taskGraph")}</span>
        </nav>

        <div className="flex items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-muted-foreground flex items-center gap-1.5 text-[11px] tracking-[0.1em] uppercase">
              <Map aria-hidden className="size-3" />
              <span>{t("entity.project")}</span>
            </span>
            <h1
              className={cn(
                "text-[30px] leading-9 font-semibold",
                theme === "dnd" ? "font-display" : "tracking-[-0.02em]",
              )}
            >
              {t("entity.taskGraph")}
            </h1>
            <p className="text-muted-foreground max-w-3xl text-sm leading-5">
              {t("graph.connect.hint")}
            </p>
          </div>

          <div className="flex flex-none items-center gap-2">
            <Button
              disabled={detail.status === "ARCHIVED"}
              onClick={() => {
                setCreating(true);
              }}
              size="sm"
              variant="outline"
            >
              <Plus aria-hidden />
              <span>{format("Nova {task}", { task: t("entity.task") })}</span>
            </Button>
          </div>
        </div>
      </div>

      {!empty && (
        <div className="flex flex-wrap items-center gap-2" data-task-graph-filter>
          <span className="text-muted-foreground text-xs">Status:</span>
          {TASK_STATUSES.map((status) => {
            const active = statuses.includes(status);
            const { label, dot } = TASK_STATUS[status];
            return (
              <button
                key={status}
                aria-pressed={active}
                className={cn(
                  "border-border flex h-[24px] items-center gap-1.5 rounded-lg border px-2 text-xs transition-colors",
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-task-graph-status={status}
                onClick={() => {
                  toggleStatus(status);
                }}
                type="button"
              >
                <span
                  aria-hidden
                  className="size-1.5 flex-none rounded-full"
                  style={{ backgroundColor: dot }}
                />
                <span>{t(label)}</span>
              </button>
            );
          })}
          {statuses.length > 0 && (
            <Button
              onClick={() => {
                void navigate({ search: { status: undefined }, replace: true });
              }}
              size="xs"
              variant="ghost"
            >
              Limpar
            </Button>
          )}

          <span className="flex-1" />

          <span className="text-muted-foreground flex items-center gap-x-3 text-xs">
            <span>
              {format(data.nodes.length === 1 ? "{n} {one}" : "{n} {many}", {
                n: data.nodes.length,
                one: t("entity.task"),
                many: t("entity.task.plural"),
              })}
            </span>
            <span aria-hidden>·</span>
            <span>
              {format(dependencies === 1 ? "{n} ligação" : "{n} ligações", { n: dependencies })}
            </span>
          </span>
        </div>
      )}

      <Panel className="overflow-hidden">
        {empty ? (
          <EmptyState
            action={
              <Button
                className="mt-1"
                disabled={detail.status === "ARCHIVED"}
                onClick={() => {
                  setCreating(true);
                }}
                size="sm"
              >
                <Plus aria-hidden />
                <span>{format("Nova {task}", { task: t("entity.task") })}</span>
              </Button>
            }
            icon={Waypoints}
            title={t("graph.empty.title")}
          >
            {t("graph.empty.body")}
          </EmptyState>
        ) : (
          <>
            <TaskGraph graph={data} statuses={statuses} />
            <div className="border-border text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-1 border-t px-4 py-2.5 text-[11px]">
              <span className="flex items-center gap-2">
                <svg aria-hidden className="h-2 w-8" viewBox="0 0 32 8">
                  <line stroke="var(--ring)" strokeWidth="1.5" x1="0" x2="26" y1="4" y2="4" />
                  <path d="M24 1 L30 4 L24 7 Z" fill="var(--ring)" />
                </svg>
                <span>{t("graph.legend.dependency")}</span>
              </span>
              <span className="flex items-center gap-2">
                <svg aria-hidden className="h-2 w-8" viewBox="0 0 32 8">
                  <line
                    stroke="var(--muted-foreground)"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                    x1="0"
                    x2="32"
                    y1="4"
                    y2="4"
                  />
                </svg>
                <span>{t("graph.legend.parent")}</span>
              </span>
            </div>
          </>
        )}
      </Panel>

      <CreateTaskDialog onOpenChange={setCreating} open={creating} projectId={id} />
    </>
  );
}
