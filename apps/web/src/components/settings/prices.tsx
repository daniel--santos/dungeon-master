import { Coins } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ModelPriceDialog } from "@/components/settings/model-price-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BillingKindRecord, ModelRecord, ProviderRecord } from "@/lib/api-types";
import { formatDate } from "@/lib/datetime";
import { useModels } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";
import { useModelPrices } from "@/lib/metrics";
import { BILLING_KIND, BILLING_KINDS } from "@/lib/metrics-domain";
import { useProviders, useUpdateProvider } from "@/lib/registry";

/**
 * A seção "Preços" de Settings (planejamento v0.4, Fase 10B).
 *
 * Duas tabelas, porque são duas perguntas diferentes. A de cima é "quanto
 * custa um token deste Model", e a resposta é uma vigência — append-only, com
 * data de início, para o custo de março não mudar sozinho num reajuste de
 * abril. A de baixo é "como este Provider cobra", e a resposta muda o **tipo**
 * do número: por token o custo é uma conta; por assinatura é a mensalidade
 * rateada pela fatia de tokens do mês, que é estimativa e sai rotulada assim.
 *
 * Um Model sem preço não é um Model de graça. Ele aparece com "sem preço", e
 * o custo dele na Torre de Vigia continua `NOT_MEASURED` até alguém cadastrar
 * a vigência — que é exatamente o que este bloco existe para permitir.
 */

/** O radix recusa `value=""`, então "desconhecido" precisa de um valor próprio. */
const UNKNOWN = "__unknown__";

export function PricesSection() {
  const { t } = useGlossary();
  const models = useModels();
  const prices = useModelPrices();
  const [editing, setEditing] = useState<ModelRecord | null>(null);

  const byModel = new Map((prices.data?.items ?? []).map((price) => [price.modelId, price]));

  return (
    <section
      className="bg-card border-border flex flex-col gap-4.5 rounded-xl border p-6 shadow-sm"
      data-settings-prices
    >
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-base font-semibold">
          <Coins aria-hidden className="size-4" />
          <span>{t("settings.prices.title")}</span>
        </span>
        <span className="text-muted-foreground text-[13px]">
          {t("settings.prices.description")}
        </span>
      </div>

      <Separator />

      {models.isError && <p className="text-destructive text-sm">{models.error.message}</p>}
      {models.isPending && <p className="text-muted-foreground text-sm">Lendo…</p>}

      {models.data !== undefined && models.data.items.length === 0 && (
        <p className="text-muted-foreground text-[13px]">{t("settings.prices.empty")}</p>
      )}

      {models.data !== undefined && models.data.items.length > 0 && (
        <div className="overflow-x-auto">
          <Table data-model-prices={models.data.items.length}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("settings.prices.model")}</TableHead>
                <TableHead>{t("settings.prices.currency")}</TableHead>
                <TableHead className="text-right">{t("settings.prices.input")}</TableHead>
                <TableHead className="text-right">{t("settings.prices.output")}</TableHead>
                <TableHead className="text-right">{t("settings.prices.cacheRead")}</TableHead>
                <TableHead className="text-right">{t("settings.prices.cacheWrite")}</TableHead>
                <TableHead>{t("settings.prices.effectiveFrom")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.data.items.map((model) => {
                const price = byModel.get(model.id);

                return (
                  <TableRow data-model-price-row={model.id} key={model.id}>
                    <TableCell className="font-medium">
                      <span className="flex flex-col">
                        <span>{model.name}</span>
                        <span className="text-muted-foreground font-mono text-[10.5px]">
                          {model.key}
                        </span>
                      </span>
                    </TableCell>
                    {price === undefined ? (
                      <TableCell className="text-muted-foreground" colSpan={6}>
                        {t("settings.prices.none")}
                      </TableCell>
                    ) : (
                      <>
                        <TableCell>{price.currency}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {price.inputPerMillion}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {price.outputPerMillion}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {price.cacheReadPerMillion}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {price.cacheWritePerMillion}
                        </TableCell>
                        <TableCell>{formatDate(price.effectiveFrom)}</TableCell>
                      </>
                    )}
                    <TableCell className="text-right">
                      <Button
                        data-model-price-open={model.id}
                        onClick={() => {
                          setEditing(model);
                        }}
                        size="xs"
                        variant="outline"
                      >
                        {t("settings.prices.open")}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Separator />

      <ProviderBilling />

      <ModelPriceDialog
        model={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        open={editing !== null}
      />
    </section>
  );
}

/**
 * Como cada Provider fatura.
 *
 * A mensalidade só é aceita em `SUBSCRIPTION`, e o banco tem um `CHECK` que
 * garante isso — a tela desabilita o campo em vez de deixar alguém digitar um
 * número que a API vai recusar. Trocar para `PER_TOKEN` limpa a mensalidade
 * junto, pela mesma razão.
 */
function ProviderBilling() {
  const { t } = useGlossary();
  const providers = useProviders();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("settings.prices.providers")}</span>
        <span className="text-muted-foreground text-[13px]">
          {t("settings.prices.providers.description")}
        </span>
        <span className="text-muted-foreground text-[12px]">
          {t("provider.billing.estimateNote")}
        </span>
      </div>

      {providers.isError && <p className="text-destructive text-sm">{providers.error.message}</p>}
      {providers.isPending && <p className="text-muted-foreground text-sm">Lendo…</p>}

      {providers.data !== undefined && providers.data.items.length === 0 && (
        <p className="text-muted-foreground text-[13px]">{t("settings.prices.providers.empty")}</p>
      )}

      {providers.data !== undefined && providers.data.items.length > 0 && (
        <div className="overflow-x-auto">
          <Table data-provider-billing={providers.data.items.length}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("entity.provider")}</TableHead>
                <TableHead>{t("provider.billing.kind")}</TableHead>
                <TableHead>{t("provider.billing.monthlyCost")}</TableHead>
                <TableHead>{t("provider.billing.currency")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.data.items.map((provider) => (
                <ProviderRow key={provider.id} provider={provider} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ProviderRow({ provider }: { readonly provider: ProviderRecord }) {
  const { t, format } = useGlossary();
  const update = useUpdateProvider();

  const [kind, setKind] = useState<BillingKindRecord | null>(provider.billingKind);
  const [monthlyCost, setMonthlyCost] = useState(
    provider.monthlyCost === null ? "" : String(provider.monthlyCost),
  );
  const [currency, setCurrency] = useState(provider.currency ?? "");

  const subscription = kind === "SUBSCRIPTION";
  const amount = monthlyCost.trim() === "" ? null : Number(monthlyCost.trim().replace(",", "."));
  const amountOk = amount === null || (Number.isFinite(amount) && amount >= 0);
  const currencyOk = amount === null ? true : /^[A-Za-z]{3}$/.test(currency.trim());

  const dirty =
    kind !== provider.billingKind ||
    (amount ?? null) !== provider.monthlyCost ||
    (currency.trim() === "" ? null : currency.trim().toUpperCase()) !== provider.currency;

  function save() {
    if (!amountOk || !currencyOk || update.isPending) return;

    update.mutate(
      {
        id: provider.id,
        billingKind: kind,
        // Sem assinatura não há mensalidade: mandar os dois nulos é o que o
        // `CHECK` do banco exige, e o que devolve o Provider ao estado "por
        // token" sem deixar uma moeda órfã para trás.
        monthlyCost: subscription ? amount : null,
        currency: subscription && amount !== null ? currency.trim().toUpperCase() : null,
      },
      {
        onSuccess: () => {
          toast.success(format(t("settings.prices.savedProvider"), { provider: provider.name }));
        },
        onError: (error: Error) => {
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <TableRow data-provider-billing-row={provider.id}>
      <TableCell className="font-medium">{provider.name}</TableCell>
      <TableCell>
        <Select
          onValueChange={(next) => {
            setKind(next === UNKNOWN ? null : (next as BillingKindRecord));
          }}
          value={kind ?? UNKNOWN}
        >
          <SelectTrigger
            aria-label={t("provider.billing.kind")}
            className="w-40"
            data-provider-billing-kind={provider.id}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNKNOWN}>{t("provider.billing.unknown")}</SelectItem>
            {BILLING_KINDS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(BILLING_KIND[value])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input
          aria-invalid={!amountOk}
          aria-label={t("provider.billing.monthlyCost")}
          className="w-28"
          data-provider-monthly-cost={provider.id}
          disabled={!subscription}
          onChange={(event) => {
            setMonthlyCost(event.target.value);
          }}
          value={subscription ? monthlyCost : ""}
        />
      </TableCell>
      <TableCell>
        <Input
          aria-invalid={!currencyOk}
          aria-label={t("provider.billing.currency")}
          className="w-20"
          data-provider-currency={provider.id}
          disabled={!subscription}
          onChange={(event) => {
            setCurrency(event.target.value);
          }}
          value={subscription ? currency : ""}
        />
      </TableCell>
      <TableCell className="text-right">
        <Button
          data-provider-billing-save={provider.id}
          disabled={!dirty || !amountOk || !currencyOk || update.isPending}
          onClick={save}
          size="xs"
          variant="outline"
        >
          {update.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </TableCell>
    </TableRow>
  );
}
