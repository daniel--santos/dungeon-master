import type { components } from "@dungeon-master/api-client";
import type { TaskStatus } from "@dungeon-master/contracts";

import { TASK_STATUS, TASK_STATUSES } from "@/lib/domain";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";

type TaskCounts = components["schemas"]["ProjectDetail"]["taskCounts"];

/** O total, para a linha da lista não precisar somar de novo. */
export function totalTasks(counts: TaskCounts): number {
  return TASK_STATUSES.reduce((sum, status) => sum + counts[status], 0);
}

export interface TaskCountsProps {
  readonly counts: TaskCounts;
  /** Sem os zeros: uma lista de nove estados vazios não informa nada. */
  readonly compact?: boolean;
  readonly className?: string;
}

export function TaskCounts({ counts, compact = false, className }: TaskCountsProps) {
  const { t } = useGlossary();
  const shown = TASK_STATUSES.filter((status: TaskStatus) => !compact || counts[status] > 0);

  if (shown.length === 0) {
    return <span className="text-muted-foreground text-xs">Nada ainda</span>;
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {shown.map((status) => (
        <span key={status} className="flex items-center gap-1.5 text-xs">
          <span
            aria-hidden
            className="size-1.5 flex-none rounded-full"
            style={{ backgroundColor: TASK_STATUS[status].dot }}
          />
          <span className="text-muted-foreground">{t(TASK_STATUS[status].label)}</span>
          <span className="font-medium tabular-nums">{counts[status]}</span>
        </span>
      ))}
    </div>
  );
}
