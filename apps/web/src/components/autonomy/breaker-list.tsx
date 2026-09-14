import { Link } from "@tanstack/react-router";
import { Plus, RotateCcw, ShieldHalf, SquarePen, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { BreakerDialog } from "@/components/autonomy/breaker-dialog";
import { CHIP, ListHeader, ScopeChip, tint, useProjectTitles } from "@/components/autonomy/shared";
import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { DeleteRegistryDialog } from "@/components/registry/delete-registry-dialog";
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
import { Button } from "@/components/ui/button";
import type { CircuitBreakerRecord } from "@/lib/api-types";
import { useCircuitBreakers, useDeleteCircuitBreaker, useResetCircuitBreaker } from "@/lib/autonomy";
import { BREAKER_SCOPE, BREAKER_STATE, breakerReopensAt } from "@/lib/autonomy-domain";
import { formatDateTime, relativeTime } from "@/lib/datetime";
import { useHarnesses, useLoadouts } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";
import type { AutonomyScope } from "@/lib/search";
import { cn } from "@/lib/utils";

export interface BreakerListProps {
  readonly projectId: string;
  readonly projectTitle: string;
  readonly scope: AutonomyScope;
}

const MINUTE_MS = 60_000;

/**
 * Os disjuntores desta Campanha (Fase 9C): o estado, o motivo, desde quando
 * está aberto e quando volta a sondar, a sondagem em voo, os gatilhos, e o
 * reset — que fecha de qualquer estado e por isso pede confirmação.
 *
 * Disjuntor não tem escopo global: com o filtro da Campanha só os dela
 * aparecem; "todos" traz também os por Loadout e por Harness.
 */
export function BreakerList({ projectId, projectTitle, scope }: BreakerListProps) {
  const { t, format } = useGlossary();
  const breakers = useCircuitBreakers(scope === "project" ? { projectId } : {});
  const remove = useDeleteCircuitBreaker();
  const reset = useResetCircuitBreaker();
  const projectTitles = useProjectTitles();
  const loadouts = useLoadouts();
  const harnesses = useHarnesses();

  const [editing, setEditing] = useState<CircuitBreakerRecord | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<CircuitBreakerRecord | null>(null);
  const [resetting, setResetting] = useState<CircuitBreakerRecord | null>(null);

  const items = breakers.data?.items ?? [];
  const loadoutNames = useMemo(
    () => new Map((loadouts.data?.items ?? []).map((loadout) => [loadout.id, loadout.name])),
    [loadouts.data],
  );
  const harnessNames = useMemo(
    () =>
      new Map<string, string>(
        (harnesses.data?.items ?? []).map((harness) => [harness.key, harness.name]),
      ),
    [harnesses.data],
  );

  function create() {
    setEditing(undefined);
    setOpen(true);
  }

  function confirmReset() {
    if (resetting === null) return;
    reset.mutate(resetting.id, {
      onSuccess: () => {
        setResetting(null);
        toast.success(t("breaker.reset.done"));
      },
      onError: (error: Error) => {
        setResetting(null);
        toast.error(error.message);
      },
    });
  }

  return (
    <>
      <Panel className="flex flex-col px-5 pt-4 pb-3.5" data-breaker-list={items.length}>
        <ListHeader
          action={
            <Button onClick={create} size="xs" variant="outline">
              <Plus aria-hidden />
              <span>{t("breaker.create.title")}</span>
            </Button>
          }
          count={breakers.data?.total}
          description={t("breaker.description")}
          icon={ShieldHalf}
          title={t("entity.breaker.plural")}
        />

        {breakers.isPending && <p className="text-muted-foreground py-6 text-sm">Lendo…</p>}
        {breakers.error !== null && (
          <p className="text-destructive py-6 text-sm">{breakers.error.message}</p>
        )}

        {!breakers.isPending && breakers.error === null && items.length === 0 && (
          <EmptyState
            action={
              <Button onClick={create} size="sm" variant="outline">
                <Plus aria-hidden />
                <span>{t("breaker.create.title")}</span>
              </Button>
            }
            icon={ShieldHalf}
            title={format("Nenhum {breaker} ainda", { breaker: t("entity.breaker") })}
          >
            {t("breaker.list.empty")}
          </EmptyState>
        )}

        {items.map((breaker, index) => {
          const state = BREAKER_STATE[breaker.state];
          const reopens = breakerReopensAt(breaker);
          const triggers = breaker.triggers;
          return (
            <div
              key={breaker.id}
              className={cn(
                "flex items-start gap-3 py-3",
                index > 0 && "border-border border-t",
                !breaker.enabled && "opacity-60",
              )}
              data-breaker={breaker.name}
              data-breaker-state={breaker.state}
            >
              <span
                className="border-border mt-0.5 flex size-8 flex-none items-center justify-center rounded-lg border"
                style={{ backgroundColor: tint(state.dot, 12) }}
              >
                <ShieldHalf aria-hidden className="size-3.75" style={{ color: state.dot }} />
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium">{breaker.name}</span>
                  <span className={CHIP} style={{ borderColor: tint(state.dot, 45) }}>
                    <span
                      aria-hidden
                      className={cn("size-1.5 flex-none rounded-full", state.pulse && "animate-pulse")}
                      style={{ backgroundColor: state.dot }}
                    />
                    <span>{t(state.label)}</span>
                  </span>
                  {breaker.scope === "PROJECT" ? (
                    <ScopeChip
                      currentProjectId={projectId}
                      projectId={breaker.projectId}
                      projectTitles={projectTitles}
                    />
                  ) : (
                    <span className={cn(CHIP, "text-muted-foreground")} data-rule-scope={breaker.scope.toLowerCase()}>
                      {format("{scope} · {name}", {
                        scope: t(BREAKER_SCOPE[breaker.scope]),
                        name:
                          breaker.scope === "LOADOUT"
                            ? (loadoutNames.get(breaker.loadoutId ?? "") ?? "…")
                            : (harnessNames.get(breaker.harnessKey ?? "") ?? breaker.harnessKey ?? "…"),
                      })}
                    </span>
                  )}
                  {!breaker.enabled && (
                    <span className="text-muted-foreground text-[10.5px]">desligado</span>
                  )}
                </div>

                {breaker.reason !== null && (
                  <span className="text-muted-foreground text-[12px] leading-4.5" data-breaker-reason>
                    {breaker.reason}
                  </span>
                )}

                <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px]">
                  {breaker.openedAt !== null && (
                    <span data-breaker-opened-at={breaker.openedAt} title={formatDateTime(breaker.openedAt)}>
                      {format(t("breaker.openedAt"), { when: relativeTime(breaker.openedAt) })}
                    </span>
                  )}
                  {reopens !== null && (
                    <>
                      <span aria-hidden>·</span>
                      <span data-breaker-reopens-at={reopens}>
                        {format(t("breaker.reopensAt"), { when: formatDateTime(reopens) })}
                      </span>
                    </>
                  )}
                  {breaker.probeRunId !== null && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="flex items-center gap-1" data-breaker-probe={breaker.probeRunId}>
                        <span>{t("breaker.probe")}:</span>
                        <Link
                          className="hover:text-foreground underline-offset-2 hover:underline"
                          params={{ id: breaker.probeRunId }}
                          to="/runs/$id"
                        >
                          {t("breaker.probe.run")}
                        </Link>
                      </span>
                    </>
                  )}
                  {breaker.consecutiveFailures > 0 && (
                    <>
                      <span aria-hidden>·</span>
                      <span data-breaker-consecutive={breaker.consecutiveFailures}>
                        {format("{label}: {n}", {
                          label: t("breaker.consecutiveFailures"),
                          n: breaker.consecutiveFailures,
                        })}
                      </span>
                    </>
                  )}
                </span>

                <div className="flex flex-wrap items-center gap-1.5">
                  {triggers.consecutiveFailures !== null && (
                    <span className={CHIP} data-breaker-trigger-chip="consecutiveFailures">
                      {format(t("breaker.trigger.consecutiveFailures"), {
                        n: triggers.consecutiveFailures,
                      })}
                    </span>
                  )}
                  {triggers.failuresInWindow !== null && (
                    <span className={CHIP} data-breaker-trigger-chip="failuresInWindow">
                      {format(t("breaker.trigger.failuresInWindow"), {
                        n: triggers.failuresInWindow.count,
                        window: `${String(Math.round(triggers.failuresInWindow.windowMs / MINUTE_MS))} min`,
                      })}
                    </span>
                  )}
                  {triggers.permissionDeniedInWindow !== null && (
                    <span className={CHIP} data-breaker-trigger-chip="permissionDeniedInWindow">
                      {format(t("breaker.trigger.permissionDeniedInWindow"), {
                        n: triggers.permissionDeniedInWindow.count,
                        window: `${String(Math.round(triggers.permissionDeniedInWindow.windowMs / MINUTE_MS))} min`,
                      })}
                    </span>
                  )}
                  {triggers.authNotAuthenticated && (
                    <span className={CHIP} data-breaker-trigger-chip="authNotAuthenticated">
                      {t("breaker.trigger.authNotAuthenticated")}
                    </span>
                  )}
                  <span className="text-muted-foreground text-[11px]">
                    {format("{label}: {n} min", {
                      label: t("breaker.cooldown"),
                      n: Math.round(breaker.cooldownMs / MINUTE_MS),
                    })}
                  </span>
                </div>
              </div>

              <div className="flex flex-none items-center gap-1">
                {breaker.state !== "CLOSED" && (
                  <Button
                    aria-label={`${t("breaker.reset")} ${breaker.name}`}
                    data-breaker-reset={breaker.name}
                    onClick={() => {
                      setResetting(breaker);
                    }}
                    size="xs"
                    variant="outline"
                  >
                    <RotateCcw aria-hidden />
                    <span>{t("breaker.reset")}</span>
                  </Button>
                )}
                <Button
                  aria-label={`Editar ${breaker.name}`}
                  onClick={() => {
                    setEditing(breaker);
                    setOpen(true);
                  }}
                  size="icon-sm"
                  variant="ghost"
                >
                  <SquarePen aria-hidden />
                </Button>
                <Button
                  aria-label={`Excluir ${breaker.name}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setRemoving(breaker);
                  }}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </div>
          );
        })}
      </Panel>

      <BreakerDialog
        breaker={editing}
        onOpenChange={setOpen}
        open={open}
        projectId={projectId}
        projectTitle={projectTitle}
      />

      <DeleteRegistryDialog
        action={format("Apagar {breaker}", { breaker: t("entity.breaker") })}
        body={t("breaker.delete.body")}
        data-breaker-delete-dialog=""
        done={t("breaker.delete.done")}
        onOpenChange={(next) => {
          if (!next) setRemoving(null);
        }}
        pending={remove.isPending}
        remove={(id) => remove.mutateAsync(id)}
        target={removing}
        title={t("breaker.delete.title")}
      />

      <AlertDialog
        onOpenChange={(next) => {
          if (!next) setResetting(null);
        }}
        open={resetting !== null}
      >
        <AlertDialogContent data-breaker-reset-dialog={resetting?.name}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {format(t("breaker.reset.title"), { name: resetting?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("breaker.reset.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={reset.isPending}
              onClick={(event) => {
                event.preventDefault();
                confirmReset();
              }}
            >
              <RotateCcw aria-hidden />
              <span>{t("breaker.reset")}</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
