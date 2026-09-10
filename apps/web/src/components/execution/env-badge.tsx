import type { ExecutionMode } from "@dungeon-master/contracts";
import { Container, ShieldAlert } from "lucide-react";
import type { CSSProperties } from "react";

import { EXECUTION_MODE } from "@/lib/execution-domain";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";

/**
 * O badge de ambiente, e o único lugar do produto que o desenha.
 *
 * A regra da seção 14 do planejamento é aplicada aqui e não em cada tela: quem
 * mostra o modo host mostra junto o aviso "sem isolamento" e o texto canônico
 * `HOST · UNISOLATED`, nos dois temas, em qualquer tamanho. O nome do tema
 * sozinho esconderia informação de segurança, e é exatamente o contraexemplo
 * que o artboard de componente marca como proibido.
 *
 * Três tamanhos, um só componente, para o cockpit, o diálogo e a tabela não
 * divergirem: `lg` no cabeçalho do cockpit, `md` no cartão e no diálogo, `sm`
 * na linha da tabela, onde o canônico vira uma segunda linha discreta.
 */

export type EnvBadgeSize = "lg" | "md" | "sm";

export interface EnvBadgeProps {
  readonly mode: ExecutionMode;
  readonly size?: EnvBadgeSize;
  readonly className?: string;
}

/** O acento do modo: vermelho para o host sem isolamento, azul para o container. */
const ACCENT: Record<ExecutionMode, string> = {
  HOST: "var(--destructive)",
  DOCKER: "var(--accent-blue)",
};

const ICON: Record<ExecutionMode, typeof ShieldAlert> = {
  HOST: ShieldAlert,
  DOCKER: Container,
};

const SIZE = {
  lg: { name: "text-[15px]", canonical: "text-[11px]", icon: "size-4", pad: "h-8.5 px-3 gap-2.25" },
  md: { name: "text-sm", canonical: "text-[10.5px]", icon: "size-3.5", pad: "h-7.5 px-2.5 gap-2" },
  sm: { name: "text-xs", canonical: "text-[10px]", icon: "size-3", pad: "" },
} as const;

/** Uma camada translúcida do acento, que funciona com `var()` e com literal. */
function tint(color: string, percent: number): string {
  return `color-mix(in oklch, ${color} ${String(percent)}%, transparent)`;
}

export function EnvBadge({ mode, size = "md", className }: EnvBadgeProps) {
  const { t } = useGlossary();
  const { label, canonical, warning } = EXECUTION_MODE[mode];
  const accent = ACCENT[mode];
  const Icon = ICON[mode];
  const s = SIZE[size];

  const name = (
    <span className="flex items-center gap-1.25 whitespace-nowrap">
      <Icon
        aria-hidden
        className={cn("flex-none", s.icon)}
        strokeWidth={1.8}
        style={{ color: accent }}
      />
      <span className={cn("font-medium", s.name)}>{t(label)}</span>
      {warning !== null && (
        <>
          <span className={cn("text-muted-foreground", s.name)}>·</span>
          <span className={s.name} style={{ color: accent }}>
            {t(warning)}
          </span>
        </>
      )}
    </span>
  );

  // Na tabela a regra continua valendo por linha, mas sem gritar: o aviso fica
  // na cor e o texto canônico desce para uma segunda linha em monoespaçada.
  if (size === "sm") {
    return (
      <span
        className={cn("flex w-fit flex-col items-start gap-0.5", className)}
        data-env-badge={mode}
      >
        {name}
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.04em]">
          {t(canonical)}
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn("flex w-fit items-center rounded-lg border", s.pad, className)}
      data-env-badge={mode}
      style={
        {
          borderColor: tint(accent, 38),
          backgroundColor: tint(accent, 10),
        } as CSSProperties
      }
    >
      {name}
      <span
        className={cn(
          "flex flex-none items-center rounded-md border px-1.5 font-mono tracking-[0.04em]",
          size === "lg" ? "h-5" : "h-4.5",
          s.canonical,
        )}
        style={{ borderColor: tint(accent, 40), backgroundColor: tint(accent, 12), color: accent }}
      >
        {t(canonical)}
      </span>
    </span>
  );
}
