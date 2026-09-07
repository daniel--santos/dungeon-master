import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A superfície de conteúdo do design da Fase 1.
 *
 * Existe ao lado do `Card` do shadcn porque o canvas fixou raio 14 e espaçamento
 * próprio, e envolver o `Card` para desfazer o padding dele custaria mais do que
 * a caixa que ele daria.
 */
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn("bg-card border-border rounded-[14px] border shadow-sm", className)}>
      {children}
    </section>
  );
}

export interface PanelHeaderProps {
  readonly title: ReactNode;
  readonly aside?: ReactNode;
  readonly className?: string;
}

/** A faixa de topo de um `Panel`, com o traço embaixo. */
export function PanelHeader({ title, aside, className }: PanelHeaderProps) {
  return (
    <div
      className={cn(
        "border-border flex items-center justify-between gap-4 border-b px-5 py-3.5",
        className,
      )}
    >
      <span className="text-sm font-medium">{title}</span>
      {aside !== undefined && <span className="text-muted-foreground text-xs">{aside}</span>}
    </div>
  );
}
