import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ShieldHalf } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { approvalKeys } from "@/lib/approvals";
import { useEventsStore } from "@/lib/events";
import { useGlossary } from "@/lib/glossary";
import { runKeys } from "@/lib/runs";

/**
 * O toast do Selo, em qualquer tela (Fase 4C).
 *
 * O gate e o evento de dashboard saem na **mesma transação** do servidor, então
 * o toast nunca anuncia um pedido que o banco não tem. Aqui só resta escutar:
 * mostrar o pedido com um atalho para o cockpit e mandar as pendências e o Run
 * relerem. Mesmo padrão do toast de Conquista, que mora no layout raiz pelo
 * mesmo motivo — o pedido chega enquanto o usuário está em qualquer tela.
 *
 * A decisão (`approval.resolved`) não vira toast: quem decidiu está olhando
 * a carta, e quem não decidiu vê a pendência sumir da lista. O que ela faz é
 * derrubar o toast do pedido, se ainda estiver de pé, para não convidar a uma
 * decisão que já foi tomada.
 */

/** O payload de `approval.requested`, validado na borda como o de Conquista. */
const RequestedPayloadSchema = z.object({
  runId: z.string(),
  taskId: z.string(),
  gateId: z.string(),
  gateKey: z.string(),
  title: z.string(),
});

export type ApprovalRequestedPayload = z.infer<typeof RequestedPayloadSchema>;

const ResolvedPayloadSchema = z.object({ gateId: z.string() });

export const APPROVAL_REQUESTED = "approval.requested";
export const APPROVAL_RESOLVED = "approval.resolved";

const AMBER = "var(--accent-amber)";

const tint = (percent: number) => `color-mix(in oklab, ${AMBER} ${String(percent)}%, transparent)`;

/** A carta do pedido em miniatura, do tamanho de um toast. */
function ApprovalToast({
  payload,
  onOpen,
}: {
  payload: ApprovalRequestedPayload;
  onOpen: () => void;
}) {
  const { t, theme, format } = useGlossary();

  return (
    <div
      className="bg-card flex w-full items-start gap-3 rounded-[12px] p-3.5"
      data-approval-toast={payload.gateId}
      style={{
        border: `1px solid ${tint(55)}`,
        boxShadow: `0 0 0 1px ${tint(18)}, 0 10px 30px -12px ${tint(40)}`,
      }}
    >
      <span
        className="flex size-9 flex-none items-center justify-center rounded-full"
        style={{ border: `1px solid ${tint(40)}`, background: tint(12), color: AMBER }}
      >
        <ShieldHalf aria-hidden className="size-4.5" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={
            theme === "dnd"
              ? "font-display text-[14.5px] leading-5 font-semibold tracking-[0.03em]"
              : "text-[14.5px] leading-5 font-semibold"
          }
        >
          {t("approval.toast.title")}
        </span>
        <span className="text-[12.5px] leading-4.5">{payload.title}</span>
        <Link
          className="text-muted-foreground hover:text-foreground mt-0.5 flex w-fit items-center gap-1 text-[11.5px] underline-offset-2 hover:underline"
          onClick={onOpen}
          params={{ id: payload.runId }}
          to="/runs/$id"
        >
          <span>{format("Abrir o {cockpit}", { cockpit: t("run.cockpit") })}</span>
          <ArrowRight aria-hidden className="size-3" />
        </Link>
      </div>
    </div>
  );
}

/**
 * Escuta o canal de dashboard e anuncia cada pedido de Selo.
 *
 * A invalidação vale para o pedido e para a decisão: os dois mudam a caixa
 * de pendentes, o estado do Run e os steps dele.
 */
export function useApprovalToasts(): void {
  const queryClient = useQueryClient();
  const addListener = useEventsStore((state) => state.addListener);

  useEffect(() => {
    return addListener((event) => {
      if (event.type !== APPROVAL_REQUESTED && event.type !== APPROVAL_RESOLVED) return;

      void queryClient.invalidateQueries({ queryKey: approvalKeys.all });
      void queryClient.invalidateQueries({ queryKey: runKeys.all });

      if (event.type === APPROVAL_RESOLVED) {
        const resolved = ResolvedPayloadSchema.safeParse(event.payload);
        if (resolved.success) toast.dismiss(resolved.data.gateId);
        return;
      }

      const parsed = RequestedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) {
        console.error("[approvals] payload de pedido ilegível", event.payload);
        return;
      }

      const payload = parsed.data;
      toast.custom(
        (id) => (
          <ApprovalToast
            onOpen={() => {
              toast.dismiss(id);
            }}
            payload={payload}
          />
        ),
        { id: payload.gateId, duration: 12_000 },
      );
    });
  }, [addListener, queryClient]);
}
