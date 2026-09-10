import { Ban, Check, Minus, Plus, ShieldCheck, SquarePen, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ModelDialog } from "@/components/execution/model-dialog";
import type { HarnessRecord, ModelRecord } from "@/lib/api-types";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { HARNESS_CAPABILITY, HARNESS_CAPABILITY_KEYS } from "@/lib/execution-domain";
import { useDeleteModel, useHarnesses, useModels, useSetHarnessEnabled } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";

/**
 * O cadastro fechado de Harnesses, com as capabilities e os Models de cada um.
 *
 * As quatro linhas nascem do `db:seed` e a API não cria nem apaga: um harness
 * novo é um adapter novo. O que esta tela edita é o interruptor de ligado, e os
 * Models que cada um aceita.
 *
 * As capabilities são **declaradas** pelo adapter, não descobertas: mostrar a
 * matriz aqui é o que impede a interface de oferecer "Retomar" para uma CLI que
 * não sabe retomar. `installedVersion` e `checkedAt`, esses sim, vêm do
 * preflight, e ficam nulos até a Fase 2B rodar um.
 */
export function HarnessPanel() {
  const { t, format } = useGlossary();
  const harnesses = useHarnesses();
  const models = useModels();

  const items = harnesses.data?.items ?? [];

  return (
    <Panel className="flex flex-col px-5 pt-4 pb-3.5">
      <div className="flex items-center justify-between pb-1.5">
        <div className="flex items-center gap-2">
          <ShieldCheck aria-hidden className="text-muted-foreground size-3.75" />
          <span className="text-sm font-medium">{t("entity.harness.plural")}</span>
        </div>
        <span className="text-muted-foreground text-xs">
          {format("Versão instalada, capabilities e {models}", {
            models: t("entity.model.plural"),
          })}
        </span>
      </div>

      {harnesses.isPending && <p className="text-muted-foreground py-6 text-sm">Lendo…</p>}
      {harnesses.error !== null && (
        <p className="text-destructive py-6 text-sm">{harnesses.error.message}</p>
      )}

      {items.map((harness, index) => (
        <HarnessRow
          key={harness.id}
          first={index === 0}
          harness={harness}
          models={(models.data?.items ?? []).filter((model) => model.harnessId === harness.id)}
        />
      ))}
    </Panel>
  );
}

/** O Harness que a Fase 3 vai ligar. Desligar os outros é decisão do usuário. */
const PHASE_NOTE: Partial<Record<HarnessRecord["key"], string>> = {
  ANTIGRAVITY: "Fase 3",
};

function HarnessRow({
  harness,
  models,
  first,
}: {
  harness: HarnessRecord;
  models: readonly ModelRecord[];
  first: boolean;
}) {
  const { t, format } = useGlossary();
  const setEnabled = useSetHarnessEnabled();
  const removeModel = useDeleteModel();

  const [editing, setEditing] = useState<ModelRecord | undefined>(undefined);
  const [open, setOpen] = useState(false);

  const note = PHASE_NOTE[harness.key];
  // A nota de fase vale enquanto ninguém ligou o harness à mão; ligado, ela
  // deixaria de ser verdade e some.
  const showNote = note !== undefined && !harness.enabled;

  function toggle(next: boolean) {
    setEnabled.mutate(
      { id: harness.id, enabled: next },
      {
        onError: (error: Error) => {
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <div
      className={cn("flex flex-col gap-2 py-3", !first && "border-border border-t")}
      data-harness={harness.key}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn("text-[13px] font-medium", !harness.enabled && "text-muted-foreground")}
        >
          {harness.name}
        </span>
        <code className="border-border text-muted-foreground rounded-md border bg-white/[0.07] px-1.5 py-px font-mono text-[10.5px]">
          {harness.installedVersion ?? "sem preflight"}
        </code>

        <div className="flex-1" />

        {showNote && (
          <span className="border-border text-muted-foreground inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-[10.5px]">
            <Ban aria-hidden className="size-2.75" />
            <span>{note}</span>
          </span>
        )}

        <Switch
          aria-label={format("Ligar {harness}", { harness: harness.name })}
          checked={harness.enabled}
          disabled={setEnabled.isPending}
          onCheckedChange={toggle}
        />
      </div>

      <div className={cn("flex flex-wrap gap-x-3.5 gap-y-1", !harness.enabled && "opacity-60")}>
        {HARNESS_CAPABILITY_KEYS.map((capability) => {
          const on = harness.capabilities[capability];
          const Icon = harness.enabled ? (on ? Check : Minus) : Minus;
          return (
            <span
              key={capability}
              className={cn(
                "flex items-center gap-1.25 text-[11px]",
                on && harness.enabled ? "" : "text-muted-foreground",
              )}
            >
              <Icon
                aria-hidden
                className={cn(
                  "size-3 flex-none",
                  on && harness.enabled ? "text-accent-green" : "text-muted-foreground",
                )}
                strokeWidth={2.4}
              />
              <span>{t(HARNESS_CAPABILITY[capability])}</span>
            </span>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <span className="text-muted-foreground text-[11px]">{t("entity.model.plural")}</span>
        {models.map((model) => (
          <span
            key={model.id}
            className="border-border inline-flex h-[22px] w-fit items-center gap-1.5 rounded-lg border bg-white/[0.04] px-2 text-xs"
            data-model={model.key}
          >
            <span>{model.name}</span>
            {model.isDefault && <span className="text-muted-foreground text-[10px]">padrão</span>}
            <button
              aria-label={`Editar ${model.name}`}
              className="text-muted-foreground hover:text-foreground flex size-4 items-center justify-center rounded"
              onClick={() => {
                setEditing(model);
                setOpen(true);
              }}
              type="button"
            >
              <SquarePen aria-hidden className="size-3" />
            </button>
            <button
              aria-label={`Excluir ${model.name}`}
              className="text-muted-foreground hover:text-destructive -mr-1 flex size-4 items-center justify-center rounded"
              onClick={() => {
                removeModel.mutate(model.id, {
                  onError: (error: Error) => {
                    toast.error(error.message);
                  },
                });
              }}
              type="button"
            >
              <Trash2 aria-hidden className="size-3" />
            </button>
          </span>
        ))}

        <Button
          className="h-[22px] px-2 text-xs"
          onClick={() => {
            setEditing(undefined);
            setOpen(true);
          }}
          size="xs"
          variant="ghost"
        >
          <Plus aria-hidden />
          <span>{format("Novo {model}", { model: t("entity.model") })}</span>
        </Button>
      </div>

      <ModelDialog harness={harness} model={editing} open={open} onOpenChange={setOpen} />
    </div>
  );
}
