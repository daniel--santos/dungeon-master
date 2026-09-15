import type { MoneyRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { COST_STATUS, formatMoney } from "@/lib/metrics-domain";
import { cn } from "@/lib/utils";

/**
 * Um custo com a procedência ao lado, e o único lugar do produto que o desenha.
 *
 * A regra da Fase 10A é de contrato, mas quem a sustenta na tela é este
 * componente: um `amount` nulo **nunca** vira zero, vira o rótulo do status.
 * Zero somado fecharia a conta e estaria errado para baixo sem nenhum sinal, e
 * é justamente o erro que esta fase existe para não cometer.
 *
 * O status acompanha sempre, inclusive em `PRICED`: sem ele o número de uma
 * assinatura rateada seria indistinguível de uma fatura, e a diferença entre os
 * dois é a diferença entre uma conta e uma estimativa.
 */

export interface MoneyValueProps {
  readonly money: MoneyRecord;
  readonly size?: "lg" | "md" | "sm";
  readonly className?: string;
}

const SIZE = {
  lg: { amount: "text-[26px] leading-8 font-semibold", status: "text-[11.5px]" },
  md: { amount: "text-sm font-medium", status: "text-[11px]" },
  sm: { amount: "text-[12.5px]", status: "text-[10.5px]" },
} as const;

export function MoneyValue({ money, size = "md", className }: MoneyValueProps) {
  const { t } = useGlossary();
  const s = SIZE[size];
  const amount = formatMoney(money);

  return (
    <span
      className={cn("flex flex-col items-start gap-0.5", className)}
      data-cost-status={money.status}
      data-cost-currency={money.currency ?? ""}
    >
      <span className={cn(s.amount, amount === null && "text-muted-foreground")}>
        {amount ?? "—"}
      </span>
      <span className={cn("text-muted-foreground", s.status)}>{t(COST_STATUS[money.status])}</span>
    </span>
  );
}

export interface MoneyListProps {
  /** Uma entrada por moeda. Moedas diferentes nunca se somam. */
  readonly costs: readonly MoneyRecord[];
  readonly notMeasuredRuns: number;
  readonly size?: MoneyValueProps["size"];
}

/**
 * A lista de custos de uma janela, uma linha por moeda.
 *
 * Sem nenhuma entrada, a tela diz que nada foi precificado — e não que custou
 * zero. A contagem de Runs sem custo medido vem embaixo em qualquer dos casos:
 * ela é o que impede alguém de ler o total como se fosse o gasto inteiro.
 */
export function MoneyList({ costs, notMeasuredRuns, size = "md" }: MoneyListProps) {
  const { t, format } = useGlossary();

  return (
    <div className="flex flex-col gap-1.5" data-cost-list={costs.length}>
      {costs.length === 0 ? (
        <span className="text-muted-foreground text-[13px]">{t("metrics.cost.nothingPriced")}</span>
      ) : (
        costs.map((money) => (
          <MoneyValue key={`${money.currency ?? "-"}:${money.status}`} money={money} size={size} />
        ))
      )}
      {notMeasuredRuns > 0 && (
        <span className="text-muted-foreground text-[11.5px]" data-cost-not-measured>
          {format(t("metrics.cost.notMeasuredRuns"), { n: notMeasuredRuns })}
        </span>
      )}
    </div>
  );
}
