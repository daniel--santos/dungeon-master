import type { components } from "@dungeon-master/api-client";
import type { TaskStatus } from "@dungeon-master/contracts";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/datetime";
import { TASK_STATUS } from "@/lib/domain";
import { useGlossary, type UseGlossary } from "@/lib/glossary";

type Activity = components["schemas"]["Activity"];

/**
 * O diário do Project: append-only, do mais recente para o mais antigo.
 *
 * Cada linha foi gravada na mesma transação da mudança que ela descreve, então
 * o diário não é um log paralelo que pode divergir — é o registro do fato.
 */

interface Payload {
  readonly from?: unknown;
  readonly to?: unknown;
  readonly changed?: unknown;
}

function read(payload: unknown): Payload {
  return typeof payload === "object" && payload !== null ? (payload as Payload) : {};
}

function isStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && Object.hasOwn(TASK_STATUS, value);
}

function describe(activity: Activity, glossary: UseGlossary): string {
  const { t, format } = glossary;
  const payload = read(activity.payload);

  switch (activity.type) {
    // As linhas de Project não nomeiam a entidade: `entity.project` muda de
    // gênero entre os dois glossários (Campanha, Projeto), e uma frase com
    // artigo ou particípio concordaria certo em um tema e errado no outro.
    case "project.created":
      return "Começou aqui.";

    case "project.updated": {
      const changed = Array.isArray(payload.changed) ? (payload.changed as unknown[]) : [];
      if (changed.includes("status")) {
        return payload.to === "ARCHIVED" ? "Foi para o arquivo." : "Voltou do arquivo.";
      }
      return "Título ou descrição mudou.";
    }

    case "task.created":
      return format("{task} criada.", { task: t("entity.task") });

    case "task.updated":
      return format("{task} editada.", { task: t("entity.task") });

    case "task.status_changed": {
      const from = isStatus(payload.from) ? t(TASK_STATUS[payload.from].label) : "—";
      const to = isStatus(payload.to) ? t(TASK_STATUS[payload.to].label) : "—";
      return format("{task}: de {from} para {to}.", { task: t("entity.task"), from, to });
    }

    case "task.dependency_created":
      return "Dependência declarada.";

    case "task.dependency_removed":
      return "Dependência desfeita.";

    default:
      return activity.type;
  }
}

export interface ActivityLogProps {
  readonly items: readonly Activity[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly onPageChange: (page: number) => void;
  readonly isPending: boolean;
  readonly error: Error | null;
}

export function ActivityLog({
  items,
  page,
  pageSize,
  total,
  onPageChange,
  isPending,
  error,
}: ActivityLogProps): ReactNode {
  const glossary = useGlossary();
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  if (error !== null) {
    return <p className="text-destructive px-5 py-6 text-sm">{error.message}</p>;
  }

  if (isPending) {
    return <p className="text-muted-foreground px-5 py-6 text-sm">Lendo…</p>;
  }

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground px-5 py-6 text-sm">
        Nada registrado ainda. Toda criação, edição e mudança de estado aparece aqui.
      </p>
    );
  }

  return (
    <>
      <ol className="flex flex-col">
        {items.map((activity) => (
          <li
            key={activity.id}
            className="border-border flex items-baseline justify-between gap-4 border-b px-5 py-2.5 last:border-b-0"
          >
            <span className="text-sm">{describe(activity, glossary)}</span>
            <span className="text-muted-foreground flex-none text-xs tabular-nums">
              {formatDateTime(activity.createdAt)}
            </span>
          </li>
        ))}
      </ol>

      {lastPage > 1 && (
        <div className="flex items-center justify-between px-5 py-3">
          <span className="text-muted-foreground text-xs">
            {glossary.format("{page} de {lastPage}", { page, lastPage })}
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
    </>
  );
}
