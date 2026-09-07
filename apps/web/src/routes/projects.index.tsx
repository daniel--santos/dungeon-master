import type { components } from "@dungeon-master/api-client";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Folder, Pencil, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { ProjectDialog } from "@/components/projects/project-dialog";
import { TaskCounts } from "@/components/projects/task-counts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { relativeTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { useProjectCounts, useProjects, useSetProjectArchived } from "@/lib/projects";
import { projectSearchSchema } from "@/lib/search";

type Project = components["schemas"]["Project"];

const ANY = "__any__";

export const Route = createFileRoute("/projects/")({
  validateSearch: projectSearchSchema,
  component: ProjectsPage,
});

function ProjectsPage() {
  const { t, format } = useGlossary();
  const navigate = useNavigate({ from: "/projects/" });
  const search = Route.useSearch();

  const [editing, setEditing] = useState<Project | null>(null);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<Project | null>(null);

  const projects = useProjects({ status: search.status });
  const items = useMemo(() => projects.data?.items ?? [], [projects.data]);
  const counts = useProjectCounts(items.map((project) => project.id));
  const archive = useSetProjectArchived();

  function confirmArchive() {
    if (archiving === null) return;
    const archived = archiving.status === "ACTIVE";

    archive.mutate(
      { id: archiving.id, archived },
      {
        onSuccess: () => {
          setArchiving(null);
        },
        onError: (error: Error) => {
          setArchiving(null);
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <>
      <PageHeader
        title={t("nav.projects")}
        description={format(
          "Onde o trabalho mora. Cada uma guarda as suas {tasks}, o seu diário e o contexto que não cabe numa delas.",
          { tasks: t("entity.task.plural") },
        )}
        actions={
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus aria-hidden />
            <span>{format("Nova {project}", { project: t("entity.project") })}</span>
          </Button>
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Select
            value={search.status ?? ANY}
            onValueChange={(next) => {
              void navigate({
                search: { status: next === ANY ? undefined : (next as "ACTIVE" | "ARCHIVED") },
                replace: true,
              });
            }}
          >
            <SelectTrigger aria-label="Status" className="w-45">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Todas</SelectItem>
              <SelectItem value="ACTIVE">Ativas</SelectItem>
              <SelectItem value="ARCHIVED">Arquivadas</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex-1" />

          <span className="text-muted-foreground text-xs">
            {format(projects.data?.total === 1 ? "{n} {one}" : "{n} {many}", {
              n: projects.data?.total ?? 0,
              one: t("entity.project"),
              many: t("entity.project.plural"),
            })}
          </span>
        </div>

        <Panel className="overflow-hidden">
          {projects.isError && (
            <p className="text-destructive px-5 py-6 text-sm">{projects.error.message}</p>
          )}

          {projects.isPending && <p className="text-muted-foreground px-5 py-6 text-sm">Lendo…</p>}

          {!projects.isPending && !projects.isError && items.length === 0 && (
            <EmptyState
              icon={Folder}
              title={format("Nenhuma {project} ainda", { project: t("entity.project") })}
            >
              {format(
                "Abra a primeira e o resto passa a ter onde morar: {tasks}, dependências e o diário de tudo que aconteceu.",
                { tasks: t("entity.task.plural") },
              )}
            </EmptyState>
          )}

          {items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-4">Título</TableHead>
                  <TableHead className="w-28 px-4">Status</TableHead>
                  <TableHead className="px-4">{t("entity.task.plural")}</TableHead>
                  <TableHead className="w-28 px-4">Atualizada</TableHead>
                  <TableHead className="w-28 px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell className="px-4">
                      <Link
                        className="underline-offset-2 hover:underline"
                        params={{ id: project.id }}
                        to="/projects/$id"
                      >
                        {project.title}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground px-4 text-xs">
                      {project.status === "ACTIVE" ? "Ativa" : "Arquivada"}
                    </TableCell>
                    <TableCell className="px-4 whitespace-normal">
                      {(() => {
                        const found = counts.get(project.id);
                        return found === undefined ? (
                          <span className="text-muted-foreground text-xs">…</span>
                        ) : (
                          <TaskCounts compact counts={found} />
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-muted-foreground px-4 text-xs">
                      {relativeTime(project.updatedAt)}
                    </TableCell>
                    <TableCell className="px-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          onClick={() => {
                            setEditing(project);
                          }}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <Pencil aria-hidden />
                          <span className="sr-only">Editar</span>
                        </Button>
                        <Button
                          onClick={() => {
                            setArchiving(project);
                          }}
                          size="icon-sm"
                          variant="ghost"
                        >
                          {project.status === "ACTIVE" ? (
                            <Archive aria-hidden />
                          ) : (
                            <ArchiveRestore aria-hidden />
                          )}
                          <span className="sr-only">
                            {project.status === "ACTIVE" ? "Arquivar" : "Desarquivar"}
                          </span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>

      <ProjectDialog open={creating} onOpenChange={setCreating} />
      <ProjectDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        project={editing}
      />

      <AlertDialog
        open={archiving !== null}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {archiving?.status === "ACTIVE" ? "Arquivar?" : "Trazer de volta?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archiving?.status === "ACTIVE"
                ? format(
                    "Nada é apagado: o que está aqui continua legível, e o que estava arquivado deixa de aceitar {tasks} novas.",
                    { tasks: t("entity.task.plural") },
                  )
                : format("Volta a aceitar {tasks} novas, com todo o histórico intacto.", {
                    tasks: t("entity.task.plural"),
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={archive.isPending} onClick={confirmArchive}>
              {archiving?.status === "ACTIVE" ? "Arquivar" : "Desarquivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
