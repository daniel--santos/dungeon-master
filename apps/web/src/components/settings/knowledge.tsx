import { BookOpen } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useHarnesses, useLoadouts } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";
import { useSettings } from "@/lib/settings";

/** O Radix recusa `value=""`, então "o semeado" precisa de um valor próprio. */
const DEFAULT_LOADOUT = "__default__";

/** Os limites dos schemas de `user-setting`, repetidos aqui só para o aviso antes do PUT. */
const EVERY_MIN = 1;
const EVERY_MAX = 1440;
const FORGE_MIN = 1;
const FORGE_MAX = 10_000;

interface KnowledgeForm {
  readonly humanReview: boolean;
  /** `null` é o Loadout semeado. */
  readonly loadoutId: string | null;
  readonly every: string;
  readonly forgeEvery: string;
}

function parseBounded(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= min && value <= max ? value : null;
}

/**
 * A seção "Grimório" de Settings (Fase 6B): as quatro chaves `knowledge.*` e
 * `achievements.forgeEveryNRuns`.
 *
 * Um formulário com um botão, e não quatro escritas ao vivo: as cadências são
 * números digitados, e gravar a cada tecla mandaria "1" antes de "15". Cada
 * chave vai num `PUT` próprio — a API é por chave — e só as que mudaram vão.
 *
 * O seletor de Loadout lista todos e marca os que não servem: o Distiller
 * responde JSON, então o harness precisa declarar `structuredOutput`. Um
 * Loadout sem isso fica visível e desabilitado, com o motivo, em vez de sumir
 * e deixar o usuário procurando. "O semeado" grava `null`, que é o que o
 * Worker lê como "use o Loadout semeado do Escriba"; a opção o nomeia pelo
 * glossário, e não pelo nome gravado no banco, porque o nome é dado e o
 * label é tema.
 */
export function KnowledgeSection() {
  const { t, format } = useGlossary();
  const { query, mutation } = useSettings();
  const loadouts = useLoadouts();
  const harnesses = useHarnesses();

  const settings = query.data;
  const [form, setForm] = useState<KnowledgeForm | null>(null);

  // Hidrata do servidor na primeira leitura e a cada mudança que chegar de
  // fora (outra aba), sem sobrescrever o que está sendo digitado.
  useEffect(() => {
    if (settings === undefined) return;
    setForm((current) =>
      current !== null && mutation.isPending
        ? current
        : {
            humanReview: settings["knowledge.humanReview"],
            loadoutId: settings["knowledge.loadoutId"],
            every: String(settings["knowledge.distillEveryMinutes"]),
            forgeEvery: String(settings["achievements.forgeEveryNRuns"]),
          },
    );
  }, [settings, mutation.isPending]);

  const structuredOutput = useMemo(() => {
    const byId = new Map<string, boolean>();
    for (const harness of harnesses.data?.items ?? []) {
      byId.set(harness.id, harness.capabilities.structuredOutput);
    }
    return byId;
  }, [harnesses.data]);

  if (query.isError) {
    return <p className="text-destructive text-sm">{query.error.message}</p>;
  }

  if (settings === undefined || form === null) {
    return <p className="text-muted-foreground text-sm">Lendo…</p>;
  }

  const every = parseBounded(form.every, EVERY_MIN, EVERY_MAX);
  const forgeEvery = parseBounded(form.forgeEvery, FORGE_MIN, FORGE_MAX);
  const valid = every !== null && forgeEvery !== null;

  const dirty =
    form.humanReview !== settings["knowledge.humanReview"] ||
    form.loadoutId !== settings["knowledge.loadoutId"] ||
    every !== settings["knowledge.distillEveryMinutes"] ||
    forgeEvery !== settings["achievements.forgeEveryNRuns"];

  async function save(event: FormEvent) {
    event.preventDefault();
    if (form === null || settings === undefined || every === null || forgeEvery === null) return;

    const writes: { key: keyof typeof settings; value: unknown }[] = [];
    if (form.humanReview !== settings["knowledge.humanReview"]) {
      writes.push({ key: "knowledge.humanReview", value: form.humanReview });
    }
    if (form.loadoutId !== settings["knowledge.loadoutId"]) {
      writes.push({ key: "knowledge.loadoutId", value: form.loadoutId });
    }
    if (every !== settings["knowledge.distillEveryMinutes"]) {
      writes.push({ key: "knowledge.distillEveryMinutes", value: every });
    }
    if (forgeEvery !== settings["achievements.forgeEveryNRuns"]) {
      writes.push({ key: "achievements.forgeEveryNRuns", value: forgeEvery });
    }

    try {
      // Em sequência, e não em paralelo: cada `PUT` devolve o objeto inteiro e
      // o grava no cache; dois em voo sobrescreveriam um ao outro.
      for (const write of writes) {
        await mutation.mutateAsync(write);
      }
      toast.success(t("settings.knowledge.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section
      className="bg-card border-border flex max-w-190 flex-col gap-4.5 rounded-[14px] border p-6 shadow-sm"
      data-settings-knowledge
    >
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-base font-semibold">
          <BookOpen aria-hidden className="text-muted-foreground size-4" />
          <span>{t("settings.knowledge.title")}</span>
        </span>
        <span className="text-muted-foreground text-[13px]">
          {t("settings.knowledge.description")}
        </span>
      </div>

      <Separator />

      <form
        className="flex flex-col gap-4.5"
        onSubmit={(event) => {
          void save(event);
        }}
      >
        <div className="flex items-start justify-between gap-8">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="knowledge-human-review">
              {t("settings.knowledge.humanReview")}
            </label>
            <span className="text-muted-foreground text-[13px] leading-5">
              {t("settings.knowledge.humanReview.description")}
            </span>
          </div>
          <Switch
            checked={form.humanReview}
            data-knowledge-human-review
            disabled={mutation.isPending}
            id="knowledge-human-review"
            onCheckedChange={(checked) => {
              setForm({ ...form, humanReview: checked });
            }}
          />
        </div>

        <Separator />

        <div className="flex flex-col gap-2">
          <Label className="text-sm font-medium" htmlFor="knowledge-loadout">
            {t("settings.knowledge.loadout")}
          </Label>
          <span className="text-muted-foreground text-[13px] leading-5">
            {t("settings.knowledge.loadout.description")}
          </span>
          <Select
            disabled={mutation.isPending || loadouts.isPending}
            onValueChange={(next) => {
              setForm({ ...form, loadoutId: next === DEFAULT_LOADOUT ? null : next });
            }}
            value={form.loadoutId ?? DEFAULT_LOADOUT}
          >
            <SelectTrigger
              aria-label={t("settings.knowledge.loadout")}
              className="w-full max-w-md"
              data-knowledge-loadout
              id="knowledge-loadout"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_LOADOUT}>
                {format(t("settings.knowledge.loadout.default"), {
                  name: t("knowledge.scribe"),
                })}
              </SelectItem>
              {(loadouts.data?.items ?? []).length > 0 && <SelectSeparator />}
              {(loadouts.data?.items ?? []).map((loadout) => {
                const structured = structuredOutput.get(loadout.harnessId) ?? false;
                return (
                  <SelectItem
                    data-knowledge-loadout-option={loadout.id}
                    disabled={!structured}
                    key={loadout.id}
                    value={loadout.id}
                  >
                    {structured
                      ? loadout.name
                      : `${loadout.name} · ${t("settings.knowledge.loadout.noStructuredOutput")}`}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className="grid gap-4.5 sm:grid-cols-2">
          <NumberField
            description={t("settings.knowledge.every.description")}
            id="knowledge-every"
            invalid={every === null}
            label={t("settings.knowledge.every")}
            max={EVERY_MAX}
            min={EVERY_MIN}
            onChange={(next) => {
              setForm({ ...form, every: next });
            }}
            suffix="min"
            testId="every"
            value={form.every}
          />
          <NumberField
            description={t("settings.knowledge.forgeEvery.description")}
            id="knowledge-forge-every"
            invalid={forgeEvery === null}
            label={t("settings.knowledge.forgeEvery")}
            max={FORGE_MAX}
            min={FORGE_MIN}
            onChange={(next) => {
              setForm({ ...form, forgeEvery: next });
            }}
            suffix={t("entity.run.plural")}
            testId="forge-every"
            value={form.forgeEvery}
          />
        </div>

        {mutation.isError && <p className="text-destructive text-sm">{mutation.error.message}</p>}

        <div className="flex items-center justify-end gap-2">
          <Button
            data-knowledge-save
            disabled={!dirty || !valid || mutation.isPending}
            size="sm"
            type="submit"
          >
            {mutation.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function NumberField({
  id,
  label,
  description,
  value,
  onChange,
  min,
  max,
  invalid,
  suffix,
  testId,
}: {
  id: string;
  label: string;
  description: string;
  value: string;
  onChange: (next: string) => void;
  min: number;
  max: number;
  invalid: boolean;
  suffix: string;
  testId: string;
}) {
  const { format } = useGlossary();

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium" htmlFor={id}>
        {label}
      </Label>
      <span className="text-muted-foreground text-[13px] leading-5">{description}</span>
      <div className="flex items-center gap-2">
        <Input
          aria-invalid={invalid}
          className="w-28 font-mono"
          data-knowledge-field={testId}
          id={id}
          inputMode="numeric"
          max={max}
          min={min}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          type="number"
          value={value}
        />
        <span className="text-muted-foreground text-[12.5px]">{suffix}</span>
      </div>
      {invalid && (
        <span className="text-destructive text-[12px]" data-knowledge-field-error={testId}>
          {format("Um inteiro entre {min} e {max}.", { min, max })}
        </span>
      )}
    </div>
  );
}
