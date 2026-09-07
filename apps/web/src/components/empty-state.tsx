import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  readonly icon: LucideIcon;
  readonly title: ReactNode;
  /** Uma frase que diz a verdade sobre o que ainda não existe. */
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}

/**
 * O estado vazio do design: círculo tracejado, título curto e uma frase honesta.
 *
 * A frase nunca promete o que a fase não entrega; quando a tela depende de algo
 * que chega depois, ela diz qual fase traz aquilo.
 */
export function EmptyState({ icon: Icon, title, children, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2.5 px-6 pt-10 pb-11",
        className,
      )}
    >
      <span className="border-input text-muted-foreground flex size-11 items-center justify-center rounded-full border border-dashed">
        <Icon aria-hidden className="size-5" />
      </span>
      <span className="text-sm font-medium">{title}</span>
      <p className="text-muted-foreground max-w-[460px] text-center text-[13px] leading-5">
        {children}
      </p>
      {action}
    </div>
  );
}
