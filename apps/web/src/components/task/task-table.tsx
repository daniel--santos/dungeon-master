import type { components } from "@dungeon-master/api-client";
import { Link } from "@tanstack/react-router";
import { createColumnHelper, rowSortingFeature, type SortingState } from "@tanstack/react-table";
import { useTable } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { KindChip, PriorityText, StatusChip } from "@/components/task/chips";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { relativeTime } from "@/lib/datetime";
import type { SortOrder, TaskSortField } from "@/lib/domain";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";

type Task = components["schemas"]["Task"];

const features = { rowSortingFeature } as const;
const helper = createColumnHelper<typeof features, Task>();

/** As larguras do design. A coluna de título é a única que estica. */
const WIDTH: Record<string, string> = {
  title: "min-w-0",
  kind: "w-32",
  project: "w-44",
  status: "w-38",
  priority: "w-26",
  updatedAt: "w-25",
};

export interface TaskTableProps {
  readonly tasks: readonly Task[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly sort: TaskSortField;
  readonly order: SortOrder;
  readonly onSortChange: (sort: TaskSortField, order: SortOrder) => void;
  readonly onPageChange: (page: number) => void;
  /** Título de cada Project, para a coluna não precisar de uma busca por linha. */
  readonly projectTitles: ReadonlyMap<string, string>;
  /** Fora quando a tabela já vive dentro de um Project. */
  readonly showProject?: boolean;
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly empty: ReactNode;
}

/**
 * A tabela da lista, com ordenação e paginação servidas pela API.
 *
 * `manualSorting` e a paginação por `page`/`pageSize` existem porque a ordem e
 * o recorte são do servidor: a tabela pede, não calcula. Ordenar por prioridade
 * no cliente daria ordem alfabética, e a API ordena por urgência.
 */
export function TaskTable({
  tasks,
  total,
  page,
  pageSize,
  sort,
  order,
  onSortChange,
  onPageChange,
  projectTitles,
  showProject = true,
  isPending,
  error,
  empty,
}: TaskTableProps) {
  const { t, format } = useGlossary();

  const sorting = useMemo<SortingState>(
    () => [{ id: sort, desc: order === "desc" }],
    [sort, order],
  );

  const columns = useMemo(() => {
    const title = helper.accessor("title", {
      id: "title",
      header: "Título",
      cell: (info) => (
        <Link
          className="hover:text-foreground block truncate underline-offset-2 hover:underline"
          params={{ id: info.row.original.id }}
          to="/tasks/$id"
        >
          {info.getValue()}
        </Link>
      ),
    });

    const kind = helper.accessor("kind", {
      id: "kind",
      header: "Tipo",
      enableSorting: false,
      cell: (info) => <KindChip kind={info.getValue()} />,
    });

    const project = helper.accessor((row) => row.projectId, {
      id: "project",
      header: t("entity.project"),
      enableSorting: false,
      cell: (info) => {
        const id = info.getValue();
        return (
          <span className="text-muted-foreground block truncate">
            {(id === null ? undefined : projectTitles.get(id)) ?? "—"}
          </span>
        );
      },
    });

    const status = helper.accessor("status", {
      id: "status",
      header: "Status",
      enableSorting: false,
      cell: (info) => <StatusChip status={info.getValue()} />,
    });

    const priority = helper.accessor("priority", {
      id: "priority",
      header: "Prioridade",
      // A primeira ordenada útil é a mais urgente primeiro, não a menos.
      sortDescFirst: true,
      cell: (info) => <PriorityText priority={info.getValue()} />,
    });

    const updatedAt = helper.accessor("updatedAt", {
      id: "updatedAt",
      header: "Atualizada",
      sortDescFirst: true,
      cell: (info) => (
        <span className="text-muted-foreground">{relativeTime(info.getValue())}</span>
      ),
    });

    return showProject
      ? helper.columns([title, kind, project, status, priority, updatedAt])
      : helper.columns([title, kind, status, priority, updatedAt]);
  }, [projectTitles, showProject, t]);

  const table = useTable({
    features,
    columns,
    data: tasks,
    getRowId: (row) => row.id,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const first = next[0];
      if (first === undefined) return;
      onSortChange(first.id as TaskSortField, first.desc ? "desc" : "asc");
    },
  });

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => {
                const sortable = header.column.getCanSort();
                const direction = header.column.getIsSorted();
                return (
                  <TableHead key={header.id} className={cn("px-4", WIDTH[header.column.id])}>
                    {sortable ? (
                      <button
                        className="text-muted-foreground hover:text-foreground -ml-1 flex items-center gap-1 rounded px-1 py-0.5 transition-colors"
                        onClick={header.column.getToggleSortingHandler()}
                        type="button"
                      >
                        <table.FlexRender header={header} />
                        {direction === "asc" && <ArrowUp aria-hidden className="size-3" />}
                        {direction === "desc" && <ArrowDown aria-hidden className="size-3" />}
                        {direction === false && (
                          <ChevronsUpDown aria-hidden className="size-3 opacity-50" />
                        )}
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getAllCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  className={cn("px-4", WIDTH[cell.column.id], cell.column.id === "title" && "w-0")}
                >
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {error !== null && <p className="text-destructive px-4 py-6 text-sm">{error.message}</p>}
      {isPending && tasks.length === 0 && (
        <p className="text-muted-foreground px-4 py-6 text-sm">Lendo…</p>
      )}
      {!isPending && error === null && tasks.length === 0 && empty}

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
