import type { TaskKind, TaskPriority, TaskStatus } from "@dungeon-master/contracts";

import { TASK_KIND, TASK_PRIORITY, TASK_STATUS } from "@/lib/domain";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";

/**
 * Os três sinais que a lista e o detalhe repetem: tipo, estado e prioridade.
 *
 * Todo texto vem do glossário ativo. O ícone e a cor não: eles são iguais nos
 * dois temas, porque o interruptor troca vocabulário, não a leitura visual.
 */

const CHIP =
  "border-border inline-flex h-[22px] w-fit items-center gap-1.5 rounded-lg border bg-white/[0.04] px-2 text-xs whitespace-nowrap";

export function KindChip({ kind, className }: { kind: TaskKind; className?: string }) {
  const { t } = useGlossary();
  const { icon: Icon, label } = TASK_KIND[kind];

  return (
    <span className={cn(CHIP, className)}>
      <Icon aria-hidden className="text-muted-foreground size-3.5" strokeWidth={1.5} />
      <span>{t(label)}</span>
    </span>
  );
}

export function StatusChip({ status, className }: { status: TaskStatus; className?: string }) {
  const { t } = useGlossary();
  const { label, dot, dim } = TASK_STATUS[status];

  return (
    <span className={cn(CHIP, dim && "text-muted-foreground", className)}>
      <span
        aria-hidden
        className="size-1.5 flex-none rounded-full"
        style={{ backgroundColor: dot }}
      />
      <span>{t(label)}</span>
    </span>
  );
}

export function PriorityText({
  priority,
  className,
}: {
  priority: TaskPriority;
  className?: string;
}) {
  const { t } = useGlossary();
  const { label, className: tone } = TASK_PRIORITY[priority];

  return <span className={cn(tone, className)}>{t(label)}</span>;
}
