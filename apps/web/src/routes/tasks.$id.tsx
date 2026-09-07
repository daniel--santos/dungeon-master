import type { components } from "@dungeon-master/api-client";
import type { TaskStatus } from "@dungeon-master/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, CirclePlay, GitBranch, Package, Plus, Swords, X } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { NewRunDialog } from "@/components/run/new-run-dialog";
import { RunTable } from "@/components/run/run-table";
import { KindChip, PriorityText, StatusChip } from "@/components/task/chips";
import { DependencyPicker } from "@/components/task/dependency-picker";
import { EnvironmentCard } from "@/components/task/environment-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, relativeTime } from "@/lib/datetime";
import { canTransition, TASK_KIND } from "@/lib/domain";
import { useGlossary } from "@/lib/glossary";
import { useProject } from "@/lib/projects";
import { useRuns } from "@/lib/runs";
import {
  useChangeTaskStatus,
  useCreateTask,
  useRemoveDependency,
  useTask,
  useUpdateTask,
} from "@/lib/tasks";
import { cn } from "@/lib/utils";

type TaskDetail = components["schemas"]["TaskDetail"];
type TaskSummary = components["schemas"]["TaskSummary"];

export const Route = createFileRoute("/tasks/$id")({
  component: TaskDetailPage,
});

function TaskDetailPage() {
  const { id } = Route.useParams();
  const { t } = useGlossary();
  const task = useTask(id);

  if (task.isPending) {
    return <p className="text-muted-foreground text-sm">Lendo…</p>;
  }

  if (task.isError) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-destructive text-sm">{task.error.message}</p>
        <Link className="text-sm underline underline-offset-2" to="/tasks">
          {t("nav.tasks")}
        </Link>
      </div>
    );
  }

  return <Detail detail={task.data} />;
}

function Detail({ detail }: { detail: TaskDetail }) {
  const { t, theme, format } = useGlossary();
  const update = useUpdateTask();
  const change = useChangeTaskStatus();

  const [editing, setEditing] = useState(false);
  const [departing, setDeparting] = useState(false);
  const [title, setTitle] = useState(detail.title);
  const [description, setDescription] = useState(detail.description ?? "");

  const project = useProject(detail.projectId);
  const projectTitle = detail.projectId === null ? null : (project.data?.title ?? "…");

  function startEditing() {
    setTitle(detail.title);
    setDescription(detail.description ?? "");
    setEditing(true);
  }

  function save() {
    update.mutate(
      {
        id: detail.id,
        title: title.trim(),
        description: description.trim() === "" ? null : description.trim(),
      },
      {
        onSuccess: () => {
          setEditing(false);
        },
        onError: (error: Error) => {
          toast.error(error.message);
        },
      },
    );
  }

  function move(to: TaskStatus, done: string) {
    change.mutate(
      { id: detail.id, to },
      {
        onSuccess: () => {
          toast.success(done);
        },
        onError: (error: Error) => {
          // O `detail` do problem details explica a recusa: subtarefa pendente,
          // dependência não concluída, transição que não existe.
          toast.error(error.message);
        },
      },
    );
  }

  // Criar um Run exige a Task em READY, ou em FAILED como retentativa
  // (documento técnico, seção 36). As outras regras — dependência pendente,
  // Project sem workspace — a API confere, e a recusa chega com o motivo.
  const canDepart = detail.status === "READY" || detail.status === "FAILED";
  const canComplete = canTransition(detail.status, "COMPLETED");
  const canCancel = canTransition(detail.status, "CANCELLED");
  const canReopen = canTransition(detail.status, "READY");

  const resolved = detail.children.filter(
    (child) => child.status === "COMPLETED" || child.status === "CANCELLED",
  ).length;

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <nav
          aria-label="Trilha"
          className="text-muted-foreground flex items-center gap-1.5 text-xs"
        >
          <Link className="hover:text-foreground" to="/tasks">
            {t("nav.tasks")}
          </Link>
          {detail.projectId !== null && (
            <>
              <ChevronRight aria-hidden className="size-3" />
              <Link
                className="hover:text-foreground"
                params={{ id: detail.projectId }}
                to="/projects/$id"
              >
                {projectTitle}
              </Link>
            </>
          )}
          <ChevronRight aria-hidden className="size-3" />
          <span className="text-foreground max-w-md truncate">{detail.title}</span>
        </nav>

        <div className="flex items-start justify-between gap-6">
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            {editing ? (
              <Input
                className="h-11 max-w-3xl text-lg md:text-lg"
                maxLength={200}
                onChange={(event) => {
                  setTitle(event.target.value);
                }}
                value={title}
              />
            ) : (
              <h1
                className={cn(
                  "max-w-3xl text-[30px] leading-9.5 font-semibold",
                  theme === "dnd" && "font-display",
                )}
              >
                {detail.title}
              </h1>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <KindChip kind={detail.kind} />
              <StatusChip status={detail.status} />
              <span className="text-muted-foreground self-center text-xs">
                {format("Atualizada {when}", { when: relativeTime(detail.updatedAt) })}
              </span>
            </div>
          </div>

          <div className="flex flex-none items-center gap-2">
            {editing ? (
              <>
                <Button
                  onClick={() => {
                    setEditing(false);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Cancelar
                </Button>
                <Button disabled={title.trim() === "" || update.isPending} onClick={save} size="sm">
                  Salvar
                </Button>
              </>
            ) : (
              <>
                <Button onClick={startEditing} size="sm" variant="outline">
                  Editar
                </Button>
                {canDepart && (
                  <Button
                    onClick={() => {
                      setDeparting(true);
                    }}
                    size="sm"
                  >
                    <Swords aria-hidden />
                    <span>{format("Nova {run}", { run: t("entity.run") })}</span>
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {!editing && (canComplete || canCancel || canReopen) && (
          <div className="flex flex-wrap items-center gap-2">
            {canComplete && (
              <Button
                disabled={change.isPending}
                onClick={() => {
                  move(
                    "COMPLETED",
                    format("Agora está em {status}.", { status: t("task.status.completed") }),
                  );
                }}
                size="sm"
              >
                Concluir
              </Button>
            )}
            {canReopen && (
              <Button
                disabled={change.isPending}
                onClick={() => {
                  move("READY", "De volta ao trabalho.");
                }}
                size="sm"
                variant="outline"
              >
                Reabrir
              </Button>
            )}
            {canCancel && (
              <Button
                className="text-muted-foreground"
                disabled={change.isPending}
                onClick={() => {
                  move(
                    "CANCELLED",
                    format("Agora está em {status}.", { status: t("task.status.cancelled") }),
                  );
                }}
                size="sm"
                variant="ghost"
              >
                Cancelar
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4">
          <Panel className="flex flex-col gap-2.5 p-5">
            <span className="text-sm font-medium">Descrição</span>
            {editing ? (
              <Textarea
                onChange={(event) => {
                  setDescription(event.target.value);
                }}
                rows={8}
                value={description}
              />
            ) : detail.description === null || detail.description === "" ? (
              <p className="text-muted-foreground text-sm leading-5.5">
                Sem descrição. Clique em Editar para contar o que precisa ser feito.
              </p>
            ) : (
              <p className="text-muted-foreground text-sm leading-5.5 whitespace-pre-wrap">
                {detail.description}
              </p>
            )}
          </Panel>

          <Subtasks detail={detail} resolved={resolved} />

          <Panel className="overflow-hidden">
            <Tabs className="gap-0" defaultValue="runs">
              <div className="border-border border-b px-3 py-2.5">
                <TabsList className="bg-transparent p-0">
                  <TabsTrigger value="runs">{t("entity.run.plural")}</TabsTrigger>
                  <TabsTrigger value="artifacts">{t("entity.artifact.plural")}</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="runs">
                <TaskRuns detail={detail} />
              </TabsContent>

              <TabsContent value="artifacts">
                <EmptyState
                  icon={Package}
                  title={format("Nenhum {artifact} ainda", { artifact: t("entity.artifact") })}
                >
                  {format(
                    "O que uma execução produz e você guarda aparece aqui, junto com a Fase 2.",
                    {},
                  )}
                </EmptyState>
              </TabsContent>
            </Tabs>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel className="flex flex-col px-5 pt-4 pb-4.5">
            <span className="pb-2 text-sm font-medium">Detalhes</span>
            <MetaRow label={t("entity.project")}>
              {detail.projectId === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <Link
                  className="underline-offset-2 hover:underline"
                  params={{ id: detail.projectId }}
                  to="/projects/$id"
                >
                  {projectTitle}
                </Link>
              )}
            </MetaRow>
            <MetaRow label="Tipo">
              <KindChip kind={detail.kind} />
            </MetaRow>
            <MetaRow label="Status">
              <StatusChip status={detail.status} />
            </MetaRow>
            <MetaRow label="Prioridade">
              <PriorityText priority={detail.priority} />
            </MetaRow>
            <MetaRow label={t("entity.subtask.plural")}>
              {format("{done} de {total}", { done: resolved, total: detail.children.length })}
            </MetaRow>
            <MetaRow label="Dependências">
              {format("{in} entrada · {out} saída", {
                in: detail.dependencies.length,
                out: detail.dependents.length,
              })}
            </MetaRow>
            <MetaRow label={t("task.field.createdAt")}>{formatDate(detail.createdAt)}</MetaRow>
            {detail.completedAt !== null && (
              <MetaRow label={format("{status} em", { status: t("task.status.completed") })}>
                {formatDate(detail.completedAt)}
              </MetaRow>
            )}
          </Panel>

          <Dependencies detail={detail} />

          <EnvironmentCard />
        </div>
      </div>

      <NewRunDialog onOpenChange={setDeparting} open={departing} task={detail} />
    </>
  );
}

/**
 * As Expedições desta Task, na mesma tabela da lista.
 *
 * Reaproveitar a tabela é o que garante que o ambiente, o status e a duração
 * sejam lidos do mesmo jeito nos dois lugares. Aqui a coluna da Task sai: ela
 * repetiria o título que está no cabeçalho da tela.
 */
function TaskRuns({ detail }: { detail: TaskDetail }) {
  const { t, format } = useGlossary();
  const [page, setPage] = useState(1);
  const runs = useRuns({ taskId: detail.id, page, pageSize: 10 });

  return (
    <RunTable
      empty={
        <EmptyState
          icon={CirclePlay}
          title={format("Nenhuma {run} ainda", { run: t("entity.run") })}
        >
          {format(
            "Cada tentativa de resolver esta {task} aparece aqui, com o seu {timeline} e o resultado.",
            { task: t("entity.task"), timeline: t("run.timeline") },
          )}
        </EmptyState>
      }
      error={runs.error}
      isPending={runs.isPending}
      onPageChange={setPage}
      page={page}
      pageSize={10}
      runs={runs.data?.items ?? []}
      showTask={false}
      total={runs.data?.total ?? 0}
    />
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-muted-foreground flex-none text-xs">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

/** As etapas: subtarefas da mesma Task, com criação em linha. */
function Subtasks({ detail, resolved }: { detail: TaskDetail; resolved: number }) {
  const { t, format } = useGlossary();
  const create = useCreateTask();
  const change = useChangeTaskStatus();
  const [title, setTitle] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === "" || detail.projectId === null || create.isPending) return;

    create.mutate(
      { projectId: detail.projectId, parentTaskId: detail.id, title: trimmed },
      {
        onSuccess: () => {
          setTitle("");
        },
        onError: (error: Error) => {
          toast.error(error.message);
        },
      },
    );
  }

  function complete(child: TaskSummary) {
    change.mutate(
      { id: child.id, to: "COMPLETED" },
      {
        onError: (error: Error) => {
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <Panel className="flex flex-col gap-1 p-5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-medium">{t("entity.subtask.plural")}</span>
        <span className="text-muted-foreground text-xs">
          {format("{done} de {total}", { done: resolved, total: detail.children.length })}
        </span>
      </div>

      {detail.children.map((child) => {
        const done = child.status === "COMPLETED";
        const closed = done || child.status === "CANCELLED";
        return (
          <div key={child.id} className="flex items-center gap-2.5 py-2.25">
            <Checkbox
              aria-label={child.title}
              checked={done}
              disabled={closed || !canTransition(child.status, "COMPLETED") || change.isPending}
              onCheckedChange={(checked) => {
                if (checked === true) complete(child);
              }}
            />
            <Link
              className={cn(
                "flex-1 truncate text-sm underline-offset-2 hover:underline",
                closed && "text-muted-foreground line-through",
              )}
              params={{ id: child.id }}
              to="/tasks/$id"
            >
              {child.title}
            </Link>
            <span className="text-muted-foreground flex-none text-xs">
              {t(TASK_KIND[child.kind].label)}
            </span>
          </div>
        );
      })}

      {detail.projectId !== null && (
        <form className="mt-2 flex items-center gap-2" onSubmit={submit}>
          <Input
            className="h-8"
            maxLength={200}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            placeholder={format("Mais uma {subtask}", { subtask: t("entity.subtask") })}
            value={title}
          />
          <Button
            disabled={title.trim() === "" || create.isPending}
            size="icon-sm"
            type="submit"
            variant="outline"
          >
            <Plus aria-hidden />
            <span className="sr-only">Adicionar</span>
          </Button>
        </form>
      )}
    </Panel>
  );
}

function Dependencies({ detail }: { detail: TaskDetail }) {
  const remove = useRemoveDependency();

  const excluded = useMemo(
    () =>
      new Set<string>([
        detail.id,
        ...detail.dependencies.map((task) => task.id),
        ...detail.dependents.map((task) => task.id),
      ]),
    [detail],
  );

  function drop(dependsOnId: string) {
    remove.mutate(
      { id: detail.id, dependsOnId },
      {
        onError: (error: Error) => {
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <Panel className="flex flex-col px-5 pt-4 pb-4.5">
      <div className="flex items-center justify-between gap-2 pb-1">
        <div className="flex items-center gap-2">
          <GitBranch aria-hidden className="text-muted-foreground size-3.5" />
          <span className="text-sm font-medium">Dependências</span>
        </div>
        <DependencyPicker excluded={excluded} taskId={detail.id} />
      </div>

      {detail.dependencies.length === 0 && detail.dependents.length === 0 && (
        <p className="text-muted-foreground py-2 text-xs leading-4.5">
          Nada ligado ainda. Uma ligação diz o que precisa terminar antes, e o que fica esperando
          por esta.
        </p>
      )}

      {detail.dependencies.length > 0 && (
        <DependencyGroup label="Depende de">
          {detail.dependencies.map((task) => (
            <DependencyRow
              key={task.id}
              onRemove={() => {
                drop(task.id);
              }}
              task={task}
            />
          ))}
        </DependencyGroup>
      )}

      {detail.dependents.length > 0 && (
        <DependencyGroup label="Bloqueia">
          {detail.dependents.map((task) => (
            <DependencyRow key={task.id} task={task} />
          ))}
        </DependencyGroup>
      )}
    </Panel>
  );
}

function DependencyGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-border flex flex-col gap-1.5 border-t py-2.5 first-of-type:border-t-0">
      <span className="text-muted-foreground text-[11px] tracking-[0.04em] uppercase">{label}</span>
      {children}
    </div>
  );
}

function DependencyRow({ task, onRemove }: { task: TaskSummary; onRemove?: () => void }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Link
          className="text-[13px] leading-4.5 underline-offset-2 hover:underline"
          params={{ id: task.id }}
          to="/tasks/$id"
        >
          {task.title}
        </Link>
        <StatusChip status={task.status} />
      </div>
      {onRemove !== undefined && (
        <Button className="flex-none" onClick={onRemove} size="icon-xs" variant="ghost">
          <X aria-hidden />
          <span className="sr-only">Remover</span>
        </Button>
      )}
    </div>
  );
}
