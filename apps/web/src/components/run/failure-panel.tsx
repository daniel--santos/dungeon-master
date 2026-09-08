import { FolderOpen, Hourglass, Play, RotateCcw, TriangleAlert } from "lucide-react";

import { Panel } from "@/components/panel";
import { CopyRow } from "@/components/run/runtime-column";
import { Button } from "@/components/ui/button";
import type { RunRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";

export interface FailurePanelProps {
  readonly run: RunRecord;
  /** Abre o diálogo de retomada. O botão só aparece quando dá para retomar. */
  readonly onResume: () => void;
}

/**
 * O que uma Expedição derrotada ou exausta deixa para trás.
 *
 * Duas informações valem mais que o resto e por isso ficam grandes: por que
 * parou, e onde está o trabalho. O worktree preservado é o segundo, e o caminho
 * é copiável porque a próxima coisa que alguém faz é abri-lo no editor.
 *
 * O terceiro painel responde "e agora?": ou oferece a retomada, ou diz qual das
 * duas condições falta — sessão capturada e `resume` nas capabilities. As duas
 * são as mesmas que a API confere, então o botão só aparece quando ela aceitaria.
 */
export function FailurePanel({ run, onResume }: FailurePanelProps) {
  const { t, format } = useGlossary();
  const timedOut = run.status === "TIMED_OUT";
  const canResume =
    run.harnessSessionId !== null && run.loadoutSnapshot.harness.capabilities.resume;

  return (
    <div className="flex flex-col gap-4">
      <section
        className="flex items-start gap-3.5 rounded-[14px] border px-4.5 py-3.5"
        style={{
          borderColor: `color-mix(in oklch, ${timedOut ? "oklch(0.72 0.13 75)" : "var(--destructive)"} 38%, transparent)`,
          backgroundColor: `color-mix(in oklch, ${timedOut ? "oklch(0.72 0.13 75)" : "var(--destructive)"} 10%, transparent)`,
        }}
      >
        <span
          className="mt-0.25 flex-none"
          style={{ color: timedOut ? "oklch(0.72 0.13 75)" : "var(--destructive)" }}
        >
          {timedOut ? (
            <Hourglass aria-hidden className="size-4.5" />
          ) : (
            <TriangleAlert aria-hidden className="size-4.5" />
          )}
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-1.25">
          <span className="text-sm font-medium">
            {timedOut
              ? format("{status}: a {run} bateu um teto de tempo.", {
                  status: t("run.status.timedOut"),
                  run: t("entity.run"),
                })
              : format("{status}: a {run} terminou com erro.", {
                  status: t("run.status.failed"),
                  run: t("entity.run"),
                })}
          </span>

          <p className="text-muted-foreground m-0 text-[12.5px] leading-4.75">
            {run.error?.message ??
              format("O worker não registrou uma mensagem. O {timeline} tem os eventos finais.", {
                timeline: t("run.timeline"),
              })}
          </p>

          {run.error?.code !== undefined && (
            <code className="text-muted-foreground w-fit font-mono text-[11px]">
              {run.error.code}
            </code>
          )}
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Panel className="flex flex-col gap-3 px-4.5 pt-4 pb-4.5">
          <div className="flex items-center gap-2">
            <FolderOpen
              aria-hidden
              className="size-3.75"
              style={{ color: "oklch(0.72 0.13 250)" }}
            />
            <span className="text-sm font-medium">O workspace foi preservado</span>
          </div>

          <p className="text-muted-foreground m-0 text-[12.5px] leading-4.75">
            {format(
              "Nada foi descartado. As alterações da {run} continuam onde ela trabalhou, fora da sua árvore principal, até você decidir o que fazer. Um worktree separa o trabalho; ele não é um sandbox.",
              { run: t("entity.run") },
            )}
          </p>

          {run.workspacePath === null ? (
            <p className="text-muted-foreground m-0 text-[12px]">
              A {t("entity.run")} não chegou a registrar um caminho de workspace.
            </p>
          ) : (
            <>
              <CopyRow label="Caminho" value={run.workspacePath} />
              <CopyRow
                label="Comando para inspecionar"
                value={`git -C "${run.workspacePath}" status --short`}
              />
            </>
          )}
        </Panel>

        <Panel className="flex flex-col gap-2.5 px-4.5 pt-4 pb-4.5">
          <div className="flex items-center gap-2">
            <RotateCcw aria-hidden className="text-muted-foreground size-3.75" />
            <span className="text-sm font-medium">Continuar de onde parou</span>
          </div>

          {canResume ? (
            <>
              <p className="text-muted-foreground m-0 text-[12.5px] leading-4.75">
                {format(
                  "A sessão do harness foi capturada e a {harness} {name} declara resume nas suas capabilities. Uma {run} nova pode continuar de onde esta parou, com {attempt} maior.",
                  {
                    harness: t("entity.harness"),
                    name: run.loadoutSnapshot.harness.name,
                    run: t("entity.run"),
                    attempt: "attempt",
                  },
                )}
              </p>
              {run.harnessSessionId !== null && (
                <CopyRow label="Sessão capturada" value={run.harnessSessionId} />
              )}
              <Button className="mt-0.5 w-fit" onClick={onResume} size="sm" variant="outline">
                <Play aria-hidden />
                <span>{format("Retomar a {run}", { run: t("entity.run") })}</span>
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground m-0 text-[12.5px] leading-4.75">
              {run.harnessSessionId === null
                ? format(
                    "Nenhuma sessão do harness foi capturada, então não há de onde continuar. Uma nova {run} parte do zero, com {attempt} maior.",
                    { run: t("entity.run"), attempt: "attempt" },
                  )
                : format("A {harness} {name} não declara resume nas suas capabilities.", {
                    harness: t("entity.harness"),
                    name: run.loadoutSnapshot.harness.name,
                  })}
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
