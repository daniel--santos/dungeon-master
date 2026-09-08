import { Link } from "@tanstack/react-router";
import { Anvil, ArrowRight } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { RARITY_COLOR } from "@/lib/achievements";
import { useEventsStore } from "@/lib/events";
import { NOTABLE_KIND_LABEL } from "@/lib/forged";
import { useGlossary } from "@/lib/glossary";

/**
 * O toast da forja, em qualquer tela (Fase 2.5C, entregue na 6B).
 *
 * O lote do Distiller grava a forjada em revisão e o evento na **mesma
 * transação**, então o toast nunca anuncia uma carta que o banco não tem. E
 * ele anuncia só isso: que há uma forjada esperando o veredito. O nome do
 * tema e a fala ficam para a forja, no Hall, onde a decisão acontece — uma
 * Conquista que o usuário ainda pode descartar não é celebrada no toast.
 *
 * Mesmo padrão visual do toast de desbloqueio: moldura na cor da raridade
 * (aqui a neutra, porque a raridade ainda está em revisão), medalhão e
 * rodapé sóbrio. A invalidação da seção mora em `useLiveQueries`.
 */

/** O payload de `achievement.forged`, validado na borda. */
const ForgedPayloadSchema = z.object({
  definitionId: z.string(),
  name: z.string(),
  kind: z.enum(["NEMESIS_DEFEATED", "VICTORY_STREAK", "FIRST_HARNESS_VICTORY", "DURATION_RECORD"]),
  projectId: z.string().nullable(),
  runId: z.string().nullable(),
  taskId: z.string().nullable(),
  distillationRunId: z.string().nullable(),
  reviewStatus: z.string(),
});

export type ForgedPayload = z.infer<typeof ForgedPayloadSchema>;

export const ACHIEVEMENT_FORGED = "achievement.forged";

const COLOR = RARITY_COLOR.COMMON;
const tint = (percent: number) => `color-mix(in oklab, ${COLOR} ${String(percent)}%, transparent)`;

/** O anúncio da forja em miniatura, do tamanho de um toast. */
function ForgedToast({ payload, onOpen }: { payload: ForgedPayload; onOpen: () => void }) {
  const { t, theme } = useGlossary();

  return (
    <div
      className="bg-card flex w-full items-start gap-3 rounded-[12px] p-3.5"
      data-forged-toast={payload.definitionId}
      style={{
        border: `1px solid ${tint(55)}`,
        boxShadow: `0 0 0 1px ${tint(18)}, 0 10px 30px -12px ${tint(40)}`,
      }}
    >
      <span
        className="flex size-9 flex-none items-center justify-center rounded-full"
        style={{ border: `1px solid ${tint(40)}`, background: tint(12), color: COLOR }}
      >
        <Anvil aria-hidden className="size-4.5" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={
            theme === "dnd"
              ? "font-display text-[14.5px] leading-5 font-semibold tracking-[0.03em]"
              : "text-[14.5px] leading-5 font-semibold"
          }
        >
          {t("forged.toast.title")}
        </span>
        <span className="text-muted-foreground text-[12.5px] leading-4.5">
          {t("forged.toast.body")}
        </span>
        <span className="text-muted-foreground text-[11px]">
          {t(NOTABLE_KIND_LABEL[payload.kind])}
        </span>
        <Link
          className="text-muted-foreground hover:text-foreground mt-0.5 flex w-fit items-center gap-1 text-[11.5px] underline-offset-2 hover:underline"
          onClick={onOpen}
          search={{ tab: "achievements" }}
          to="/hall"
        >
          <span>{t("forged.toast.open")}</span>
          <ArrowRight aria-hidden className="size-3" />
        </Link>
      </div>
    </div>
  );
}

/** Escuta o canal de dashboard e anuncia cada forjada que entra em revisão. */
export function useForgedToasts(): void {
  const addListener = useEventsStore((state) => state.addListener);

  useEffect(() => {
    return addListener((event) => {
      if (event.type !== ACHIEVEMENT_FORGED) return;

      const parsed = ForgedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) {
        console.error("[forged] payload de forjada ilegível", event.payload);
        return;
      }

      const payload = parsed.data;
      toast.custom(
        (id) => (
          <ForgedToast
            onOpen={() => {
              toast.dismiss(id);
            }}
            payload={payload}
          />
        ),
        { id: `forged:${payload.definitionId}`, duration: 12_000 },
      );
    });
  }, [addListener]);
}
