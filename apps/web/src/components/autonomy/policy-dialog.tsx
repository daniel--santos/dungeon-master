import type { PolicyAction, PolicySubject } from "@dungeon-master/contracts";
import { ShieldAlert } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ConditionsEditor, conditionsValid } from "@/components/autonomy/conditions-editor";
import { tint } from "@/components/autonomy/shared";
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
import type {
  ApprovalPolicyRecord,
  ProjectAutonomyRecord,
  RuleConditionsRecord,
} from "@/lib/api-types";
import { useCreateApprovalPolicy, useUpdateApprovalPolicy } from "@/lib/autonomy";
import {
  isPolicyInert,
  POLICY_ACTION,
  POLICY_ACTIONS,
  POLICY_SUBJECT,
  POLICY_SUBJECTS,
} from "@/lib/autonomy-domain";
import { useGlossary } from "@/lib/glossary";

/** O Radix recusa `value=""`, então "global" precisa de um valor próprio. */
const GLOBAL = "__global__";

export interface PolicyDialogProps {
  /** Ausente cria; presente edita aquela política. */
  readonly policy?: ApprovalPolicyRecord;
  /** A Campanha da tela: o escopo padrão de uma política nova. */
  readonly projectId: string;
  readonly projectTitle: string;
  /** O nível atual e o que ele libera, para dizer quando a política é inerte. */
  readonly autonomy: ProjectAutonomyRecord | undefined;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * O formulário de uma política de aprovação (Fase 9C).
 *
 * Assunto, ação, prioridade, escopo e as condições fechadas. Duas frases
 * ficam sempre à vista, porque são o que decide se a política faz o que o
 * usuário imagina: sem regra que case, a decisão é revisão humana
 * (fail-closed); e uma política que aprova sozinha só vale com o nível da
 * Campanha em 3 ou acima — abaixo disso ela é inerte, e o formulário diz
 * isso enquanto se edita, não só depois de salvar.
 */
export function PolicyDialog({
  policy,
  projectId,
  projectTitle,
  autonomy,
  open,
  onOpenChange,
}: PolicyDialogProps) {
  const { t, format } = useGlossary();
  const create = useCreateApprovalPolicy();
  const update = useUpdateApprovalPolicy();

  const [name, setName] = useState("");
  const [subject, setSubject] = useState<PolicySubject>("PROPOSAL");
  const [action, setAction] = useState<PolicyAction>("REQUIRE_APPROVAL");
  const [priority, setPriority] = useState("100");
  const [scope, setScope] = useState<string>(projectId);
  const [enabled, setEnabled] = useState(true);
  const [conditions, setConditions] = useState<RuleConditionsRecord>({});

  useEffect(() => {
    if (!open) return;
    setName(policy?.name ?? "");
    setSubject(policy?.subject ?? "PROPOSAL");
    setAction(policy?.action ?? "REQUIRE_APPROVAL");
    setPriority(String(policy?.priority ?? 100));
    setScope(policy === undefined ? projectId : (policy.projectId ?? GLOBAL));
    setEnabled(policy?.enabled ?? true);
    setConditions(policy?.conditions ?? {});
  }, [open, policy, projectId]);

  const pending = create.isPending || update.isPending;
  const priorityValue = /^\d+$/.test(priority.trim()) ? Number(priority.trim()) : null;
  const valid = name.trim() !== "" && priorityValue !== null && conditionsValid(conditions);

  // A inércia é sobre a Campanha da tela: uma política global é avaliada em
  // toda Campanha, e o aviso aqui fala do nível desta.
  const inert = isPolicyInert({ action, subject }, autonomy?.allows);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || pending || priorityValue === null) return;

    const done = {
      onSuccess: () => {
        onOpenChange(false);
        toast.success(t("policy.save.done"));
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    };

    const body = {
      name: name.trim(),
      subject,
      action,
      priority: priorityValue,
      projectId: scope === GLOBAL ? null : scope,
      conditions,
      enabled,
    };

    if (policy === undefined) {
      create.mutate(body, done);
      return;
    }
    update.mutate({ id: policy.id, ...body }, done);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-[640px]">
        <form className="flex flex-col gap-4" data-policy-form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {policy === undefined ? t("policy.create.title") : t("policy.edit.title")}
            </DialogTitle>
            <DialogDescription>{t("policy.description")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="policy-name">Nome</Label>
            <Input
              autoFocus
              id="policy-name"
              maxLength={200}
              onChange={(event) => {
                setName(event.target.value);
              }}
              value={name}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="policy-subject">{t("policy.subject")}</Label>
              <Select
                onValueChange={(next) => {
                  setSubject(next as PolicySubject);
                }}
                value={subject}
              >
                <SelectTrigger aria-label={t("policy.subject")} id="policy-subject">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POLICY_SUBJECTS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {t(POLICY_SUBJECT[item])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="policy-action">{t("policy.action")}</Label>
              <Select
                onValueChange={(next) => {
                  setAction(next as PolicyAction);
                }}
                value={action}
              >
                <SelectTrigger aria-label={t("policy.action")} id="policy-action">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POLICY_ACTIONS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {t(POLICY_ACTION[item].label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {inert && (
            <div
              className="flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5"
              data-policy-inert
              style={{
                borderColor: tint("oklch(0.72 0.13 75)", 45),
                backgroundColor: tint("oklch(0.72 0.13 75)", 9),
              }}
            >
              <ShieldAlert
                aria-hidden
                className="mt-0.5 size-3.5 flex-none text-[oklch(0.72_0.13_75)]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[12.5px] font-medium">{t("policy.inert")}</span>
                <span className="text-muted-foreground text-[11.5px] leading-4.5">
                  {t("policy.inert.hint")}
                </span>
              </span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="policy-priority">Prioridade</Label>
              <Input
                aria-invalid={priorityValue === null}
                className="w-32 font-mono"
                id="policy-priority"
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
              <Label htmlFor="policy-scope">Escopo</Label>
              <Select onValueChange={setScope} value={scope}>
                <SelectTrigger aria-label="Escopo" id="policy-scope">
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

          <p className="text-muted-foreground m-0 text-[11.5px] leading-4" data-policy-fail-closed>
            {t("autonomy.failClosed")}
          </p>

          <div className="flex items-center justify-between gap-4">
            <label
              className="flex cursor-pointer items-center gap-2 text-[12.5px]"
              htmlFor="policy-enabled"
            >
              <Switch
                checked={enabled}
                disabled={pending}
                id="policy-enabled"
                onCheckedChange={setEnabled}
              />
              <span>Ligada</span>
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
            <Button data-policy-save disabled={!valid || pending} type="submit">
              {policy === undefined ? t("policy.create.title") : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
