import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { RunStatusChip } from "@/components/execution/chips";
import { EnvBadge } from "@/components/execution/env-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RunRecord } from "@/lib/api-types";
import { relativeTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { formatDuration, runDurationMs } from "@/lib/runs";
import { useTaskTitles } from "@/lib/tasks";
import { cn } from "@/lib/utils";

export interface RunTableProps {
  readonly runs: readonly RunRecord[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly onPageChange: (page: number) => void;
  /** Fora quando a tabela já vive dentro de uma Task. */
  readonly showTask?: boolean;
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly empty: ReactNode;
}

/**
 * A tabela de Expedições.
 *
 * Cada linha responde às cinco perguntas que se faz de uma execução: sobre o
 * quê, com quem, onde, como terminou e quanto durou. O ambiente aparece por
 * linha, e não só no cockpit, porque uma lista cheia de execuções sem
 * isolamento é uma informação que se lê de relance.
 *
 * A ordem é do servidor, do mais recente para o mais antigo, e não há
 * ordenação por coluna: `GET /api/v1/runs` não a oferece, e ordenar só a página
 * daria uma ordem que muda quando se vira a folha.
 */
export function RunTable({
  runs,
  total,
  page,
  pageSize,
  onPageChange,
  showTask = true,
  isPending,
  error,
  empty,
}: RunTableProps) {
  const { t, format } = useGlossary();
  const titles = useTaskTitles(runs.map((run) => run.taskId));

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {showTask && <TableHead className="px-4">{t("entity.task")}</TableHead>}
            <TableHead className="w-45 px-4">
              {format("{agent} · {harness}", {
                agent: t("entity.agent"),
                harness: t("entity.harness"),
              })}
            </TableHead>
            <TableHead className="w-50 px-4">Ambiente</TableHead>
            <TableHead className="w-31 px-4">Status</TableHead>
            <TableHead className="w-21 px-4">Duração</TableHead>
            <TableHead className="w-26 px-4">Iniciada</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {runs.map((run) => {
            const duration = runDurationMs(run);
            const snapshot = run.loadoutSnapshot;
            return (
              <TableRow key={run.id} className={cn(run.status === "RUNNING" && "bg-white/[0.03]")}>
                {showTask && (
                  <TableCell className="w-0 min-w-0 px-4">
                    <Link
                      className="hover:text-foreground block truncate underline-offset-2 hover:underline"
                      params={{ id: run.id }}
                      to="/runs/$id"
                    >
                      {titles.get(run.taskId) ?? "…"}
                    </Link>
                  </TableCell>
                )}

                <TableCell className="w-45 px-4">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[12.5px]">{snapshot.agent.name}</span>
                    <span className="text-muted-foreground truncate text-[11px]">
                      {snapshot.harness.name}
                    </span>
                  </span>
                </TableCell>

                <TableCell className="w-50 px-4">
                  <EnvBadge mode={run.executionMode} size="sm" />
                </TableCell>

                <TableCell className="w-31 px-4">
                  <RunStatusChip status={run.status} />
                </TableCell>

                <TableCell className="w-21 px-4 font-mono text-[12.5px]">
                  {duration === null ? "—" : formatDuration(duration)}
                </TableCell>

                <TableCell className="text-muted-foreground w-26 px-4 text-[12.5px]">
                  {run.startedAt === null ? "—" : relativeTime(run.startedAt)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {error !== null && <p className="text-destructive px-4 py-6 text-sm">{error.message}</p>}
      {isPending && runs.length === 0 && (
        <p className="text-muted-foreground px-4 py-6 text-sm">Lendo…</p>
      )}
      {!isPending && error === null && runs.length === 0 && empty}

      {total > 0 && (
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-muted-foreground text-xs">
            {format("Mostrando {from}–{to} de {total}", { from, to, total })}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              disabled={page <= 1}
              onClick={() => {
                onPageChange(page - 1);
              }}
              size="sm"
              variant="outline"
            >
              Anterior
            </Button>
            <span className="text-muted-foreground px-2 text-xs">
              {format("{page} de {lastPage}", { page, lastPage })}
            </span>
            <Button
              disabled={page >= lastPage}
              onClick={() => {
                onPageChange(page + 1);
              }}
              size="sm"
              variant="outline"
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
