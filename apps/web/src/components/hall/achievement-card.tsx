import { Check, Lock } from "lucide-react";

import {
  achievementIcon,
  HIDDEN_ICON,
  NEUTRAL_COLOR,
  ORIGIN_LABEL,
  RARITY_COLOR,
  RARITY_LABEL,
  STATE_LABEL,
  type AchievementCard as Card,
} from "@/lib/achievements";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";

/**
 * A carta Heráldica: a raridade é a moldura.
 *
 * Direção escolhida no canvas da Fase 1, sobre a alternativa Sóbria. Moldura e
 * medalhão na cor da raridade, medalhão em silhueta enquanto bloqueada, nome em
 * serif com versalete quando o tema está ligado.
 *
 * Uma carta oculta não vaza a raridade: moldura e medalhão ficam neutros, a
 * pílula some, e o nome vira "???" — senão o Hall entregaria pelo contorno o
 * que a Conquista existe para esconder.
 */

const tint = (color: string, percent: number) =>
  `color-mix(in oklab, ${color} ${String(percent)}%, transparent)`;

export function AchievementCard({ card }: { card: Card }) {
  const { t, theme, format } = useGlossary();

  const hidden = card.state === "HIDDEN";
  const unlocked = card.state === "UNLOCKED";
  const color = card.rarity === null ? NEUTRAL_COLOR : RARITY_COLOR[card.rarity];
  const Icon = hidden ? HIDDEN_ICON : achievementIcon(card.icon);

  const name = hidden ? "???" : (card.name?.[theme === "dnd" ? "theme" : "plain"] ?? "???");
  const description = hidden
    ? format("Esta {achievement} se revela quando você chegar perto dela.", {
        achievement: t("entity.achievement"),
      })
    : (card.description?.[theme === "dnd" ? "theme" : "plain"] ?? "");

  // Texto de sabor é só do tema: com o interruptor desligado ele não é
  // escondido por opacidade, ele não é renderizado.
  const flavor = theme === "dnd" && !hidden ? card.flavor : undefined;

  return (
    <article
      className="bg-card flex h-full flex-col gap-3 rounded-[14px] p-4"
      data-achievement={card.key}
      style={{
        border: `1px solid ${tint(color, unlocked ? 55 : 30)}`,
        boxShadow: unlocked
          ? `0 0 0 1px ${tint(color, 18)}, 0 10px 30px -12px ${tint(color, 40)}`
          : `0 6px 20px -14px ${tint(color, 45)}`,
      }}
    >
      <div className="flex items-start justify-between">
        <span
          className={cn("flex size-10 flex-none items-center justify-center rounded-full")}
          style={{
            border: `1px solid ${tint(color, 40)}`,
            background: tint(color, 12),
            color: unlocked ? color : "var(--muted-foreground)",
            opacity: unlocked ? 1 : 0.6,
          }}
        >
          <Icon aria-hidden className="size-5" />
        </span>

        {card.rarity !== null && (
          <span
            className="inline-flex h-5 w-fit items-center rounded-full px-2 text-[10px] font-semibold tracking-[0.08em] uppercase"
            style={{
              border: `1px solid ${tint(color, 45)}`,
              background: tint(color, 12),
              color,
            }}
          >
            {t(RARITY_LABEL[card.rarity])}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5">
        <h3
          className={cn(
            "text-base leading-5.5 font-semibold",
            theme === "dnd" && "font-display tracking-[0.03em] [font-variant:small-caps]",
            hidden && "text-muted-foreground",
          )}
        >
          {name}
        </h3>
        <p className="text-muted-foreground text-xs leading-4.5">{description}</p>
        {flavor !== undefined && (
          <p className="text-muted-foreground/80 border-border mt-1 border-t pt-2 text-xs leading-4.5 italic">
            {flavor}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          {unlocked ? (
            <Check aria-hidden className="size-3" />
          ) : (
            <Lock aria-hidden className="size-3" />
          )}
          <span>{t(STATE_LABEL[card.state])}</span>
        </span>

        {card.tierRarities !== undefined && card.tierRarities.length > 0 && !hidden ? (
          <span className="flex items-center gap-1">
            {card.tierRarities.map((rarity, index) => (
              <span
                key={`${rarity}-${String(index)}`}
                className="size-1.25 rounded-full"
                style={{ background: RARITY_COLOR[rarity] }}
              />
            ))}
            <span className="text-muted-foreground ml-0.5 text-[11px]">
              {card.tierRarities.length} tiers
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground text-[11px]">{t(ORIGIN_LABEL[card.origin])}</span>
        )}
      </div>
    </article>
  );
}
