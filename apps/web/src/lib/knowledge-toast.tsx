import { Link } from "@tanstack/react-router";
import { ArrowRight, Feather } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { useEventsStore } from "@/lib/events";
import { useGlossary } from "@/lib/glossary";
import { KNOWLEDGE_COLOR } from "@/lib/knowledge-domain";

/**
 * O toast de lote destilado, em qualquer tela (Fase 6B).
 *
 * O lote grava as decisões sobre os candidatos e o evento `knowledge.distilled`
 * na mesma transação, com as contagens. O toast diz o que saiu e leva ao
 * Grimório da Campanha, onde a fila de revisão espera quando a revisão humana
 * está ligada. A releitura das queries mora em `useLiveQueries`.
 *
 * `knowledge.item.reviewed` e `knowledge_item.promoted` não viram toast: quem
 * revisou está olhando o item, e a promoção sem revisão já foi contada no
 * lote.
 */

/** O payload de `knowledge.distilled`, validado na borda. */
const DistilledPayloadSchema = z.object({
  projectId: z.string(),
  distillationRunId: z.string(),
  promoted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
  pendingReview: z.number().int().nonnegative().optional(),
});

export type DistilledPayload = z.infer<typeof DistilledPayloadSchema>;

export const KNOWLEDGE_DISTILLED = "knowledge.distilled";

const tint = (percent: number) =>
  `color-mix(in oklab, ${KNOWLEDGE_COLOR} ${String(percent)}%, transparent)`;

function DistilledToast({ payload, onOpen }: { payload: DistilledPayload; onOpen: () => void }) {
  const { t, theme, format } = useGlossary();

  return (
    <div
      className="bg-card flex w-full items-start gap-3 rounded-[12px] p-3.5"
      data-knowledge-toast={payload.distillationRunId}
      style={{
        border: `1px solid ${tint(55)}`,
        boxShadow: `0 0 0 1px ${tint(18)}, 0 10px 30px -12px ${tint(40)}`,
      }}
    >
      <span
        className="flex size-9 flex-none items-center justify-center rounded-full"
        style={{ border: `1px solid ${tint(40)}`, background: tint(12), color: KNOWLEDGE_COLOR }}
      >
        <Feather aria-hidden className="size-4.5" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={
            theme === "dnd"
              ? "font-display text-[14.5px] leading-5 font-semibold tracking-[0.03em]"
              : "text-[14.5px] leading-5 font-semibold"
          }
        >
          {t("entity.knowledge")}
        </span>
        <span className="text-muted-foreground text-[12.5px] leading-4.5">
          {format(t("knowledge.distill.done"), {
            promoted: payload.promoted,
            merged: payload.merged,
            rejected: payload.rejected,
          })}
        </span>
        <Link
          className="text-muted-foreground hover:text-foreground mt-0.5 flex w-fit items-center gap-1 text-[11.5px] underline-offset-2 hover:underline"
          onClick={onOpen}
          params={{ id: payload.projectId }}
          search={{ tab: "items", page: 1 }}
          to="/projects/$id/knowledge"
        >
          <span>{t("knowledge.overview.open")}</span>
          <ArrowRight aria-hidden className="size-3" />
        </Link>
      </div>
    </div>
  );
}

/** Escuta o canal de dashboard e anuncia cada lote que terminou com decisões. */
export function useKnowledgeToasts(): void {
  const addListener = useEventsStore((state) => state.addListener);

  useEffect(() => {
    return addListener((event) => {
      if (event.type !== KNOWLEDGE_DISTILLED) return;

      const parsed = DistilledPayloadSchema.safeParse(event.payload);
      if (!parsed.success) {
        console.error("[knowledge] payload de lote ilegível", event.payload);
        return;
      }

      const payload = parsed.data;
      toast.custom(
        (id) => (
          <DistilledToast
            onOpen={() => {
              toast.dismiss(id);
            }}
            payload={payload}
          />
        ),
        { id: `distilled:${payload.distillationRunId}`, duration: 12_000 },
      );
    });
  }, [addListener]);
}
