import { createFileRoute } from "@tanstack/react-router";
import { Package, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { HarnessPanel } from "@/components/execution/harness-panel";
import { LoadoutForm } from "@/components/execution/loadout-form";
import { ProfilePanel } from "@/components/execution/profile-panel";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import type { LoadoutRecord } from "@/lib/api-types";
import { useAgents, useDeleteLoadout, useHarnesses, useLoadouts } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/loadouts")({
  component: LoadoutsPage,
});

/**
 * A tela de Loadouts, e com ela os cadastros de que um Loadout depende.
 *
 * A lista escolhe, o formulário edita, e embaixo ficam os Harnesses e os perfis
 * de execução — que não são "configurações avançadas" escondidas em outro
 * lugar, mas o que decide onde o trabalho vai rodar. O canvas da Fase 2 põe os
 * três na mesma tela pelo mesmo motivo: quem monta um Loadout precisa ver a
 * matriz de capabilities e o modo de execução sem navegar.
 */
function LoadoutsPage() {
  const { t, format } = useGlossary();
  const loadouts = useLoadouts();
  const agents = useAgents();
  const harnesses = useHarnesses();
  const remove = useDeleteLoadout();

  /** `undefined` não edita nada, `null` é um Loadout novo. */
  const [selected, setSelected] = useState<LoadoutRecord | null | undefined>(undefined);

  const items = loadouts.data?.items ?? [];
  const agentNames = new Map((agents.data?.items ?? []).map((agent) => [agent.id, agent.name]));
  const harnessNames = new Map(
    (harnesses.data?.items ?? []).map((harness) => [harness.id, harness.name]),
  );

  const editing = selected === undefined ? undefined : selected;

  return (
    <>
      <PageHeader
        title={t("nav.loadouts")}
        description={format(
          "O que um {agent} leva para a {run}: a {harness}, o {model}, o perfil de execução e o que ele pode usar.",
          {
            agent: t("entity.agent"),
            run: t("entity.run"),
            harness: t("entity.harness"),
            model: t("entity.model"),
          },
        )}
        actions={
          <Button
            onClick={() => {
              setSelected(null);
            }}
          >
            <Plus aria-hidden />
            <span>{format("Novo {loadout}", { loadout: t("entity.loadout") })}</span>
          </Button>
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Panel className="flex flex-col gap-1 p-3">
          <div className="flex items-center justify-between px-1 pt-0.5 pb-2">
            <span className="text-[13px] font-medium">
              {format(items.length === 1 ? "{n} {one}" : "{n} {many}", {
                n: items.length,
                one: t("entity.loadout"),
                many: t("entity.loadout.plural"),
              })}
            </span>
          </div>

          {loadouts.isPending && <p className="text-muted-foreground px-1 py-4 text-sm">Lendo…</p>}
          {loadouts.error !== null && (
            <p className="text-destructive px-1 py-4 text-sm">{loadouts.error.message}</p>
          )}

          {items.map((loadout) => {
            const active = editing !== undefined && editing !== null && editing.id === loadout.id;
            return (
              <div
                key={loadout.id}
                className={cn(
                  "flex items-center gap-2.5 rounded-[10px] border px-3 py-2.5",
                  active ? "border-input bg-white/[0.06]" : "border-transparent",
                )}
                data-loadout={loadout.name}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  onClick={() => {
                    setSelected(loadout);
                  }}
                  type="button"
                >
                  <span className="border-border flex size-7.5 flex-none items-center justify-center rounded-lg border bg-[oklch(0.72_0.13_305)]/12">
                    <Package
                      aria-hidden
                      className={cn(
                        "size-3.75",
                        active ? "text-[oklch(0.72_0.13_305)]" : "text-muted-foreground",
                      )}
                    />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className={cn("truncate text-[13px]", active && "font-medium")}>
                      {loadout.name}
                    </span>
                    <span className="text-muted-foreground truncate text-[11px]">
                      {`${agentNames.get(loadout.agentId) ?? "—"} · ${harnessNames.get(loadout.harnessId) ?? "—"}`}
                    </span>
                  </span>
                </button>

                <span className="text-muted-foreground flex-none font-mono text-[10.5px]">
                  {`v${String(loadout.version)}`}
                </span>

                <Button
                  aria-label={`Excluir ${loadout.name}`}
                  className="text-muted-foreground hover:text-destructive flex-none"
                  onClick={() => {
                    remove.mutate(loadout.id, {
                      onSuccess: () => {
                        setSelected(undefined);
                      },
                      onError: (error: Error) => {
                        toast.error(error.message);
                      },
                    });
                  }}
                  size="icon-xs"
                  variant="ghost"
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            );
          })}

          <Button
            className="mt-1 w-full"
            onClick={() => {
              setSelected(null);
            }}
            size="sm"
            variant="outline"
          >
            <Plus aria-hidden />
            <span>{format("Novo {loadout}", { loadout: t("entity.loadout") })}</span>
          </Button>
        </Panel>

        {editing === undefined ? (
          <Panel>
            <EmptyState
              action={
                <Button
                  onClick={() => {
                    setSelected(null);
                  }}
                  size="sm"
                  variant="outline"
                >
                  <Plus aria-hidden />
                  <span>{format("Novo {loadout}", { loadout: t("entity.loadout") })}</span>
                </Button>
              }
              icon={Package}
              title={
                items.length === 0
                  ? format("Nenhum {loadout} ainda", { loadout: t("entity.loadout") })
                  : format("Escolha um {loadout}", { loadout: t("entity.loadout") })
              }
            >
              {format(
                "Um {loadout} junta o {agent}, a {harness}, o {model} e o perfil de execução numa combinação que uma {run} pode carregar inteira.",
                {
                  loadout: t("entity.loadout"),
                  agent: t("entity.agent"),
                  harness: t("entity.harness"),
                  model: t("entity.model"),
                  run: t("entity.run"),
                },
              )}
            </EmptyState>
          </Panel>
        ) : (
          <LoadoutForm
            key={editing?.id ?? "novo"}
            loadout={editing}
            onCancel={() => {
              setSelected(undefined);
            }}
            onSaved={(saved) => {
              setSelected(saved);
              toast.success(
                format("{loadout} salvo em {version}.", {
                  loadout: t("entity.loadout"),
                  version: `v${String(saved.version)}`,
                }),
              );
            }}
          />
        )}
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <ProfilePanel />
        <HarnessPanel />
      </div>
    </>
  );
}
