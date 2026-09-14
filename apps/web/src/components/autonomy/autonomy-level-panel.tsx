import type { AutonomyLevel } from "@dungeon-master/contracts";
import { Check, Gauge, Lock, Unlock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { tint } from "@/components/autonomy/shared";
import { Panel } from "@/components/panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useProjectAutonomy, useUpdateProjectAutonomy } from "@/lib/autonomy";
import {
  AUTOMATION_KIND,
  AUTOMATION_KINDS,
  AUTONOMY_COLOR,
  AUTONOMY_LEVEL,
  AUTONOMY_LEVELS,
  automationsAllowedAt,
  automationsGained,
  needsAutonomyConfirmation,
} from "@/lib/autonomy-domain";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";

export interface AutonomyLevelPanelProps {
  readonly projectId: string;
}

/**
 * A escada de autonomia de uma Campanha (Fase 9C).
 *
 * Cinco degraus, um cartão cada, com o que cada um libera; o atual marcado,
 * e o mapa `allows` que a API devolve — a verdade do domínio — logo abaixo.
 * Descer, ou subir até o 2, grava na hora: o sistema continua sem decidir
 * nada sozinho. Subir ao 3 ou ao 4 abre um `AlertDialog` que lista, a
 * partir da escada, o que passa a acontecer sem o Selo: é a partir dali que
 * uma política aprova, um gate se concede e uma Expedição parte por conta
 * própria, e isso não se liga num clique distraído.
 */
export function AutonomyLevelPanel({ projectId }: AutonomyLevelPanelProps) {
  const { t, format } = useGlossary();
  const autonomy = useProjectAutonomy(projectId);
  const update = useUpdateProjectAutonomy();
  const [confirming, setConfirming] = useState<AutonomyLevel | null>(null);

  const current = autonomy.data?.autonomyLevel;

  function apply(level: AutonomyLevel) {
    update.mutate(
      { projectId, autonomyLevel: level },
      {
        onSuccess: (next) => {
          setConfirming(null);
          toast.success(
            format(t("autonomy.change.done"), {
              level: t(AUTONOMY_LEVEL[next.autonomyLevel].label),
            }),
          );
        },
        onError: (error: Error) => {
          setConfirming(null);
          toast.error(error.message);
        },
      },
    );
  }

  function choose(level: AutonomyLevel) {
    if (current === undefined || level === current || update.isPending) return;
    if (needsAutonomyConfirmation(current, level)) {
      setConfirming(level);
      return;
    }
    apply(level);
  }

  const gained =
    confirming === null || current === undefined ? [] : automationsGained(current, confirming);

  return (
    <>
      <Panel className="flex flex-col gap-4 px-5 pt-4 pb-5" data-autonomy-level-panel={current}>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Gauge aria-hidden className="size-3.75" style={{ color: AUTONOMY_COLOR }} />
            <span className="text-sm font-medium">{t("autonomy.title")}</span>
            {current !== undefined && (
              <span className="text-muted-foreground text-xs" data-autonomy-current={current}>
                {format("{label}: {level}", {
                  label: t("autonomy.current"),
                  level: t(AUTONOMY_LEVEL[current].label),
                })}
              </span>
            )}
          </div>
          <p className="text-muted-foreground m-0 text-[12.5px] leading-5">
            {t("autonomy.description")}
          </p>
        </div>

        {autonomy.isError && (
          <p className="text-destructive m-0 text-sm">{autonomy.error.message}</p>
        )}
        {autonomy.isPending && <p className="text-muted-foreground m-0 text-sm">Lendo…</p>}

        {current !== undefined && (
          <div className="grid gap-2.5 md:grid-cols-5">
            {AUTONOMY_LEVELS.map((level) => {
              const active = level === current;
              const allowed = automationsAllowedAt(level);
              return (
                <button
                  key={level}
                  aria-pressed={active}
                  className={cn(
                    "flex flex-col gap-2 rounded-[12px] border px-3.5 py-3 text-left transition-colors",
                    active
                      ? "cursor-default"
                      : "border-border hover:bg-white/[0.04] disabled:cursor-not-allowed",
                  )}
                  data-autonomy-level={level}
                  data-autonomy-level-active={active ? "true" : "false"}
                  disabled={update.isPending}
                  onClick={() => {
                    choose(level);
                  }}
                  style={
                    active
                      ? {
                          borderColor: tint(AUTONOMY_COLOR, 55),
                          backgroundColor: tint(AUTONOMY_COLOR, 9),
                        }
                      : undefined
                  }
                  type="button"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="flex size-5.5 flex-none items-center justify-center rounded-full border font-mono text-[10.5px]"
                      style={{
                        borderColor: tint(AUTONOMY_COLOR, active ? 70 : 35),
                        color: active ? AUTONOMY_COLOR : "var(--muted-foreground)",
                      }}
                    >
                      {level}
                    </span>
                    <span className="text-[13px] font-medium">
                      {t(AUTONOMY_LEVEL[level].label)}
                    </span>
                    {active && (
                      <Check
                        aria-hidden
                        className="ml-auto size-3.5"
                        style={{ color: AUTONOMY_COLOR }}
                      />
                    )}
                  </span>
                  <span className="text-muted-foreground text-[11.5px] leading-4.25">
                    {t(AUTONOMY_LEVEL[level].description)}
                  </span>
                  {allowed.length > 0 && (
                    <span className="text-muted-foreground mt-auto text-[10.5px] tracking-[0.04em] uppercase">
                      {format("{n} automações", { n: allowed.length })}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {autonomy.data !== undefined && (
          <div className="flex flex-col gap-1.5" data-autonomy-allows>
            <span className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
              {t("autonomy.allows.title")}
            </span>
            <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2">
              {AUTOMATION_KINDS.map((kind) => {
                const allowed = autonomy.data.allows[kind];
                return (
                  <li
                    key={kind}
                    className="flex items-center gap-2 text-[12.5px]"
                    data-autonomy-allow={kind}
                    data-autonomy-allowed={allowed ? "true" : "false"}
                  >
                    {allowed ? (
                      <Unlock
                        aria-hidden
                        className="size-3.5 flex-none"
                        style={{ color: AUTONOMY_COLOR }}
                      />
                    ) : (
                      <Lock aria-hidden className="text-muted-foreground size-3.5 flex-none" />
                    )}
                    <span className={allowed ? undefined : "text-muted-foreground"}>
                      {t(AUTOMATION_KIND[kind])}
                    </span>
                    <span className="text-muted-foreground ml-auto text-[10.5px]">
                      {allowed ? t("autonomy.allowed") : t("autonomy.blocked")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Panel>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        open={confirming !== null}
      >
        <AlertDialogContent data-autonomy-confirm={confirming ?? undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {format(t("autonomy.change.title"), {
                level: confirming === null ? "" : t(AUTONOMY_LEVEL[confirming].label),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                <p>{t("autonomy.change.body")}</p>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {gained.map((kind) => (
                    <li
                      key={kind}
                      className="text-foreground flex items-center gap-2 text-[13px]"
                      data-autonomy-gain={kind}
                    >
                      <Unlock
                        aria-hidden
                        className="size-3.5 flex-none"
                        style={{ color: AUTONOMY_COLOR }}
                      />
                      <span>{t(AUTOMATION_KIND[kind])}</span>
                    </li>
                  ))}
                </ul>
                <p>{t("autonomy.failClosed")}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={update.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (confirming !== null) apply(confirming);
              }}
            >
              <Unlock aria-hidden />
              <span>{t("autonomy.change.action")}</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
