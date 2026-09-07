import type { ReactNode } from "react";

import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  /** Já resolvido pelo glossário por quem chama; esta camada não escreve label. */
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
}

/**
 * O título de uma tela, no traço do design da Fase 1.
 *
 * A fonte display, Source Serif 4, é do tema: com ele desligado o título usa a
 * fonte do corpo, com o mesmo tamanho e peso. É a única diferença visual entre
 * os dois modos — o resto do layout é idêntico, como manda a seção 14 do
 * planejamento.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  const { theme } = useGlossary();

  return (
    <div className="flex items-end justify-between gap-6">
      <div className="flex flex-col gap-1.5">
        <h1
          className={cn(
            "text-[30px] leading-9 font-semibold",
            theme === "dnd" ? "font-display tracking-normal" : "tracking-[-0.02em]",
          )}
        >
          {title}
        </h1>
        {description !== undefined && (
          <p className="text-muted-foreground text-sm leading-5">{description}</p>
        )}
      </div>
      {actions}
    </div>
  );
}
