import type { RoutingKind } from "@dungeon-master/contracts";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ConditionsEditor, conditionsValid } from "@/components/autonomy/conditions-editor";
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
import type { RoutingRuleRecord, RuleConditionsRecord } from "@/lib/api-types";
import { useCreateRoutingRule, useUpdateRoutingRule } from "@/lib/autonomy";
import { ROUTING_KIND, ROUTING_KINDS } from "@/lib/autonomy-domain";
import { useHarnesses, useLoadouts, useModels } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";
import { useWorkflows } from "@/lib/workflows";

/** O Radix recusa `value=""`, então "global" e "escolha" precisam de valores próprios. */
const GLOBAL = "__global__";
const PICK = "__pick__";

export interface RoutingRuleDialogProps {
  /** Ausente cria; presente edita aquela regra. */
  readonly rule?: RoutingRuleRecord;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

interface Target {
  readonly id: string;
  readonly name: string;
}

/**
 * O formulário de uma regra de roteamento (Fase 9C).
 *
 * A espécie se escolhe na criação e não muda: os alvos de uma espécie não
 * servem à outra. O alvo preferido e os reservas vêm do registro certo —
 * Models (com o Harness ao lado, porque um Model de outro Harness não serve
 * na hora), Loadouts ou Workflows —, escolhidos pelo nome; a ordem dos
 * reservas é a ordem em que a partida os tenta.
 */
export function RoutingRuleDialog({
  rule,
  projectId,
  projectTitle,
  open,
  onOpenChange,
}: RoutingRuleDialogProps) {
  const { t, format } = useGlossary();
  const create = useCreateRoutingRule();
  const update = useUpdateRoutingRule();
  const models = useModels();
  const harnesses = useHarnesses();
  const loadouts = useLoadouts();
  const workflows = useWorkflows();

  const [name, setName] = useState("");
  const [kind, setKind] = useState<RoutingKind>("MODEL");
  const [targetId, setTargetId] = useState("");
  const [fallbackIds, setFallbackIds] = useState<readonly string[]>([]);
  const [priority, setPriority] = useState("100");
  const [scope, setScope] = useState<string>(projectId);
  const [enabled, setEnabled] = useState(true);
  const [conditions, setConditions] = useState<RuleConditionsRecord>({});

  useEffect(() => {
    if (!open) return;
    setName(rule?.name ?? "");
    setKind(rule?.kind ?? "MODEL");
    setTargetId(rule?.targetId ?? "");
    setFallbackIds(rule?.fallbackIds ?? []);
    setPriority(String(rule?.priority ?? 100));
    setScope(rule === undefined ? projectId : (rule.projectId ?? GLOBAL));
    setEnabled(rule?.enabled ?? true);
    setConditions(rule?.conditions ?? {});
  }, [open, rule, projectId]);

  const targets = useMemo<readonly Target[]>(() => {
    switch (kind) {
      case "MODEL": {
        const harnessNames = new Map(
          (harnesses.data?.items ?? []).map((harness) => [harness.id, harness.name]),
        );
        return (models.data?.items ?? []).map((model) => ({
          id: model.id,
          name: `${model.name} · ${harnessNames.get(model.harnessId) ?? "…"}`,
        }));
      }
      case "LOADOUT":
        return (loadouts.data?.items ?? []).map((loadout) => ({
          id: loadout.id,
          name: loadout.name,
        }));
      case "WORKFLOW":
        return (workflows.data?.items ?? []).map((workflow) => ({
          id: workflow.id,
          name: workflow.name,
        }));
    }
  }, [harnesses.data, kind, loadouts.data, models.data, workflows.data]);

  const targetNames = useMemo(
    () => new Map(targets.map((target) => [target.id, target.name])),
    [targets],
  );
  const available = targets.filter(
    (target) => target.id !== targetId && !fallbackIds.includes(target.id),
  );

  const pending = create.isPending || update.isPending;
  const priorityValue = /^\d+$/.test(priority.trim()) ? Number(priority.trim()) : null;
  const valid =
    name.trim() !== "" && targetId !== "" && priorityValue !== null && conditionsValid(conditions);

  function move(index: number, delta: -1 | 1) {
    const next = [...fallbackIds];
    const swap = index + delta;
    if (swap < 0 || swap >= next.length) return;
    const current = next[index];
    const other = next[swap];
    if (current === undefined || other === undefined) return;
    next[index] = other;
    next[swap] = current;
    setFallbackIds(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || pending || priorityValue === null) return;

    const done = {
      onSuccess: () => {
        onOpenChange(false);
        toast.success(t("routing.save.done"));
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    };

    const body = {
      name: name.trim(),
      priority: priorityValue,
      projectId: scope === GLOBAL ? null : scope,
      conditions,
      targetId,
      fallbackIds: [...fallbackIds],
      enabled,
    };

    if (rule === undefined) {
      create.mutate({ kind, ...body }, done);
      return;
    }
    update.mutate({ id: rule.id, ...body }, done);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-[640px]">
        <form className="flex flex-col gap-4" data-routing-form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {rule === undefined ? t("routing.create.title") : t("routing.edit.title")}
            </DialogTitle>
            <DialogDescription>
              {rule === undefined ? t("routing.description") : t("routing.kindLocked")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="routing-name">Nome</Label>
            <Input
              autoFocus
              id="routing-name"
              maxLength={200}
              onChange={(event) => {
                setName(event.target.value);
              }}
              value={name}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="routing-kind">Espécie</Label>
              <Select
                disabled={rule !== undefined}
                onValueChange={(next) => {
                  setKind(next as RoutingKind);
                  setTargetId("");
                  setFallbackIds([]);
                }}
                value={kind}
              >
                <SelectTrigger aria-label="Espécie" id="routing-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROUTING_KINDS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {t(ROUTING_KIND[item])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="routing-target">{t("routing.target")}</Label>
              <Select
                onValueChange={(next) => {
                  setTargetId(next);
                  setFallbackIds((current) => current.filter((id) => id !== next));
                }}
                value={targetId === "" ? PICK : targetId}
              >
                <SelectTrigger aria-label={t("routing.target")} id="routing-target">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem disabled value={PICK}>
                    {t(ROUTING_KIND[kind])}
                  </SelectItem>
                  {targets.map((target) => (
                    <SelectItem key={target.id} value={target.id}>
                      {target.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {kind === "MODEL" && (
            <p
              className="text-muted-foreground m-0 text-[11.5px] leading-4"
              data-routing-model-note
            >
              {t("routing.model.note")}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t("routing.fallbacks")}</span>
            <span className="text-muted-foreground text-[11.5px] leading-4">
              {t("routing.fallbacks.hint")}
            </span>
            {fallbackIds.length > 0 && (
              <ol
                className="m-0 flex list-none flex-col gap-1 p-0"
                data-routing-fallbacks={fallbackIds.length}
              >
                {fallbackIds.map((id, index) => (
                  <li
                    key={id}
                    className="border-border flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px]"
                    data-routing-fallback={id}
                  >
                    <span className="text-muted-foreground w-4 font-mono text-[10.5px]">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {targetNames.get(id) ?? t("routing.target.missing")}
                    </span>
                    <Button
                      aria-label={`Subir ${targetNames.get(id) ?? id}`}
                      disabled={index === 0}
                      onClick={() => {
                        move(index, -1);
                      }}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      aria-label={`Descer ${targetNames.get(id) ?? id}`}
                      disabled={index === fallbackIds.length - 1}
                      onClick={() => {
                        move(index, 1);
                      }}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      aria-label={`Remover ${targetNames.get(id) ?? id}`}
                      onClick={() => {
                        setFallbackIds((current) => current.filter((item) => item !== id));
                      }}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <X aria-hidden />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
            <Select
              disabled={available.length === 0 || fallbackIds.length >= 10}
              onValueChange={(next) => {
                if (next === PICK) return;
                setFallbackIds((current) => [...current, next]);
              }}
              value={PICK}
            >
              <SelectTrigger
                aria-label={format("Adicionar {label}", { label: t("routing.fallbacks") })}
                className="w-full max-w-sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem disabled value={PICK}>
                  {format("Adicionar {kind}", { kind: t(ROUTING_KIND[kind]) })}
                </SelectItem>
                {available.map((target) => (
                  <SelectItem key={target.id} value={target.id}>
                    {target.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="routing-priority">Prioridade</Label>
              <Input
                aria-invalid={priorityValue === null}
                className="w-32 font-mono"
                id="routing-priority"
                inputMode="numeric"
                min={0}
                onChange={(event) => {
                  setPriority(event.target.value);
                }}
                type="number"
                value={priority}
              />
              <span className="text-muted-foreground text-[11px] leading-4">
                {t("policy.priority.hint")}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="routing-scope">Escopo</Label>
              <Select onValueChange={setScope} value={scope}>
                <SelectTrigger aria-label="Escopo" id="routing-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={projectId}>
                    {format("{scope} · {title}", {
                      scope: t("autonomy.scope.project"),
                      title: projectTitle,
                    })}
                  </SelectItem>
                  <SelectItem value={GLOBAL}>{t("autonomy.scope.global")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t("policy.conditions")}</span>
            <span className="text-muted-foreground text-[11.5px] leading-4">
              {t("policy.conditions.hint")}
            </span>
            <ConditionsEditor disabled={pending} onChange={setConditions} value={conditions} />
          </div>

          <label
            className="flex cursor-pointer items-center gap-2 text-[12.5px]"
            htmlFor="routing-enabled"
          >
            <Switch
              checked={enabled}
              disabled={pending}
              id="routing-enabled"
              onCheckedChange={setEnabled}
            />
            <span>Ligada</span>
          </label>

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
            <Button data-routing-save disabled={!valid || pending} type="submit">
              {rule === undefined ? t("routing.create.title") : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
