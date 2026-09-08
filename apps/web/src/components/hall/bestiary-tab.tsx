import { Link } from "@tanstack/react-router";
import { BugIcon } from "lucide-react";
import { useMemo } from "react";

import { EmptyState } from "@/components/empty-state";
import { Panel, PanelHeader } from "@/components/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { useTaskReopenings } from "@/lib/heroes";
import { useProjects } from "@/lib/projects";
import { useRuns } from "@/lib/runs";
import { useTasks } from "@/lib/tasks";

/**
 * O Bestiário: as Tasks `BUG` já concluídas, e a Expedição que derrotou cada uma.
 *
 * `kind` é um fato do domínio desde a Fase 1, e é ele que faz esta tela existir
 * sem nenhuma coluna nova: o Bestiário é uma leitura de `GET /tasks`, não uma
 * tabela própria.
 *
 * A Expedição vem de uma consulta só, e não de uma por linha: `GET /runs` já
 * devolve `taskId`, então uma página de Runs vitoriosos vira o índice de quem
 * derrotou o quê. Uma chamada por Monstro seria N+1 numa tela de leitura.
 *
 * A coluna de nêmesis lê `GET /task-reopenings`: quantas vezes cada Monstro
 * saiu de `COMPLETED`, contado no diário com a mesma definição que instancia a
 * Conquista de nêmesis. A lista é esparsa, e um Monstro fora dela nunca foi
 * reaberto — a célula mostra o traço em vez de um zero.
 */

const DEFEATED_PAGE_SIZE = 100;

export function BestiaryTab() {
  const { t, format } = useGlossary();

  const tasks = useTasks({
    kind: "BUG",
    status: ["COMPLETED"],
    sort: "updatedAt",
    order: "desc",
    pageSize: DEFEATED_PAGE_SIZE,
  });

  // Vitoriosos, do mais recente para o mais antigo: é o que a lista já ordena.
  const runs = useRuns({ status: ["SUCCEEDED"], pageSize: DEFEATED_PAGE_SIZE });
  const projects = useProjects({ pageSize: DEFEATED_PAGE_SIZE });
  const reopenings = useTaskReopenings("BUG");

  /** O primeiro Run vitorioso de cada Task, que é o que a derrotou. */
  const slayer = useMemo(() => {
    const byTask = new Map<string, string>();
    for (const run of runs.data?.items ?? []) {
      if (!byTask.has(run.taskId)) byTask.set(run.taskId, run.id);
    }
    return byTask;
  }, [runs.data]);

  const projectName = useMemo(() => {
    const byId = new Map<string, string>();
    for (const project of projects.data?.items ?? []) byId.set(project.id, project.title);
    return byId;
  }, [projects.data]);

  const reopenCount = useMemo(() => {
    const byTask = new Map<string, number>();
    for (const item of reopenings.data?.items ?? []) byTask.set(item.taskId, item.count);
    return byTask;
  }, [reopenings.data]);

  const items = tasks.data?.items ?? [];

  if (tasks.isError) {
    return <p className="text-destructive text-sm">{tasks.error.message}</p>;
  }

  if (tasks.isPending) {
    return <p className="text-muted-foreground text-sm">Lendo…</p>;
  }

  if (items.length === 0) {
    return (
      <Panel>
        <EmptyState icon={BugIcon} title={t("hall.tab.bestiary")}>
          {format("Nada do tipo {bug} foi concluído ainda.", { bug: t("entity.task.kind.bug") })}
        </EmptyState>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader
        aside={format("{count} no total", { count: tasks.data.total })}
        title={t("hall.tab.bestiary")}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-4">{t("entity.task")}</TableHead>
            <TableHead className="w-56 px-4">{t("entity.project")}</TableHead>
            <TableHead className="w-32 px-4">{t("hall.bestiary.defeatedAt")}</TableHead>
            <TableHead className="w-52 px-4">{t("hall.bestiary.slayer")}</TableHead>
            <TableHead className="w-28 px-4">{t("hall.bestiary.nemesis")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((task) => {
            const runId = slayer.get(task.id);
            const at = task.completedAt ?? task.updatedAt;
            const reopened = reopenCount.get(task.id);

            return (
              <TableRow key={task.id} data-bestiary-task={task.id}>
                <TableCell className="px-4">
                  <Link
                    className="hover:text-foreground block truncate underline-offset-2 hover:underline"
                    params={{ id: task.id }}
                    to="/tasks/$id"
                  >
                    {task.title}
                  </Link>
                </TableCell>

                <TableCell className="text-muted-foreground w-56 truncate px-4 text-[12.5px]">
                  {(task.projectId === null ? undefined : projectName.get(task.projectId)) ?? "—"}
                </TableCell>

                <TableCell className="text-muted-foreground w-32 px-4 text-[12.5px]">
                  {formatDate(at)}
                </TableCell>

                <TableCell className="w-52 px-4 text-[12.5px]">
                  {runId === undefined ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <Link
                      className="hover:text-foreground underline-offset-2 hover:underline"
                      params={{ id: runId }}
                      to="/runs/$id"
                    >
                      {t("run.cockpit")}
                    </Link>
                  )}
                </TableCell>

                <TableCell
                  className="text-muted-foreground w-28 px-4 text-[12.5px]"
                  data-bestiary-reopened={reopened ?? 0}
                >
                  {reopened === undefined
                    ? "—"
                    : format(reopened === 1 ? "{n} reabertura" : "{n} reaberturas", {
                        n: reopened,
                      })}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Panel>
  );
}
