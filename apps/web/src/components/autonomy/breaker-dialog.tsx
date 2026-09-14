import type { BreakerScope, HarnessKey } from "@dungeon-master/contracts";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { CircuitBreakerRecord } from "@/lib/api-types";
import { useCreateCircuitBreaker, useUpdateCircuitBreaker } from "@/lib/autonomy";
import { BREAKER_SCOPE, BREAKER_SCOPES } from "@/lib/autonomy-domain";
import { useHarnesses, useLoadouts } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";

export interface BreakerDialogProps {
  /** Ausente cria; presente edita aquele disjuntor. */
  readonly breaker?: CircuitBreakerRecord;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const MINUTE_MS = 60_000;
const DEFAULT_COOLDOWN_MIN = 15;

interface WindowTrigger {
  readonly on: boolean;
  readonly count: string;
  readonly windowMin: string;
}

const OFF_WINDOW: WindowTrigger = { on: false, count: "3", windowMin: "60" };

function parsePositive(text: string): number | null {
  return /^\d+$/.test(text.trim()) && Number(text.trim()) > 0 ? Number(text.trim()) : null;
}

/**
 * O formulário de um disjuntor (Fase 9C).
 *
 * Escopo na criação, quatro gatilhos opcionais (pelo menos um), o tempo de
 * espera em minutos. O estado não se edita aqui: só os desfechos (9B) e o
 * reset o mudam, e o formulário diz isso.
 */
export function BreakerDialog({
  breaker,
  projectId,
  projectTitle,
  open,
  onOpenChange,
}: BreakerDialogProps) {
  const { t, format } = useGlossary();
  const create = useCreateCircuitBreaker();
  const update = useUpdateCircuitBreaker();
  const loadouts = useLoadouts();
  const harnesses = useHarnesses();

  const [name, setName] = useState("");
  const [scope, setScope] = useState<BreakerScope>("PROJECT");
  const [loadoutId, setLoadoutId] = useState("");
  const [harnessKey, setHarnessKey] = useState<string>("");
  const [consecutive, setConsecutive] = useState<{ on: boolean; count: string }>({
    on: true,
    count: "3",
  });
  const [failuresInWindow, setFailuresInWindow] = useState<WindowTrigger>(OFF_WINDOW);
  const [deniedInWindow, setDeniedInWindow] = useState<WindowTrigger>(OFF_WINDOW);
  const [authNotAuthenticated, setAuthNotAuthenticated] = useState(false);
  const [cooldownMin, setCooldownMin] = useState(String(DEFAULT_COOLDOWN_MIN));
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(breaker?.name ?? "");
    setScope(breaker?.scope ?? "PROJECT");
    setLoadoutId(breaker?.loadoutId ?? "");
    setHarnessKey(breaker?.harnessKey ?? "");
    const triggers = breaker?.triggers;
    setConsecutive(
      triggers === undefined
        ? { on: true, count: "3" }
        : {
            on: triggers.consecutiveFailures !== null,
            count: String(triggers.consecutiveFailures ?? 3),
          },
    );
    setFailuresInWindow(
      triggers?.failuresInWindow === null || triggers === undefined
        ? OFF_WINDOW
        : {
            on: true,
            count: String(triggers.failuresInWindow.count),
            windowMin: String(Math.round(triggers.failuresInWindow.windowMs / MINUTE_MS)),
          },
    );
    setDeniedInWindow(
      triggers?.permissionDeniedInWindow === null || triggers === undefined
        ? OFF_WINDOW
        : {
            on: true,
            count: String(triggers.permissionDeniedInWindow.count),
            windowMin: String(Math.round(triggers.permissionDeniedInWindow.windowMs / MINUTE_MS)),
          },
    );
    setAuthNotAuthenticated(triggers?.authNotAuthenticated ?? false);
    setCooldownMin(
      breaker === undefined
        ? String(DEFAULT_COOLDOWN_MIN)
        : String(Math.max(1, Math.round(breaker.cooldownMs / MINUTE_MS))),
    );
    setEnabled(breaker?.enabled ?? true);
  }, [open, breaker]);

  const pending = create.isPending || update.isPending;

  const consecutiveValue = consecutive.on ? parsePositive(consecutive.count) : null;
  const failuresValue = failuresInWindow.on
    ? {
        count: parsePositive(failuresInWindow.count),
        windowMs: parsePositive(failuresInWindow.windowMin),
      }
    : null;
  const deniedValue = deniedInWindow.on
    ? {
        count: parsePositive(deniedInWindow.count),
        windowMs: parsePositive(deniedInWindow.windowMin),
      }
    : null;
  const cooldownValue = parsePositive(cooldownMin);

  const triggersValid =
    (!consecutive.on || consecutiveValue !== null) &&
    (failuresValue === null || (failuresValue.count !== null && failuresValue.windowMs !== null)) &&
    (deniedValue === null || (deniedValue.count !== null && deniedValue.windowMs !== null));
  const someTrigger =
    consecutive.on || failuresInWindow.on || deniedInWindow.on || authNotAuthenticated;
  const valid =
    name.trim() !== "" &&
    triggersValid &&
    someTrigger &&
    cooldownValue !== null &&
    (scope !== "LOADOUT" || loadoutId !== "") &&
    (scope !== "HARNESS" || harnessKey !== "");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || pending || cooldownValue === null) return;

    const done = {
      onSuccess: () => {
        onOpenChange(false);
        toast.success(t("breaker.save.done"));
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    };

    const triggers = {
      consecutiveFailures: consecutiveValue,
      failuresInWindow:
        failuresValue === null || failuresValue.count === null || failuresValue.windowMs === null
          ? null
          : { count: failuresValue.count, windowMs: failuresValue.windowMs * MINUTE_MS },
      permissionDeniedInWindow:
        deniedValue === null || deniedValue.count === null || deniedValue.windowMs === null
          ? null
          : { count: deniedValue.count, windowMs: deniedValue.windowMs * MINUTE_MS },
      authNotAuthenticated,
    };

    if (breaker === undefined) {
      create.mutate(
        {
          name: name.trim(),
          scope,
          ...(scope === "PROJECT" ? { projectId } : {}),
          ...(scope === "LOADOUT" ? { loadoutId } : {}),
          ...(scope === "HARNESS" ? { harnessKey: harnessKey as HarnessKey } : {}),
          ...triggers,
          cooldownMs: cooldownValue * MINUTE_MS,
          enabled,
        },
        done,
      );
      return;
    }

    update.mutate(
      {
        id: breaker.id,
        name: name.trim(),
        ...triggers,
        cooldownMs: cooldownValue * MINUTE_MS,
        enabled,
      },
      done,
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-[600px]">
        <form className="flex flex-col gap-4" data-breaker-form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {breaker === undefined ? t("breaker.create.title") : t("breaker.edit.title")}
            </DialogTitle>
            <DialogDescription>
              {breaker === undefined ? t("breaker.description") : t("breaker.locked")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="breaker-name">Nome</Label>
            <Input
              autoFocus
              id="breaker-name"
              maxLength={200}
              onChange={(event) => {
                setName(event.target.value);
              }}
              value={name}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="breaker-scope">Escopo</Label>
              <Select
                disabled={breaker !== undefined}
                onValueChange={(next) => {
                  setScope(next as BreakerScope);
                }}
                value={scope}
              >
                <SelectTrigger aria-label="Escopo" id="breaker-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BREAKER_SCOPES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item === "PROJECT"
                        ? format("{scope} · {title}", {
                            scope: t(BREAKER_SCOPE[item]),
                            title: projectTitle,
                          })
                        : t(BREAKER_SCOPE[item])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {scope === "LOADOUT" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="breaker-loadout">{t("entity.loadout")}</Label>
                <Select
                  disabled={breaker !== undefined}
                  onValueChange={setLoadoutId}
                  value={loadoutId}
                >
                  <SelectTrigger aria-label={t("entity.loadout")} id="breaker-loadout">
                    <SelectValue placeholder={t("entity.loadout")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(loadouts.data?.items ?? []).map((loadout) => (
                      <SelectItem key={loadout.id} value={loadout.id}>
                        {loadout.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {scope === "HARNESS" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="breaker-harness">{t("entity.harness")}</Label>
                <Select
                  disabled={breaker !== undefined}
                  onValueChange={setHarnessKey}
                  value={harnessKey}
                >
                  <SelectTrigger aria-label={t("entity.harness")} id="breaker-harness">
                    <SelectValue placeholder={t("entity.harness")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(harnesses.data?.items ?? []).map((harness) => (
                      <SelectItem key={harness.key} value={harness.key}>
                        {harness.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Gatilhos</span>
            <span className="text-muted-foreground text-[11.5px] leading-4">
              {t("breaker.triggers.hint")}
            </span>

            <TriggerRow
              checked={consecutive.on}
              label={t("breaker.consecutiveFailures")}
              onCheckedChange={(on) => {
                setConsecutive((current) => ({ ...current, on }));
              }}
              testId="consecutiveFailures"
            >
              <CountInput
                id="breaker-consecutive"
                onChange={(count) => {
                  setConsecutive((current) => ({ ...current, count }));
                }}
                value={consecutive.count}
              />
            </TriggerRow>

            <TriggerRow
              checked={failuresInWindow.on}
              label={format(t("breaker.trigger.failuresInWindow"), { n: "N", window: "T" })}
              onCheckedChange={(on) => {
                setFailuresInWindow((current) => ({ ...current, on }));
              }}
              testId="failuresInWindow"
            >
              <CountInput
                id="breaker-failures-count"
                onChange={(count) => {
                  setFailuresInWindow((current) => ({ ...current, count }));
                }}
                value={failuresInWindow.count}
              />
              <CountInput
                id="breaker-failures-window"
                onChange={(windowMin) => {
                  setFailuresInWindow((current) => ({ ...current, windowMin }));
                }}
                suffix="min"
                value={failuresInWindow.windowMin}
              />
            </TriggerRow>

            <TriggerRow
              checked={deniedInWindow.on}
              label={format(t("breaker.trigger.permissionDeniedInWindow"), { n: "N", window: "T" })}
              onCheckedChange={(on) => {
                setDeniedInWindow((current) => ({ ...current, on }));
              }}
              testId="permissionDeniedInWindow"
            >
              <CountInput
                id="breaker-denied-count"
                onChange={(count) => {
                  setDeniedInWindow((current) => ({ ...current, count }));
                }}
                value={deniedInWindow.count}
              />
              <CountInput
                id="breaker-denied-window"
                onChange={(windowMin) => {
                  setDeniedInWindow((current) => ({ ...current, windowMin }));
                }}
                suffix="min"
                value={deniedInWindow.windowMin}
              />
            </TriggerRow>

            <TriggerRow
              checked={authNotAuthenticated}
              label={t("breaker.trigger.authNotAuthenticated")}
              onCheckedChange={setAuthNotAuthenticated}
              testId="authNotAuthenticated"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="breaker-cooldown">{t("breaker.cooldown")}</Label>
              <CountInput
                id="breaker-cooldown"
                onChange={setCooldownMin}
                suffix="min"
                value={cooldownMin}
              />
            </div>
            <label
              className="flex cursor-pointer items-center gap-2 self-end pb-2 text-[12.5px]"
              htmlFor="breaker-enabled"
            >
              <Switch
                checked={enabled}
                disabled={pending}
                id="breaker-enabled"
                onCheckedChange={setEnabled}
              />
              <span>Ligado</span>
            </label>
          </div>

          <DialogFooter>
            <Button
              onClick={() => {
                onOpenChange(false);
              }}
              type="button"
              variant="outline"
            >
              Cancelar
            </Button>
            <Button data-breaker-save disabled={!valid || pending} type="submit">
              {breaker === undefined ? t("breaker.create.title") : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TriggerRow({
  checked,
  label,
  onCheckedChange,
  testId,
  children,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (on: boolean) => void;
  testId: string;
  children?: ReactNode;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-lg border border-transparent px-1 py-1"
      data-breaker-trigger={testId}
      data-breaker-trigger-on={checked ? "true" : "false"}
    >
      <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px]">
        <Checkbox
          aria-label={label}
          checked={checked}
          onCheckedChange={(next) => {
            onCheckedChange(next === true);
          }}
        />
        <span className={checked ? undefined : "text-muted-foreground"}>{label}</span>
      </label>
      {checked && children !== undefined && (
        <div className="flex items-center gap-2">{children}</div>
      )}
    </div>
  );
}

function CountInput({
  id,
  value,
  onChange,
  suffix,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  suffix?: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <Input
        aria-invalid={parsePositive(value) === null}
        className="w-20 font-mono"
        id={id}
        inputMode="numeric"
        min={1}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        type="number"
        value={value}
      />
      {suffix !== undefined && <span className="text-muted-foreground text-[11px]">{suffix}</span>}
    </span>
  );
}
