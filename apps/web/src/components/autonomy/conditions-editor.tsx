import type { RuleConditionKey } from "@dungeon-master/contracts";

import { useConditionValueLabel } from "@/components/autonomy/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RuleConditionsRecord } from "@/lib/api-types";
import { conditionValues, RULE_CONDITION, RULE_CONDITION_KEYS } from "@/lib/autonomy-domain";
import { useLoadouts } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";
import { useProjects } from "@/lib/projects";
import { cn } from "@/lib/utils";

export interface ConditionsEditorProps {
  readonly value: RuleConditionsRecord;
  readonly onChange: (next: RuleConditionsRecord) => void;
  readonly disabled?: boolean;
}

/**
 * O editor de `RuleConditions` (Fase 9C), o mesmo para políticas e regras de
 * roteamento.
 *
 * O vocabulário é fechado, então o formulário é uma linha por condição, na
 * ordem do contrato: marcar a linha liga a condição, e o campo ao lado diz o
 * valor. Uma condição de lista aceita vários valores ("qualquer um destes");
 * os ids de Loadout e de Project são escolhidos pelo nome, nunca digitados.
 * Nada aqui casa nem decide: é só a forma do JSON que a API vai validar com
 * `strictObject`, e o que sai daqui é exatamente o que ela recebe.
 *
 * Uma lista ligada sem valor é inválida, e `conditionsValid` diz isso ao
 * botão de salvar antes de a API recusar com `400`.
 */
export function ConditionsEditor({ value, onChange, disabled = false }: ConditionsEditorProps) {
  const { t } = useGlossary();
  const label = useConditionValueLabel();
  const loadouts = useLoadouts();
  const projects = useProjects({ pageSize: 100 });

  function set(key: RuleConditionKey, next: unknown): void {
    onChange({ ...value, [key]: next } as RuleConditionsRecord);
  }

  function clear(key: RuleConditionKey): void {
    const { [key]: _removed, ...rest } = value;
    onChange(rest);
  }

  function enable(key: RuleConditionKey, on: boolean): void {
    if (!on) {
      clear(key);
      return;
    }
    switch (RULE_CONDITION[key].shape) {
      case "boolean":
        set(key, true);
        return;
      case "number":
        set(key, key === "minBudgetPressure" ? 0.8 : 50_000);
        return;
      default:
        set(key, []);
    }
  }

  function toggleValue(key: RuleConditionKey, option: string, on: boolean): void {
    const current = conditionValues(value, key);
    const next = on ? [...current, option] : current.filter((item) => item !== option);
    set(key, next);
  }

  return (
    <div className="flex flex-col gap-1" data-conditions-editor>
      {RULE_CONDITION_KEYS.map((key) => {
        const presentation = RULE_CONDITION[key];
        const enabled = value[key] !== undefined;
        const values = conditionValues(value, key);

        const options: readonly { readonly value: string; readonly label: string }[] =
          presentation.shape === "loadout"
            ? (loadouts.data?.items ?? []).map((item) => ({ value: item.id, label: item.name }))
            : presentation.shape === "project"
              ? (projects.data?.items ?? []).map((item) => ({
                  value: item.id,
                  label: item.title,
                }))
              : presentation.options.map((option) => ({
                  value: option,
                  label: label(key, option),
                }));

        const listShape =
          presentation.shape === "list" ||
          presentation.shape === "loadout" ||
          presentation.shape === "project";
        const invalid = enabled && listShape && values.length === 0;

        return (
          <div
            key={key}
            className={cn(
              "border-border flex flex-col gap-2 rounded-lg border px-3 py-2",
              !enabled && "border-transparent",
            )}
            data-condition={key}
            data-condition-enabled={enabled ? "true" : "false"}
          >
            <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px]">
              <Checkbox
                aria-label={t(presentation.label)}
                checked={enabled}
                disabled={disabled}
                onCheckedChange={(checked) => {
                  enable(key, checked === true);
                }}
              />
              <span className={enabled ? "font-medium" : "text-muted-foreground"}>
                {t(presentation.label)}
              </span>
              {listShape && enabled && (
                <span className="text-muted-foreground text-[11px]">{t("condition.any")}</span>
              )}
            </label>

            {enabled && listShape && (
              <div className="flex flex-wrap items-center gap-1.5 pl-7">
                {options.length === 0 && (
                  <span className="text-muted-foreground text-[11.5px]">—</span>
                )}
                {options.map((option) => {
                  const on = values.includes(option.value);
                  return (
                    <label
                      key={option.value}
                      className={cn(
                        "border-border inline-flex h-[24px] cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-xs",
                        on ? "bg-white/[0.08]" : "text-muted-foreground",
                      )}
                      data-condition-option={option.value}
                      data-condition-option-on={on ? "true" : "false"}
                    >
                      <Checkbox
                        checked={on}
                        className="size-3.5"
                        disabled={disabled}
                        onCheckedChange={(checked) => {
                          toggleValue(key, option.value, checked === true);
                        }}
                      />
                      <span>{option.label}</span>
                    </label>
                  );
                })}
                {invalid && (
                  <span className="text-destructive text-[11px]" data-condition-invalid={key}>
                    Escolha pelo menos um.
                  </span>
                )}
              </div>
            )}

            {enabled && presentation.shape === "boolean" && (
              <div className="pl-7">
                <Select
                  disabled={disabled}
                  onValueChange={(next) => {
                    set(key, next === "true");
                  }}
                  value={value[key] === true ? "true" : "false"}
                >
                  <SelectTrigger aria-label={t(presentation.label)} className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">{label(key, "true")}</SelectItem>
                    <SelectItem value="false">{label(key, "false")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {enabled && presentation.shape === "number" && (
              <div className="flex items-center gap-2 pl-7">
                <Input
                  aria-label={t(presentation.label)}
                  className="w-32 font-mono"
                  disabled={disabled}
                  inputMode="decimal"
                  min={key === "minBudgetPressure" ? 0 : 1}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    set(key, Number.isFinite(parsed) ? parsed : 0);
                  }}
                  step={key === "minBudgetPressure" ? 0.05 : 1}
                  type="number"
                  value={String(value[key] ?? "")}
                />
                <span className="text-muted-foreground text-[11px]">
                  {key === "minBudgetPressure" ? "0.8 = 80% de algum teto" : "tokens"}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * `true` quando toda condição ligada tem um valor que a API aceita: uma lista
 * com pelo menos um item, um inteiro positivo em `maxEstimatedTokens`, um
 * número não negativo em `minBudgetPressure`.
 */
export function conditionsValid(conditions: RuleConditionsRecord): boolean {
  for (const key of RULE_CONDITION_KEYS) {
    const raw = conditions[key];
    if (raw === undefined) continue;
    const shape = RULE_CONDITION[key].shape;
    if (shape === "list" || shape === "loadout" || shape === "project") {
      if (conditionValues(conditions, key).length === 0) return false;
    } else if (key === "maxEstimatedTokens") {
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) return false;
    } else if (key === "minBudgetPressure") {
      if (typeof raw !== "number" || raw < 0) return false;
    }
  }
  return true;
}
