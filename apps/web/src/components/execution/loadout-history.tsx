import { History, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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
import type { LoadoutRecord, LoadoutVersionRecord } from "@/lib/api-types";
import { formatDateTime } from "@/lib/datetime";
import { useAgents, useExecutionProfiles, useHarnesses, useModels } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";
import { loadoutChanges, type LoadoutChange, type LoadoutField } from "@/lib/loadout-changes";
import {
  LOADOUT_VERSIONS_PAGE_SIZE,
  useLoadoutVersions,
  useMcpServers,
  useRestoreLoadoutVersion,
  useSkills,
  useTools,
} from "@/lib/registry";
import { cn } from "@/lib/utils";

export interface LoadoutHistoryProps {
  readonly loadout: LoadoutRecord;
  /** Chamado com o Loadout como ficou depois de restaurar. */
  readonly onRestored: (loadout: LoadoutRecord) => void;
}

/**
 * As versões do Equipamento, com o que mudou entre cada uma e a anterior, e
 * a restauração (Fase 8C).
 *
 * A comparação é entre as definições por referência de duas versões
 * consecutivas, calculada aqui a partir do que a API guardou; os nomes vêm
 * das listas que a tela já tem (um id de Skill apagada fica como id). Restaurar
 * pede confirmação porque cria uma versão nova — nada é reescrito, e o diálogo
 * diz isso — e uma versão idêntica à atual não sobe: a API devolve o Loadout
 * como está, e o painel avisa em vez de fingir que restaurou.
 */
export function LoadoutHistory({ loadout, onRestored }: LoadoutHistoryProps) {
  const { t, format } = useGlossary();
  const [page, setPage] = useState(1);
  const versions = useLoadoutVersions(loadout.id, page);
  const restore = useRestoreLoadoutVersion();
  const [restoring, setRestoring] = useState<LoadoutVersionRecord | null>(null);

  const items = versions.data?.items ?? [];
  const total = versions.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / LOADOUT_VERSIONS_PAGE_SIZE));
  const names = useNames();

  function confirmRestore() {
    if (restoring === null) return;
    const target = restoring;
    restore.mutate(
      { loadoutId: loadout.id, version: target.version },
      {
        onSuccess: (restored) => {
          setRestoring(null);
          if (restored.version === loadout.version) {
            toast.info(
              format(t("loadout.restore.same"), { version: `v${String(target.version)}` }),
            );
            return;
          }
          toast.success(
            format(t("loadout.restore.done"), { version: `v${String(restored.version)}` }),
          );
          onRestored(restored);
        },
        onError: (error: Error) => {
          setRestoring(null);
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <div className="border-border flex flex-col rounded-[10px] border" data-loadout-history>
      <div className="border-border flex items-center justify-between gap-3 border-b px-3.5 py-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2 text-[13px] font-medium">
            <History aria-hidden className="text-muted-foreground size-3.5" />
            <span>{t("loadout.history.title")}</span>
          </span>
          <span className="text-muted-foreground text-[11.5px] leading-4.5">
            {t("loadout.history.description")}
          </span>
        </div>
        <span className="text-muted-foreground flex-none text-[11px]">
          {versions.data === undefined ? "" : format("{n} guardadas", { n: total })}
        </span>
      </div>

      {versions.isError && (
        <p className="text-destructive m-0 px-3.5 py-3 text-sm">{versions.error.message}</p>
      )}
      {!versions.isError && items.length === 0 && (
        <p className="text-muted-foreground m-0 px-3.5 py-3 text-[12.5px]">
          {versions.isPending ? "Lendo…" : t("loadout.history.empty")}
        </p>
      )}

      <ul className="m-0 flex list-none flex-col p-0">
        {items.map((version, index) => {
          // A página vem da mais recente para a mais antiga: a anterior é a seguinte na lista.
          const previous = items[index + 1];
          const current = version.version === loadout.version;
          return (
            <li
              key={version.id}
              className={cn(
                "border-border flex items-start gap-3 border-b px-3.5 py-2.5 last:border-b-0",
                current && "bg-white/[0.03]",
              )}
              data-loadout-version={version.version}
            >
              <span className="flex w-20 flex-none flex-col gap-0.5 whitespace-nowrap">
                <span className="font-mono text-[12.5px] font-medium">
                  {`v${String(version.version)}`}
                </span>
                {current && (
                  <span
                    className="text-muted-foreground text-[10.5px]"
                    data-loadout-version-current
                  >
                    {t("loadout.history.current")}
                  </span>
                )}
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <ChangeList
                  changes={
                    previous === undefined
                      ? null
                      : loadoutChanges(previous.definition, version.definition)
                  }
                  first={previous === undefined && page === lastPage}
                  names={names}
                />
                <span className="text-muted-foreground text-[11px]">
                  {formatDateTime(version.createdAt)}
                </span>
              </div>

              {!current && (
                <Button
                  className="flex-none"
                  data-loadout-restore={version.version}
                  disabled={restore.isPending}
                  onClick={() => {
                    setRestoring(version);
                  }}
                  size="xs"
                  variant="outline"
                >
                  <RotateCcw aria-hidden />
                  <span>{t("loadout.history.restore")}</span>
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {total > LOADOUT_VERSIONS_PAGE_SIZE && (
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <Button
            disabled={page <= 1}
            onClick={() => {
              setPage(page - 1);
            }}
            size="xs"
            variant="outline"
          >
            Anterior
          </Button>
          <span className="text-muted-foreground text-xs">
            {format("{page} de {lastPage}", { page, lastPage })}
          </span>
          <Button
            disabled={page >= lastPage}
            onClick={() => {
              setPage(page + 1);
            }}
            size="xs"
            variant="outline"
          >
            Próxima
          </Button>
        </div>
      )}

      <AlertDialog
        open={restoring !== null}
        onOpenChange={(open) => {
          if (!open) setRestoring(null);
        }}
      >
        <AlertDialogContent data-loadout-restore-dialog>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {format(t("loadout.restore.title"), {
                version: `v${String(restoring?.version ?? 0)}`,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {format(t("loadout.restore.body"), {
                version: `v${String(restoring?.version ?? 0)}`,
                current: `v${String(loadout.version)}`,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={restore.isPending}
              onClick={(event) => {
                event.preventDefault();
                confirmRestore();
              }}
            >
              <RotateCcw aria-hidden />
              <span>{t("loadout.restore.action")}</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface Names {
  readonly agent: ReadonlyMap<string, string>;
  readonly harness: ReadonlyMap<string, string>;
  readonly model: ReadonlyMap<string, string>;
  readonly profile: ReadonlyMap<string, string>;
  readonly skills: ReadonlyMap<string, string>;
  readonly tools: ReadonlyMap<string, string>;
  readonly mcpServers: ReadonlyMap<string, string>;
}

/** Os nomes das entidades referenciadas, das listas que a tela de Loadout já lê. */
function useNames(): Names {
  const agents = useAgents();
  const harnesses = useHarnesses();
  const models = useModels();
  const profiles = useExecutionProfiles();
  const skills = useSkills();
  const tools = useTools();
  const servers = useMcpServers();

  return useMemo(() => {
    const map = (items: readonly { readonly id: string; readonly name: string }[] | undefined) =>
      new Map((items ?? []).map((item) => [item.id, item.name]));
    return {
      agent: map(agents.data?.items),
      harness: map(harnesses.data?.items),
      model: map(models.data?.items),
      profile: map(profiles.data?.items),
      skills: map(skills.data?.items),
      tools: map(tools.data?.items),
      mcpServers: map(servers.data?.items),
    };
  }, [
    agents.data,
    harnesses.data,
    models.data,
    profiles.data,
    skills.data,
    tools.data,
    servers.data,
  ]);
}

function ChangeList({
  changes,
  first,
  names,
}: {
  changes: readonly LoadoutChange[] | null;
  first: boolean;
  names: Names;
}) {
  const { t, format } = useGlossary();

  if (changes === null) {
    return (
      <span className="text-muted-foreground text-[12px]">
        {first ? t("loadout.history.first") : "…"}
      </span>
    );
  }
  if (changes.length === 0) {
    return (
      <span className="text-muted-foreground text-[12px]">{t("loadout.history.noChanges")}</span>
    );
  }

  const fieldLabel: Record<LoadoutField, string> = {
    name: "Nome",
    agent: t("entity.agent"),
    harness: t("entity.harness"),
    model: t("entity.model"),
    profile: t("entity.executionProfile"),
  };
  const fieldName = (field: LoadoutField, id: string | null): string => {
    if (id === null) return "—";
    if (field === "name") return id;
    const map = names[field];
    return map.get(id) ?? id;
  };
  const collectionName = (collection: "skills" | "tools" | "mcpServers", ids: readonly string[]) =>
    ids.map((id) => names[collection].get(id) ?? id).join(", ");
  const pin = (version: number | null) =>
    version === null ? t("loadout.pin.latest").toLowerCase() : `v${String(version)}`;

  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[12px]" data-loadout-changes>
      {changes.map((change, index) => {
        const key = `${change.kind}-${String(index)}`;
        switch (change.kind) {
          case "field":
            return (
              <li key={key} data-loadout-change={change.field}>
                {format(t("loadout.change.field"), {
                  field: fieldLabel[change.field],
                  from: fieldName(change.field, change.from),
                  to: fieldName(change.field, change.to),
                })}
              </li>
            );
          case "added":
          case "removed":
            return (
              <li key={key} data-loadout-change={`${change.kind}:${change.collection}`}>
                {format(
                  t(change.kind === "added" ? "loadout.change.added" : "loadout.change.removed"),
                  {
                    names: collectionName(change.collection, change.ids),
                  },
                )}
              </li>
            );
          case "pin":
            return (
              <li key={key} data-loadout-change="pin">
                {format(t("loadout.change.pin"), {
                  name: names.skills.get(change.skillId) ?? change.skillId,
                  from: pin(change.from),
                  to: pin(change.to),
                })}
              </li>
            );
          case "policy":
            return (
              <li key={key} data-loadout-change="policy">
                {t("loadout.change.policy")}
              </li>
            );
          case "default":
            return (
              <li key={key} data-loadout-change="default">
                {t(change.on ? "loadout.change.default.on" : "loadout.change.default.off")}
              </li>
            );
        }
      })}
    </ul>
  );
}
