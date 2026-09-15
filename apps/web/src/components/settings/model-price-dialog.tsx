import { Coins } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ModelPriceRecord, ModelRecord } from "@/lib/api-types";
import { formatUtcDateTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { useModelPriceHistory, useSetModelPrice } from "@/lib/metrics";

/**
 * A vigência nova de preço de um Model, e o histórico dele (Fase 10B).
 *
 * O histórico é append-only: gravar fecha a vigência corrente e abre outra.
 * Nada é sobrescrito, e é por isso que o diálogo mostra o histórico ao lado do
 * formulário — sem ele, "abrir uma vigência" pareceria edição, e alguém
 * cadastraria um reajuste de abril esperando que março ficasse como estava.
 *
 * Os quatro preços são por **1 milhão de tokens**, na moeda declarada. Leitura
 * e escrita de cache aceitam vazio e valem zero: um Model sem cache não deve
 * exigir que alguém digite dois zeros para cadastrar o preço dele.
 */

export interface ModelPriceDialogProps {
  readonly model: ModelRecord | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const DECIMAL = /^\d+([.,]\d+)?$/;

/** Aceita vírgula ou ponto: o usuário digita no teclado dele, não no do JSON. */
function parseAmount(text: string, optional = false): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return optional ? 0 : null;
  if (!DECIMAL.test(trimmed)) return null;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) && value >= 0 && value <= 1_000_000 ? value : null;
}

/**
 * O começo da vigência, do campo de data para o instante ISO que o contrato
 * pede. Vazio é "agora", que é o padrão da API.
 *
 * Meia-noite **UTC**, e não do fuso do browser: o custo de um Run usa a
 * vigência da data dele, e as datas do domínio — o `day` do rollup, a janela
 * das métricas — são todas UTC. Uma vigência que começasse às 3h da manhã UTC
 * porque quem digitou mora em São Paulo deixaria os Runs daquela madrugada de
 * fora, sem que ninguém entendesse por quê.
 *
 * `null` é data malformada; `""` é campo vazio.
 */
function parseEffectiveFrom(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const at = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export function ModelPriceDialog({ model, open, onOpenChange }: ModelPriceDialogProps) {
  const { t, format } = useGlossary();
  const setPrice = useSetModelPrice();
  const history = useModelPriceHistory(open && model !== null ? model.id : null);

  const [currency, setCurrency] = useState("USD");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [cacheRead, setCacheRead] = useState("");
  const [cacheWrite, setCacheWrite] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setCurrency("USD");
    setInput("");
    setOutput("");
    setCacheRead("");
    setCacheWrite("");
    setEffectiveFrom("");
    setNote("");
  }, [open, model]);

  const parsed = {
    input: parseAmount(input),
    output: parseAmount(output),
    cacheRead: parseAmount(cacheRead, true),
    cacheWrite: parseAmount(cacheWrite, true),
  };
  const currencyOk = /^[A-Za-z]{3}$/.test(currency.trim());
  const desde = parseEffectiveFrom(effectiveFrom);
  const valid =
    desde !== null &&
    currencyOk &&
    parsed.input !== null &&
    parsed.output !== null &&
    parsed.cacheRead !== null &&
    parsed.cacheWrite !== null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (model === null || !valid || setPrice.isPending) return;

    setPrice.mutate(
      {
        modelId: model.id,
        currency: currency.trim().toUpperCase(),
        inputPerMillion: parsed.input ?? 0,
        outputPerMillion: parsed.output ?? 0,
        cacheReadPerMillion: parsed.cacheRead ?? 0,
        cacheWritePerMillion: parsed.cacheWrite ?? 0,
        ...(desde === "" ? {} : { effectiveFrom: desde }),
        ...(note.trim() === "" ? {} : { note: note.trim() }),
      },
      {
        onSuccess: () => {
          toast.success(format(t("settings.prices.saved"), { model: model.name }));
          onOpenChange(false);
        },
        onError: (error: Error) => {
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-2xl" data-model-price-dialog>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins aria-hidden className="size-4" />
              <span>{format(t("settings.prices.openTitle"), { model: model?.name ?? "" })}</span>
            </DialogTitle>
            <DialogDescription>{t("settings.prices.perMillion")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id="model-price-currency"
              invalid={!currencyOk}
              label={t("settings.prices.currency")}
              onChange={setCurrency}
              testId="currency"
              value={currency}
            />
            <Field
              id="model-price-input"
              invalid={parsed.input === null}
              label={t("settings.prices.input")}
              onChange={setInput}
              testId="input"
              value={input}
            />
            <Field
              id="model-price-output"
              invalid={parsed.output === null}
              label={t("settings.prices.output")}
              onChange={setOutput}
              testId="output"
              value={output}
            />
            <Field
              id="model-price-cache-read"
              invalid={parsed.cacheRead === null}
              label={t("settings.prices.cacheRead")}
              onChange={setCacheRead}
              testId="cache-read"
              value={cacheRead}
            />
            <Field
              id="model-price-cache-write"
              invalid={parsed.cacheWrite === null}
              label={t("settings.prices.cacheWrite")}
              onChange={setCacheWrite}
              testId="cache-write"
              value={cacheWrite}
            />
            <Field
              id="model-price-effective-from"
              invalid={desde === null}
              label={t("settings.prices.effectiveFrom")}
              onChange={setEffectiveFrom}
              testId="effective-from"
              type="date"
              value={effectiveFrom}
            />
            <Field
              id="model-price-note"
              invalid={false}
              label={t("settings.prices.note")}
              onChange={setNote}
              testId="note"
              value={note}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">
              {format(t("settings.prices.history"), { model: model?.name ?? "" })}
            </span>
            <PriceHistory items={history.data?.items ?? []} pending={history.isPending} />
          </div>

          {setPrice.isError && <p className="text-destructive text-sm">{setPrice.error.message}</p>}

          <DialogFooter>
            <Button
              onClick={() => {
                onOpenChange(false);
              }}
              type="button"
              variant="ghost"
            >
              Cancelar
            </Button>
            <Button data-model-price-save disabled={!valid || setPrice.isPending} type="submit">
              {setPrice.isPending ? "Salvando…" : t("settings.prices.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PriceHistory({
  items,
  pending,
}: {
  readonly items: readonly ModelPriceRecord[];
  readonly pending: boolean;
}) {
  const { t } = useGlossary();

  if (pending) return <p className="text-muted-foreground text-sm">Lendo…</p>;
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-[12.5px]">{t("settings.prices.history.empty")}</p>
    );
  }

  return (
    <div className="max-h-48 overflow-auto">
      <Table data-model-price-history={items.length}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("settings.prices.effectiveFrom")}</TableHead>
            <TableHead>{t("settings.prices.currency")}</TableHead>
            <TableHead className="text-right">{t("settings.prices.input")}</TableHead>
            <TableHead className="text-right">{t("settings.prices.output")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((price) => (
            <TableRow key={price.id}>
              <TableCell>
                <span className="flex flex-col">
                  <span>{formatUtcDateTime(price.effectiveFrom)}</span>
                  {price.effectiveTo === null && (
                    <span className="text-muted-foreground text-[10.5px]">
                      {t("settings.prices.history.current")}
                    </span>
                  )}
                </span>
              </TableCell>
              <TableCell>{price.currency}</TableCell>
              <TableCell className="text-right tabular-nums">{price.inputPerMillion}</TableCell>
              <TableCell className="text-right tabular-nums">{price.outputPerMillion}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  invalid,
  testId,
  type = "text",
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly invalid: boolean;
  readonly testId: string;
  readonly type?: "text" | "date";
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        aria-invalid={invalid}
        data-model-price-field={testId}
        id={id}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        type={type}
        value={value}
      />
    </div>
  );
}
