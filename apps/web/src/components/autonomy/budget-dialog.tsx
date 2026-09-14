import type { BudgetAction, BudgetLimitKey, BudgetScope, BudgetWindow } from "@dungeon-master/contracts";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import type { BudgetRecord } from "@/lib/api-types";
import { useCreateBudget, useUpdateBudget } from "@/lib/autonomy";
import {
  BUDGET_ACTION,
  BUDGET_ACTIONS,
  BUDGET_LIMIT_KEY,
  BUDGET_SCOPE,
  BUDGET_SCOPES,
  BUDGET_WINDOW,
  BUDGET_WINDOWS,
  limitKeysFor,
} from "@/lib/autonomy-domain";
import { useLoadouts } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";

export interface BudgetDialogProps {
  /** Ausente cria; presente edita aquele orçamento. */
  readonly budget?: BudgetRecord;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

type Limits = Record<BudgetLimitKey, string>;

const EMPTY_LIMITS: Limits = {
  maxTokens: "",
  maxRuns: "",
  maxWallClockMs: "",
  maxConcurrentRuns: "",
};

/** O tempo é digitado em minutos; a API guarda milissegundos. */
const MINUTE_MS = 60_000;

function parseLimit(key: BudgetLimitKey, text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const value = Number(trimmed) * (key === "maxWallClockMs" ? MINUTE_MS : 1);
  return value > 0 ? value : "invalid";
}

/**
 * O formulário de um orçamento (Fase 9C).
 *
 * Escopo e janela se escolhem na criação e não mudam: a API recusa, e um
 * formulário que fingisse trocar só adiaria a recusa. Os quatro tetos são
 * opcionais, mas pelo menos um precisa existir; `PER_RUN` só mede tokens e
 * tempo, então os outros dois somem quando a janela é essa. O tempo é
 * digitado em minutos, porque ninguém pensa um teto em milissegundos.
 */
export function BudgetDialog({
  budget,
  projectId,
  projectTitle,
  open,
  onOpenChange,
}: BudgetDialogProps) {
  const { t, format } = useGlossary();
  const create = useCreateBudget();
  const update = useUpdateBudget();
  const loadouts = useLoadouts();

  const [name, setName] = useState("");
  const [scope, setScope] = useState<BudgetScope>("PROJECT");
  const [loadoutId, setLoadoutId] = useState("");
  const [window, setWindow] = useState<BudgetWindow>("DAY");
  const [limits, setLimits] = useState<Limits>(EMPTY_LIMITS);
  const [action, setAction] = useState<BudgetAction>("BLOCK");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(budget?.name ?? "");
    setScope(budget?.scope ?? "PROJECT");
    setLoadoutId(budget?.loadoutId ?? "");
    setWindow(budget?.window ?? "DAY");
    setLimits({
      maxTokens: budget?.limits.maxTokens === null || budget === undefined ? "" : String(budget.limits.maxTokens),
      maxRuns: budget?.limits.maxRuns === null || budget === undefined ? "" : String(budget.limits.maxRuns),
      maxWallClockMs:
        budget?.limits.maxWallClockMs === null || budget === undefined
          ? ""
          : String(Math.round(budget.limits.maxWallClockMs / MINUTE_MS)),
      maxConcurrentRuns:
        budget?.limits.maxConcurrentRuns === null || budget === undefined
          ? ""
          : String(budget.limits.maxConcurrentRuns),
    });
    setAction(budget?.action ?? "BLOCK");
    setEnabled(budget?.enabled ?? true);
  }, [open, budget]);

  const pending = create.isPending || update.isPending;
  const keys = limitKeysFor(window);
  const parsed = Object.fromEntries(keys.map((key) => [key, parseLimit(key, limits[key])])) as Record<
    BudgetLimitKey,
    number | null | "invalid"
  >;
  const someInvalid = keys.some((key) => parsed[key] === "invalid");
  const someLimit = keys.some((key) => typeof parsed[key] === "number");
  const valid =
    name.trim() !== "" &&
    !someInvalid &&
    someLimit &&
    (scope !== "LOADOUT" || loadoutId !== "");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || pending) return;

    const done = {
      onSuccess: () => {
        onOpenChange(false);
        toast.success(t("budget.save.done"));
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    };

    const limitBody = Object.fromEntries(
      keys.map((key) => [key, parsed[key] === "invalid" ? null : parsed[key]]),
    ) as Partial<Record<BudgetLimitKey, number | null>>;

    if (budget === undefined) {
      create.mutate(
        {
          name: name.trim(),
          scope,
          window,
          ...(scope === "PROJECT" ? { projectId } : {}),
          ...(scope === "LOADOUT" ? { loadoutId } : {}),
          ...limitBody,
          action,
          enabled,
        },
        done,
      );
      return;
    }

    update.mutate({ id: budget.id, name: name.trim(), ...limitBody, action, enabled }, done);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-[600px]">
        <form className="flex flex-col gap-4" data-budget-form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {budget === undefined ? t("budget.create.title") : t("budget.edit.title")}
            </DialogTitle>
            <DialogDescription>
              {budget === undefined ? t("budget.description") : t("budget.locked")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="budget-name">Nome</Label>
            <Input
              autoFocus
              id="budget-name"
              maxLength={200}
              onChange={(event) => {
                setName(event.target.value);
              }}
              value={name}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="budget-scope">Escopo</Label>
              <Select
                disabled={budget !== undefined}
                onValueChange={(next) => {
                  setScope(next as BudgetScope);
                }}
                value={scope}
              >
                <SelectTrigger aria-label="Escopo" id="budget-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUDGET_SCOPES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item === "PROJECT"
                        ? format("{scope} · {title}", {
                            scope: t(BUDGET_SCOPE[item]),
                            title: projectTitle,
                          })
                        : t(BUDGET_SCOPE[item])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="budget-window">{t("budget.usage.window")}</Label>
              <Select
                disabled={budget !== undefined}
                onValueChange={(next) => {
                  setWindow(next as BudgetWindow);
                }}
                value={window}
              >
                <SelectTrigger aria-label={t("budget.usage.window")} id="budget-window">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUDGET_WINDOWS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {t(BUDGET_WINDOW[item])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {scope === "LOADOUT" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="budget-loadout">{t("entity.loadout")}</Label>
              <Select disabled={budget !== undefined} onValueChange={setLoadoutId} value={loadoutId}>
                <SelectTrigger aria-label={t("entity.loadout")} id="budget-loadout">
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

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Tetos</span>
            <span className="text-muted-foreground text-[11.5px] leading-4">
              {t("budget.limits.hint")}
            </span>
            <div className="grid gap-3 sm:grid-cols-2">
              {keys.map((key) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <Label htmlFor={`budget-limit-${key}`}>{t(BUDGET_LIMIT_KEY[key])}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      aria-invalid={parsed[key] === "invalid"}
                      className="w-36 font-mono"
                      id={`budget-limit-${key}`}
                      inputMode="numeric"
                      min={1}
                      onChange={(event) => {
                        const next = event.target.value;
                        setLimits((current) => ({ ...current, [key]: next }));
                      }}
                      placeholder="sem teto"
                      type="number"
                      value={limits[key]}
                      {...{ "data-budget-limit-input": key }}
                    />
                    {key === "maxWallClockMs" && (
                      <span className="text-muted-foreground text-[11.5px]">min</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="budget-action">{t("budget.usage.exceeded")}</Label>
              <Select
                onValueChange={(next) => {
                  setAction(next as BudgetAction);
                }}
                value={action}
              >
                <SelectTrigger aria-label={t("budget.usage.exceeded")} id="budget-action">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUDGET_ACTIONS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {t(BUDGET_ACTION[item])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-[12.5px]" htmlFor="budget-enabled">
              <Switch checked={enabled} disabled={pending} id="budget-enabled" onCheckedChange={setEnabled} />
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
            <Button data-budget-save disabled={!valid || pending} type="submit">
              {budget === undefined ? t("budget.create.title") : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
