import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Footprints } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { useEventsStore } from "@/lib/events";
import { useGlossary } from "@/lib/glossary";
import { projectKeys } from "@/lib/projects";
import { PROPOSAL_COLOR } from "@/lib/proposal-domain";
import { proposalKeys } from "@/lib/proposals";
import { taskGraphKeys } from "@/lib/task-graph";
import { taskKeys } from "@/lib/tasks";

/**
 * O toast de proposta, em qualquer tela (Fase 5B).
 *
 * As propostas e o evento de dashboard saem na **mesma transação** do desfecho
 * do Run, então o toast nunca anuncia trabalho que o banco não tem. Aqui só
 * resta escutar: dizer quantas chegaram, com um atalho para a Campanha, onde
 * a decisão acontece, e mandar as listas relerem. Mesmo padrão do toast do
 * Selo, que mora no layout raiz pelo mesmo motivo: o resultado chega enquanto
 * o usuário está em qualquer tela.
 *
 * A decisão (`task.proposal.resolved`) não vira toast: quem decidiu está
 * olhando a proposta, e quem não decidiu vê a pendência sumir da lista. O que
 * ela faz é invalidar as mesmas queries, para o contador e o grafo baixarem.
 */

/** O payload de `task.proposed`, validado na borda como o do Selo. */
const ProposedPayloadSchema = z.object({
  projectId: z.string(),
  taskId: z.string(),
  runId: z.string(),
  count: z.number().int().nonnegative(),
  proposedTaskIds: z.array(z.string()),
});

export type ProposedPayload = z.infer<typeof ProposedPayloadSchema>;

export const TASK_PROPOSED = "task.proposed";
export const TASK_PROPOSAL_RESOLVED = "task.proposal.resolved";

const tint = (percent: number) =>
  `color-mix(in oklab, ${PROPOSAL_COLOR} ${String(percent)}%, transparent)`;

/** O anúncio em miniatura, do tamanho de um toast. */
function ProposalToast({ payload, onOpen }: { payload: ProposedPayload; onOpen: () => void }) {
  const { t, theme, format } = useGlossary();

  return (
    <div
      className="bg-card flex w-full items-start gap-3 rounded-[12px] p-3.5"
      data-proposal-toast={payload.runId}
      style={{
        border: `1px solid ${tint(55)}`,
        boxShadow: `0 0 0 1px ${tint(18)}, 0 10px 30px -12px ${tint(40)}`,
      }}
    >
      <span
        className="flex size-9 flex-none items-center justify-center rounded-full"
        style={{ border: `1px solid ${tint(40)}`, background: tint(12), color: PROPOSAL_COLOR }}
      >
        <Footprints aria-hidden className="size-4.5" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={
            theme === "dnd"
              ? "font-display text-[14.5px] leading-5 font-semibold tracking-[0.03em]"
              : "text-[14.5px] leading-5 font-semibold"
          }
        >
          {payload.count === 1
            ? t("proposal.toast.one")
            : format(t("proposal.toast.many"), { n: payload.count })}
        </span>
        <span className="text-muted-foreground text-[12.5px] leading-4.5">
          {t("proposal.toast.body")}
        </span>
        <Link
          className="text-muted-foreground hover:text-foreground mt-0.5 flex w-fit items-center gap-1 text-[11.5px] underline-offset-2 hover:underline"
          onClick={onOpen}
          params={{ id: payload.projectId }}
          to="/projects/$id"
        >
          <span>{t("proposal.toast.open")}</span>
          <ArrowRight aria-hidden className="size-3" />
        </Link>
      </div>
    </div>
  );
}

/**
 * Escuta o canal de dashboard e anuncia cada leva de propostas.
 *
 * A invalidação vale para a chegada e para a decisão: as duas mudam a caixa
 * de abertas, o contador, a Task de origem, o Project e o grafo.
 */
export function useProposalToasts(): void {
  const queryClient = useQueryClient();
  const addListener = useEventsStore((state) => state.addListener);

  useEffect(() => {
    return addListener((event) => {
      if (event.type !== TASK_PROPOSED && event.type !== TASK_PROPOSAL_RESOLVED) return;

      void queryClient.invalidateQueries({ queryKey: proposalKeys.all });
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
      void queryClient.invalidateQueries({ queryKey: taskGraphKeys.all });

      if (event.type === TASK_PROPOSAL_RESOLVED) return;

      const parsed = ProposedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) {
        console.error("[proposals] payload de proposta ilegível", event.payload);
        return;
      }

      const payload = parsed.data;
      if (payload.count === 0) return;

      toast.custom(
        (id) => (
          <ProposalToast
            onOpen={() => {
              toast.dismiss(id);
            }}
            payload={payload}
          />
        ),
        { id: payload.runId, duration: 12_000 },
      );
    });
  }, [addListener, queryClient]);
}
