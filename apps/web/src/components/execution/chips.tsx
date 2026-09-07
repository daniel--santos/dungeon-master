import type { EnforcementLevel, RunStatus } from "@dungeon-master/contracts";

import { ENFORCEMENT, RUN_STATUS } from "@/lib/execution-domain";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";

/**
 * Os sinais que a lista de Expedições e o cockpit repetem.
 *
 * Mesma anatomia dos chips de Task: o texto vem do glossário ativo, o ícone e a
 * cor não. O pulso do ponto é o único acréscimo — ele diz que o estado ainda vai
 * mudar sozinho, e some assim que o Run é terminal.
 */

const CHIP =
  "border-border inline-flex h-[22px] w-fit items-center gap-1.5 rounded-lg border bg-white/[0.04] px-2 text-xs whitespace-nowrap";

export function RunStatusChip({ status, className }: { status: RunStatus; className?: string }) {
  const { t } = useGlossary();
  const { label, dot, dim, pulse } = RUN_STATUS[status];

  return (
    <span className={cn(CHIP, dim && "text-muted-foreground", className)} data-run-status={status}>
      <span
        aria-hidden
        className={cn("size-1.5 flex-none rounded-full", pulse && "animate-pulse")}
        style={{ backgroundColor: dot }}
      />
      <span>{t(label)}</span>
    </span>
  );
}

/**
 * O nível de enforcement, com o identificador canônico ao lado do label.
 *
 * A seção 15 do documento técnico pede que a interface consiga comunicar a
 * diferença entre pedir e impor. O canônico em monoespaçada é o que impede
 * "Permissão nativa da CLI" de ser lido como "sandbox".
 */
export function EnforcementText({
  level,
  className,
}: {
  level: EnforcementLevel;
  className?: string;
}) {
  const { t } = useGlossary();
  const { label, canonical, className: tone } = ENFORCEMENT[level];

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={tone}>{t(label)}</span>
      <code className="border-border rounded-md border bg-white/[0.07] px-1.5 py-px font-mono text-[10.5px]">
        {canonical}
      </code>
    </span>
  );
}
