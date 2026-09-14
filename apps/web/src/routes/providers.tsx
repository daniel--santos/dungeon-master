import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, KeyRound, Landmark, Plus, SquarePen, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { DeleteRegistryDialog } from "@/components/registry/delete-registry-dialog";
import { ProviderAuthBadge } from "@/components/registry/provider-auth-badge";
import { ProviderDialog } from "@/components/registry/provider-dialog";
import { RegistryHeader } from "@/components/registry/registry-header";
import { Button } from "@/components/ui/button";
import type { LoadoutRecord, ProviderRecord } from "@/lib/api-types";
import { relativeTime } from "@/lib/datetime";
import { useHarnesses, useLoadouts, useModels } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";
import { useProviderAuth } from "@/lib/provider-auth";
import { fetchLoadoutPreflight, useDeleteProvider, useProviders } from "@/lib/registry";
import { PROVIDER_KIND, REGISTRY_COLOR } from "@/lib/registry-domain";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/providers")({
  component: ProvidersPage,
});

/**
 * Os Patronatos do Arsenal (Fase 8C): quem serve os Patronos, como se
 * autentica, e o último estado de credencial que um preflight trouxe.
 *
 * A API não mede "o Patronato": mede o preflight de um Equipamento, que traz
 * o Patronato do Patrono efetivo com o estado da credencial. A linha mostra a
 * última foto que qualquer preflight tirou (o painel de compatibilidade, o
 * diálogo de partida) e, a pedido, tira uma nova pelo primeiro Equipamento
 * cujo Patrono é deste Patronato ou cuja Guilda ele declara. Sem nenhum, diz
 * isso. Nenhum Patrono é chamado, e nenhum valor de credencial aparece.
 */
function ProvidersPage() {
  const { t, format } = useGlossary();
  const providers = useProviders();
  const remove = useDeleteProvider();

  const [editing, setEditing] = useState<ProviderRecord | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<ProviderRecord | null>(null);

  const items = providers.data?.items ?? [];

  function create() {
    setEditing(undefined);
    setOpen(true);
  }

  return (
    <>
      <RegistryHeader
        actions={
          <Button onClick={create}>
            <Plus aria-hidden />
            <span>{t("provider.create.title")}</span>
          </Button>
        }
        tab="providers"
      />

      <Panel className="flex flex-col px-5 pt-4 pb-3.5">
        <div className="flex items-center justify-between gap-4 pb-1.5">
          <div className="flex items-center gap-2">
            <Landmark aria-hidden className="size-3.75" style={{ color: REGISTRY_COLOR }} />
            <span className="text-sm font-medium">{t("entity.provider.plural")}</span>
          </div>
          <span className="text-muted-foreground text-xs">
            {format("{n} cadastrados", { n: items.length })}
          </span>
        </div>
        <p className="text-muted-foreground m-0 pb-2 text-[12.5px] leading-5">
          {t("provider.description")}
        </p>

        {providers.isPending && <p className="text-muted-foreground py-6 text-sm">Lendo…</p>}
        {providers.error !== null && (
          <p className="text-destructive py-6 text-sm">{providers.error.message}</p>
        )}

        {!providers.isPending && providers.error === null && items.length === 0 && (
          <EmptyState
            action={
              <Button onClick={create} size="sm" variant="outline">
                <Plus aria-hidden />
                <span>{t("provider.create.title")}</span>
              </Button>
            }
            icon={Landmark}
            title={format("Nenhum {provider} ainda", { provider: t("entity.provider") })}
          >
            {t("provider.list.empty")}
          </EmptyState>
        )}

        {items.map((provider, index) => (
          <ProviderRow
            key={provider.id}
            first={index === 0}
            onEdit={() => {
              setEditing(provider);
              setOpen(true);
            }}
            onRemove={() => {
              setRemoving(provider);
            }}
            provider={provider}
          />
        ))}
      </Panel>

      <ProviderDialog onOpenChange={setOpen} open={open} provider={editing} />

      <DeleteRegistryDialog
        action={format("Apagar {provider}", { provider: t("entity.provider") })}
        body={t("provider.delete.body")}
        data-provider-delete-dialog=""
        done={t("provider.delete.done")}
        onOpenChange={(next) => {
          if (!next) setRemoving(null);
        }}
        pending={remove.isPending}
        remove={(id) => remove.mutateAsync(id)}
        target={removing}
        title={t("provider.delete.title")}
      />
    </>
  );
}

function ProviderRow({
  provider,
  first,
  onEdit,
  onRemove,
}: {
  provider: ProviderRecord;
  first: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t, format } = useGlossary();
  const auth = useProviderAuth(provider.id);
  const harnesses = useHarnesses();
  const loadouts = useLoadouts();
  const models = useModels();
  const [checking, setChecking] = useState(false);

  const harnessNames = useMemo(
    () => new Map((harnesses.data?.items ?? []).map((harness) => [harness.id, harness.name])),
    [harnesses.data],
  );
  const harnessIdsByKey = useMemo(
    () => new Map((harnesses.data?.items ?? []).map((harness) => [harness.key, harness.id])),
    [harnesses.data],
  );

  // O Equipamento que responde por este Patronato: o primeiro cujo Patrono
  // pertence a ele, ou o primeiro cuja Guilda ele declara.
  const probe = useMemo<LoadoutRecord | undefined>(() => {
    const list = loadouts.data?.items ?? [];
    const modelIds = new Set(
      (models.data?.items ?? [])
        .filter((model) => model.providerId === provider.id)
        .map((model) => model.id),
    );
    const byModel = list.find(
      (loadout) => loadout.modelId !== null && modelIds.has(loadout.modelId),
    );
    if (byModel !== undefined) return byModel;
    const harnessIds = new Set(
      provider.harnessKeys
        .map((key) => harnessIdsByKey.get(key))
        .filter((id): id is string => id !== undefined),
    );
    return list.find((loadout) => harnessIds.has(loadout.harnessId));
  }, [harnessIdsByKey, loadouts.data, models.data, provider.harnessKeys, provider.id]);

  function check() {
    if (probe === undefined || checking) return;
    setChecking(true);
    fetchLoadoutPreflight(probe.id)
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setChecking(false);
      });
  }

  return (
    <div
      className={cn("flex items-start gap-3 py-3", !first && "border-border border-t")}
      data-provider={provider.name}
    >
      <span className="border-border flex size-8 flex-none items-center justify-center rounded-lg border bg-accent-violet/12">
        <Landmark aria-hidden className="size-3.75" style={{ color: REGISTRY_COLOR }} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">{provider.name}</span>
          <span className="border-border inline-flex h-[20px] w-fit items-center rounded-lg border bg-white/[0.04] px-2 text-[11px]">
            {t(PROVIDER_KIND[provider.kind])}
          </span>
          <ProviderAuthBadge status={auth?.auth.status ?? "UNKNOWN"} />
          {auth !== undefined && (
            <span className="text-muted-foreground text-[11px]" data-provider-checked-at>
              {format(t("provider.auth.checkedAt"), { when: relativeTime(auth.checkedAt) })}
            </span>
          )}
        </div>

        <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <KeyRound aria-hidden className="size-3" />
          {provider.authEnvKeys.length === 0 ? (
            <span>—</span>
          ) : (
            provider.authEnvKeys.map((key) => (
              <code
                key={key}
                className={cn(
                  "font-mono text-[10.5px]",
                  auth?.auth.presentEnvKeys.includes(key) === true && "text-foreground",
                )}
                data-provider-env-key={key}
              >
                {key}
              </code>
            ))
          )}
          <span aria-hidden>·</span>
          <span>
            {provider.harnessKeys.length === 0
              ? "—"
              : provider.harnessKeys
                  .map((key) => harnessNames.get(harnessIdsByKey.get(key) ?? "") ?? key)
                  .join(", ")}
          </span>
          {provider.docsUrl !== null && (
            <>
              <span aria-hidden>·</span>
              <a
                className="hover:text-foreground flex items-center gap-1 underline-offset-2 hover:underline"
                href={provider.docsUrl}
                rel="noreferrer"
                target="_blank"
              >
                <span>{t("provider.docsUrl")}</span>
                <ExternalLink aria-hidden className="size-3" />
              </a>
            </>
          )}
        </span>

        <span className="text-muted-foreground text-[11px] leading-4">
          {probe === undefined ? t("provider.auth.noLoadout") : t("provider.auth.hint")}
        </span>
      </div>

      <div className="flex flex-none items-center gap-1">
        <Button
          data-provider-check
          disabled={probe === undefined || checking}
          onClick={check}
          size="xs"
          variant="outline"
        >
          {checking ? t("provider.auth.checking") : t("provider.auth.check")}
        </Button>
        <Button
          aria-label={`Editar ${provider.name}`}
          onClick={onEdit}
          size="icon-sm"
          variant="ghost"
        >
          <SquarePen aria-hidden />
        </Button>
        <Button
          aria-label={`Excluir ${provider.name}`}
          className="text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          size="icon-sm"
          variant="ghost"
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </div>
  );
}
