import { Backpack } from "lucide-react";
import { useMemo, type FormEvent } from "react";
import { toast } from "sonner";

import { NumberField } from "@/components/settings/number-field";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { CONTEXT_COLOR } from "@/lib/context";
import { useGlossary } from "@/lib/glossary";
import { useHydratedForm } from "@/lib/hydrated-form";
import { useSettings } from "@/lib/settings";

/**
 * Os limites das chaves `context.*`, repetidos aqui só para o aviso antes do PUT.
 *
 * O schema de `user-setting` aceita orçamento a partir de 500; a tela pede
 * 1000 porque abaixo disso a moldura e o piso do resumo consomem quase tudo
 * e o bloco não diz nada. Os tetos aceitam `0`, que desliga a seção: é um
 * valor com sentido, e a tela não o esconde.
 */
const BUDGET_MIN = 1000;
const BUDGET_MAX = 200_000;
const KNOWLEDGE_ITEMS_MIN = 0;
const KNOWLEDGE_ITEMS_MAX = 50;
const DECISIONS_MIN = 0;
const DECISIONS_MAX = 50;
const ARTIFACTS_MIN = 0;
const ARTIFACTS_MAX = 100;

interface ContextForm {
  readonly enabled: boolean;
  readonly budgetTokens: string;
  readonly maxKnowledgeItems: string;
  readonly maxDecisions: string;
  readonly maxArtifacts: string;
}

function parseBounded(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= min && value <= max ? value : null;
}

/**
 * A seção "Provisões" de Settings (Fase 7C): as cinco chaves `context.*`.
 *
 * Mesmo desenho do bloco do Grimório: um formulário com um botão, cada chave
 * num `PUT` próprio, e só as que mudaram vão. O interruptor desliga o Context
 * Engine inteiro; os quatro números são o orçamento total e os tetos por
 * seção. O Loadout pode apertar cada um deles, nunca afrouxar: a política
 * efetiva de um Run é o menor dos dois, e o cockpit mostra qual valeu.
 */
export function ContextSection() {
  const { t } = useGlossary();
  const { query, mutation } = useSettings();

  const settings = query.data;

  // post-mortem #15 (08/09/2026): a hidratação era um efeito guardado por
  // `mutation.isPending`, e cada `useSettings()` cria a sua mutação — salvar
  // no bloco do Grimório (ou qualquer releitura de `settings`) reescrevia os
  // cinco campos daqui por cima do que estava sendo digitado. Agora a decisão
  // é do `useHydratedForm`: edição pendente ganha da releitura.
  const server = useMemo<ContextForm | undefined>(
    () =>
      settings === undefined
        ? undefined
        : {
            enabled: settings["context.enabled"],
            budgetTokens: String(settings["context.budgetTokens"]),
            maxKnowledgeItems: String(settings["context.maxKnowledgeItems"]),
            maxDecisions: String(settings["context.maxDecisions"]),
            maxArtifacts: String(settings["context.maxArtifacts"]),
          },
    [settings],
  );
  const { value: form, set: setForm } = useHydratedForm(server);

  if (query.isError) {
    return <p className="text-destructive text-sm">{query.error.message}</p>;
  }

  if (settings === undefined || form === null) {
    return <p className="text-muted-foreground text-sm">Lendo…</p>;
  }

  const budgetTokens = parseBounded(form.budgetTokens, BUDGET_MIN, BUDGET_MAX);
  const maxKnowledgeItems = parseBounded(
    form.maxKnowledgeItems,
    KNOWLEDGE_ITEMS_MIN,
    KNOWLEDGE_ITEMS_MAX,
  );
  const maxDecisions = parseBounded(form.maxDecisions, DECISIONS_MIN, DECISIONS_MAX);
  const maxArtifacts = parseBounded(form.maxArtifacts, ARTIFACTS_MIN, ARTIFACTS_MAX);
  const valid =
    budgetTokens !== null &&
    maxKnowledgeItems !== null &&
    maxDecisions !== null &&
    maxArtifacts !== null;

  const dirty =
    form.enabled !== settings["context.enabled"] ||
    budgetTokens !== settings["context.budgetTokens"] ||
    maxKnowledgeItems !== settings["context.maxKnowledgeItems"] ||
    maxDecisions !== settings["context.maxDecisions"] ||
    maxArtifacts !== settings["context.maxArtifacts"];

  async function save(event: FormEvent) {
    event.preventDefault();
    if (
      form === null ||
      settings === undefined ||
      budgetTokens === null ||
      maxKnowledgeItems === null ||
      maxDecisions === null ||
      maxArtifacts === null
    ) {
      return;
    }

    const writes: { key: keyof typeof settings; value: unknown }[] = [];
    if (form.enabled !== settings["context.enabled"]) {
      writes.push({ key: "context.enabled", value: form.enabled });
    }
    if (budgetTokens !== settings["context.budgetTokens"]) {
      writes.push({ key: "context.budgetTokens", value: budgetTokens });
    }
    if (maxKnowledgeItems !== settings["context.maxKnowledgeItems"]) {
      writes.push({ key: "context.maxKnowledgeItems", value: maxKnowledgeItems });
    }
    if (maxDecisions !== settings["context.maxDecisions"]) {
      writes.push({ key: "context.maxDecisions", value: maxDecisions });
    }
    if (maxArtifacts !== settings["context.maxArtifacts"]) {
      writes.push({ key: "context.maxArtifacts", value: maxArtifacts });
    }

    try {
      // Em sequência, e não em paralelo: cada `PUT` devolve o objeto inteiro e
      // o grava no cache; dois em voo sobrescreveriam um ao outro.
      for (const write of writes) {
        await mutation.mutateAsync(write);
      }
      toast.success(t("settings.context.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section
      className="bg-card border-border flex max-w-190 flex-col gap-4.5 rounded-[14px] border p-6 shadow-sm"
      data-settings-context
    >
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-base font-semibold">
          <Backpack aria-hidden className="size-4" style={{ color: CONTEXT_COLOR }} />
          <span>{t("settings.context.title")}</span>
        </span>
        <span className="text-muted-foreground text-[13px]">
          {t("settings.context.description")}
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
            <label className="text-sm font-medium" htmlFor="context-enabled">
              {t("settings.context.enabled")}
            </label>
            <span className="text-muted-foreground text-[13px] leading-5">
              {t("settings.context.enabled.description")}
            </span>
          </div>
          <Switch
            checked={form.enabled}
            data-context-enabled
            disabled={mutation.isPending}
            id="context-enabled"
            onCheckedChange={(checked) => {
              setForm({ ...form, enabled: checked });
            }}
          />
        </div>

        <Separator />

        <div className="grid gap-4.5 sm:grid-cols-2">
          <NumberField
            description={t("settings.context.budgetTokens.description")}
            id="context-budget-tokens"
            invalid={budgetTokens === null}
            label={t("settings.context.budgetTokens")}
            max={BUDGET_MAX}
            min={BUDGET_MIN}
            onChange={(next) => {
              setForm({ ...form, budgetTokens: next });
            }}
            prefix="context"
            suffix="tokens"
            testId="budget-tokens"
            value={form.budgetTokens}
          />
          <NumberField
            description={t("settings.context.maxKnowledgeItems.description")}
            id="context-max-knowledge-items"
            invalid={maxKnowledgeItems === null}
            label={t("settings.context.maxKnowledgeItems")}
            max={KNOWLEDGE_ITEMS_MAX}
            min={KNOWLEDGE_ITEMS_MIN}
            onChange={(next) => {
              setForm({ ...form, maxKnowledgeItems: next });
            }}
            prefix="context"
            suffix={t("entity.knowledgeItem.plural").toLowerCase()}
            testId="max-knowledge-items"
            value={form.maxKnowledgeItems}
          />
          <NumberField
            description={t("settings.context.maxDecisions.description")}
            id="context-max-decisions"
            invalid={maxDecisions === null}
            label={t("settings.context.maxDecisions")}
            max={DECISIONS_MAX}
            min={DECISIONS_MIN}
            onChange={(next) => {
              setForm({ ...form, maxDecisions: next });
            }}
            prefix="context"
            suffix={t("entity.decision.plural").toLowerCase()}
            testId="max-decisions"
            value={form.maxDecisions}
          />
          <NumberField
            description={t("settings.context.maxArtifacts.description")}
            id="context-max-artifacts"
            invalid={maxArtifacts === null}
            label={t("settings.context.maxArtifacts")}
            max={ARTIFACTS_MAX}
            min={ARTIFACTS_MIN}
            onChange={(next) => {
              setForm({ ...form, maxArtifacts: next });
            }}
            prefix="context"
            suffix={t("entity.artifact.plural").toLowerCase()}
            testId="max-artifacts"
            value={form.maxArtifacts}
          />
        </div>

        {mutation.isError && <p className="text-destructive text-sm">{mutation.error.message}</p>}

        <div className="flex items-center justify-end gap-2">
          <Button
            data-context-save
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
