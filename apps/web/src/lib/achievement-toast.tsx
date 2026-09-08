import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
  achievementIcon,
  achievementKeys,
  heroKeys,
  RARITY_COLOR,
  RARITY_LABEL,
  STATE_LABEL,
  type AchievementRarity,
} from "@/lib/achievements";
import { useEventsStore } from "@/lib/events";
import { useGlossary, type UseGlossary } from "@/lib/glossary";

/**
 * O toast de desbloqueio, em qualquer tela (planejamento v0.4, Fase 2.5B).
 *
 * O projetor grava o desbloqueio e o evento de dashboard na **mesma
 * transação**, então um toast nunca anuncia uma Conquista que o banco não tem.
 * Aqui só resta escutar: mostrar a carta em miniatura e mandar o Hall reler.
 *
 * O texto de sabor é a fala de anúncio, e é só do tema. Com o interruptor
 * desligado ele não é escondido por opacidade: ele não é renderizado, e o que
 * sobra é o nome `plain` com a descrição `plain`, a raridade e o grau. A
 * descrição chega no próprio payload, nas duas versões, então o modo sóbrio
 * tem o que dizer sem uma segunda leitura; uma Conquista do tema sem fala de
 * anúncio cai na descrição temática pelo mesmo motivo.
 */

/**
 * O payload de `achievement.unlocked`, validado na borda.
 *
 * `DashboardEvent.payload` é `unknown` de propósito: quem lê o stream tolera um
 * tipo que ainda não conhece. Um quadro que não casa com esta forma é
 * ignorado em silêncio, e não um toast quebrado no meio da tela.
 */
const UnlockPayloadSchema = z.object({
  unlockId: z.string(),
  definitionId: z.string(),
  name: z.object({ theme: z.string(), plain: z.string() }),
  // Opcional na borda: um quadro reenviado de antes de a descrição entrar no
  // payload ainda vira toast, só que sem ela.
  description: z.object({ theme: z.string(), plain: z.string() }).optional(),
  icon: z.string(),
  rarity: z.enum(["COMMON", "RARE", "EPIC", "LEGENDARY"]),
  flavor: z.string().nullable().optional(),
  tier: z.number().int().positive(),
  tierLabel: z.string().nullable().optional(),
});

export type UnlockPayload = z.infer<typeof UnlockPayloadSchema>;

export const ACHIEVEMENT_UNLOCKED = "achievement.unlocked";
export const HERO_STATS_UPDATED = "hero_stats.updated";

/** O que o toast mostra, resolvido no tema ativo. Separado para poder ser testado. */
export interface UnlockToastContent {
  readonly name: string;
  readonly rarity: AchievementRarity;
  readonly rarityLabel: string;
  readonly color: string;
  /**
   * O texto sob o nome: a fala de anúncio no tema, a descrição sóbria sem ele.
   * Ausente só quando o payload não trouxe nenhum dos dois.
   */
  readonly body: string | undefined;
  /** O rodapé sóbrio: o estado, e o grau quando a Conquista tem mais de um. */
  readonly footer: string;
}

export function unlockToastContent(
  payload: UnlockPayload,
  glossary: Pick<UseGlossary, "t" | "theme" | "format">,
): UnlockToastContent {
  const { t, theme, format } = glossary;
  const themed = theme === "dnd";
  const label = payload.tierLabel ?? null;

  return {
    name: themed ? payload.name.theme : payload.name.plain,
    rarity: payload.rarity,
    rarityLabel: t(RARITY_LABEL[payload.rarity]),
    color: RARITY_COLOR[payload.rarity],
    body: themed
      ? (payload.flavor ?? payload.description?.theme ?? undefined)
      : payload.description?.plain,
    footer:
      label === null
        ? t(STATE_LABEL.UNLOCKED)
        : `${t(STATE_LABEL.UNLOCKED)} · ${format(t("hall.tierOf"), { label })}`,
  };
}

const tint = (color: string, percent: number) =>
  `color-mix(in oklab, ${color} ${String(percent)}%, transparent)`;

/** A carta Heráldica em miniatura, do tamanho de um toast. */
function UnlockToast({ payload }: { payload: UnlockPayload }) {
  const glossary = useGlossary();
  const content = unlockToastContent(payload, glossary);
  const Icon = achievementIcon(payload.icon);

  return (
    <div
      className="bg-card flex w-full items-start gap-3 rounded-[12px] p-3.5"
      data-achievement-toast={payload.definitionId}
      style={{
        border: `1px solid ${tint(content.color, 55)}`,
        boxShadow: `0 0 0 1px ${tint(content.color, 18)}, 0 10px 30px -12px ${tint(content.color, 40)}`,
      }}
    >
      <span
        className="flex size-9 flex-none items-center justify-center rounded-full"
        style={{
          border: `1px solid ${tint(content.color, 40)}`,
          background: tint(content.color, 12),
          color: content.color,
        }}
      >
        <Icon aria-hidden className="size-4.5" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <span
            className={
              glossary.theme === "dnd"
                ? "font-display text-[14.5px] leading-5 font-semibold tracking-[0.03em] [font-variant:small-caps]"
                : "text-[14.5px] leading-5 font-semibold"
            }
          >
            {content.name}
          </span>
          <span
            className="inline-flex h-5 flex-none items-center rounded-full px-2 text-[10px] font-semibold tracking-[0.08em] uppercase"
            style={{
              border: `1px solid ${tint(content.color, 45)}`,
              background: tint(content.color, 12),
              color: content.color,
            }}
          >
            {content.rarityLabel}
          </span>
        </div>

        {content.body !== undefined && (
          <p
            className={
              glossary.theme === "dnd"
                ? "text-muted-foreground text-xs leading-4.5 italic"
                : "text-muted-foreground text-xs leading-4.5"
            }
          >
            {content.body}
          </p>
        )}

        <span className="text-muted-foreground text-[11px]">{content.footer}</span>
      </div>
    </div>
  );
}

/**
 * Escuta o canal de dashboard e anuncia cada desbloqueio.
 *
 * Vive no layout raiz: o desbloqueio acontece enquanto o usuário está em
 * qualquer tela, e é justamente esse o critério de conclusão da Fase 2.5.
 *
 * A invalidação é do prefixo inteiro das Conquistas, e não de uma chave exata,
 * porque o evento não diz qual filtro está aberto na grade. `hero_stats` entra
 * junto no seu próprio evento: um desbloqueio e um ganho de experiência vêm do
 * mesmo passe do projetor, mas nem todo passe produz os dois.
 */
export function useAchievementToasts(): void {
  const queryClient = useQueryClient();
  const addListener = useEventsStore((state) => state.addListener);

  useEffect(() => {
    return addListener((event) => {
      if (event.type === HERO_STATS_UPDATED) {
        void queryClient.invalidateQueries({ queryKey: heroKeys.stats });
        return;
      }

      if (event.type !== ACHIEVEMENT_UNLOCKED) return;

      void queryClient.invalidateQueries({ queryKey: achievementKeys.all });
      void queryClient.invalidateQueries({ queryKey: heroKeys.stats });

      const parsed = UnlockPayloadSchema.safeParse(event.payload);
      if (!parsed.success) {
        console.error("[achievements] payload de desbloqueio ilegível", event.payload);
        return;
      }

      const payload = parsed.data;
      toast.custom(() => <UnlockToast payload={payload} />, {
        id: payload.unlockId,
        duration: 8_000,
      });
    });
  }, [addListener, queryClient]);
}
