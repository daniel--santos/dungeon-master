import type { CapabilityIssueCode, CapabilityIssueSeverity } from "@dungeon-master/contracts";
import { ShieldX, TriangleAlert } from "lucide-react";

import { HARNESS_CAPABILITY } from "@/lib/execution-domain";
import { useGlossary } from "@/lib/glossary";
import { ACCENT_AMBER, CAPABILITY_CODE, CAPABILITY_SEVERITY } from "@/lib/registry-domain";
import { cn } from "@/lib/utils";

/**
 * Um descompasso a mostrar: o do domínio, com a mensagem canônica, ou o da
 * prévia pela matriz, sem mensagem.
 */
export interface CapabilityIssueView {
  readonly code: CapabilityIssueCode;
  readonly severity: CapabilityIssueSeverity;
  readonly capability: keyof typeof HARNESS_CAPABILITY;
  readonly message?: string;
  readonly causedBy: readonly string[];
}

const TONE: Record<CapabilityIssueSeverity, string> = {
  BLOCKER: "var(--destructive)",
  WARNING: ACCENT_AMBER,
};

function tint(color: string, percent: number): string {
  return `color-mix(in oklch, ${color} ${String(percent)}%, transparent)`;
}

/**
 * A lista de bloqueios e avisos do capability matching (Fase 8C).
 *
 * O mesmo desenho no painel de compatibilidade do Equipamento, no diálogo de
 * partida e na recusa `409`: o código em monoespaçada, porque é o que o
 * Diário da Expedição vai repetir como `Diagnostic`; o título curto do
 * glossário; a mensagem canônica do domínio, quando veio; e o que causou.
 */
export function CapabilityIssueList({
  issues,
  className,
}: {
  readonly issues: readonly CapabilityIssueView[];
  readonly className?: string;
}) {
  const { t } = useGlossary();

  if (issues.length === 0) return null;

  return (
    <ul className={cn("m-0 flex list-none flex-col gap-1.5 p-0", className)}>
      {issues.map((issue) => {
        const color = TONE[issue.severity];
        const Icon = issue.severity === "BLOCKER" ? ShieldX : TriangleAlert;
        return (
          <li
            key={`${issue.severity}:${issue.code}:${issue.causedBy.join(",")}`}
            className="flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5"
            data-capability-issue={issue.code}
            data-capability-severity={issue.severity}
            style={{ borderColor: tint(color, 40), backgroundColor: tint(color, 8) }}
          >
            <Icon aria-hidden className="mt-0.5 size-3.5 flex-none" style={{ color }} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-[12.5px] font-medium">{t(CAPABILITY_CODE[issue.code])}</span>
                <span
                  className="rounded-md border px-1.5 py-px font-mono text-[10px] tracking-[0.04em]"
                  style={{ borderColor: tint(color, 45), color }}
                >
                  {t(CAPABILITY_SEVERITY[issue.severity])}
                </span>
                <code className="text-muted-foreground font-mono text-[10.5px]">{issue.code}</code>
              </div>
              {issue.message !== undefined && (
                <span className="text-muted-foreground text-[11.5px] leading-4.5 whitespace-pre-wrap">
                  {issue.message}
                </span>
              )}
              <span className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-[11px]">
                <span>{t(HARNESS_CAPABILITY[issue.capability])}</span>
                {issue.causedBy.length > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{t("capability.causedBy")}</span>
                    <code className="font-mono text-[10.5px]">{issue.causedBy.join(", ")}</code>
                  </>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
