import { useMemo } from "react";

import { diffLines, summarizeDiff, type DiffKind } from "@/lib/diff";
import { useGlossary } from "@/lib/glossary";
import { ACCENT_GREEN } from "@/lib/registry-domain";
import { cn } from "@/lib/utils";

const NUMBER = new Intl.NumberFormat("pt-BR");

const MARK: Record<DiffKind, string> = { same: " ", added: "+", removed: "−" };

/**
 * A diferença entre duas versões de uma Habilidade, linha a linha (Fase 8C).
 *
 * Texto, nunca HTML: o markdown de uma Habilidade é dado escrito pelo usuário
 * ou por um modelo, e vai à tela como está, numa `<pre>` com quebra de linha.
 * Verde para o que entrou, vermelho para o que saiu; o resto em cinza, para o
 * olho achar a mudança.
 */
export function SkillDiff({
  before,
  after,
  className,
}: {
  readonly before: string;
  readonly after: string;
  readonly className?: string;
}) {
  const { t, format } = useGlossary();
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const summary = summarizeDiff(lines);
  const same = summary.added === 0 && summary.removed === 0;

  return (
    <div className={cn("flex flex-col gap-2", className)} data-skill-diff>
      <span
        className="text-muted-foreground text-[11.5px]"
        data-skill-diff-added={summary.added}
        data-skill-diff-removed={summary.removed}
      >
        {same
          ? t("skill.diff.same")
          : format(t("skill.diff.summary"), {
              added: NUMBER.format(summary.added),
              removed: NUMBER.format(summary.removed),
            })}
      </span>

      {!same && (
        <pre className="border-border m-0 max-h-[32rem] overflow-auto rounded-[10px] border bg-white/[0.03] py-2 font-mono text-[11.5px] leading-4.5 whitespace-pre-wrap">
          {lines.map((line, index) => {
            const color =
              line.kind === "added"
                ? ACCENT_GREEN
                : line.kind === "removed"
                  ? "var(--destructive)"
                  : undefined;
            return (
              <div
                key={`${String(index)}:${line.kind}`}
                className={cn("flex gap-2 px-3", line.kind === "same" && "text-muted-foreground")}
                data-diff-line={line.kind}
                style={
                  color === undefined
                    ? undefined
                    : { backgroundColor: `color-mix(in oklch, ${color} 10%, transparent)`, color }
                }
              >
                <span aria-hidden className="w-3 flex-none select-none">
                  {MARK[line.kind]}
                </span>
                <span className="min-w-0 flex-1">{line.text === "" ? " " : line.text}</span>
              </div>
            );
          })}
        </pre>
      )}
    </div>
  );
}
