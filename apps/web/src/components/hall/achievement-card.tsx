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
 * Os quatro estados, e o que cada um muda:
 *
 * - **Bloqueada**: moldura a 30% e sem brilho, ícone em silhueta a 60%.
 * - **Oculta**: não vaza a raridade — moldura e medalhão neutros, a pílula some
 *   e o nome vira "???". Senão o Hall entregaria pelo contorno o que a
 *   Conquista existe para esconder.
 * - **Em progresso**: a bloqueada, mais a barra na cor da raridade e o
 *   "{feito} de {alvo}". A barra só aparece aqui: numa carta sem nenhum
 *   progresso ela seria uma linha vazia repetida quinze vezes, e numa
 *   desbloqueada seria uma barra cheia dizendo o óbvio.
 * - **Desbloqueada**: moldura a 55%, brilho externo e o sinal de confirmação.
 *
 * O grau (`tier`) só aparece quando a Conquista tem mais de um, e o numeral só
 * depois do primeiro desbloqueio — antes dele a API manda `label` nulo de
 * propósito, porque "Grau I" numa carta bloqueada prometeria um degrau que
 * ainda não foi vencido.
 */

const tint = (color: string, percent: number) =>
  `color-mix(in oklab, ${color} ${String(percent)}%, transparent)`;

export interface AchievementCardProps {
  readonly card: Card;
  /** Desbloqueio que o usuário ainda não viu: ganha um pontinho de destaque. */
  readonly unseen?: boolean;
}

export function AchievementCard({ card, unseen = false }: AchievementCardProps) {
  const { t, theme, format } = useGlossary();

  const hidden = card.state === "HIDDEN";
  const unlocked = card.state === "UNLOCKED";
  const inProgress = card.state === "IN_PROGRESS";
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

  const tierLabel = card.tier.label;
  const showTier = !hidden && card.tier.total > 1 && tierLabel !== null;

  return (
    <article
      className="bg-card flex h-full flex-col gap-3 rounded-[14px] p-4"
      data-achievement={card.key}
      data-state={card.state}
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

        <div className="flex items-center gap-1.5">
          {unseen && (
            <span
              aria-label={t("hall.unseen")}
              className="size-1.75 rounded-full"
              data-achievement-unseen
              style={{ background: color }}
              title={t("hall.unseen")}
            />
          )}
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
      </div>

      <div className="flex flex-1 flex-col gap-1.5">
        <h3
          className={cn(
            "text-base leading-5.5 font-semibold",
            theme === "dnd" && "font-display tracking-[0.03em] [font-variant:small-caps]",
            hidden && "text-muted-foreground",
          )}
        >
          {showTier ? `${name} ${tierLabel}` : name}
        </h3>
        <p className="text-muted-foreground text-xs leading-4.5">{description}</p>
        {flavor !== undefined && (
          <p className="text-muted-foreground/80 border-border mt-1 border-t pt-2 text-xs leading-4.5 italic">
            {flavor}
          </p>
        )}
      </div>

      {inProgress && (
        <div className="flex flex-col gap-1.25" data-achievement-progress={card.progress.current}>
          <div className="bg-muted h-1.25 w-full overflow-hidden rounded-full">
            <div
              className="h-full rounded-full"
              style={{ background: color, width: `${String(card.progress.percent)}%` }}
            />
          </div>
          <span className="text-muted-foreground text-[11px]">
            {format(t("hall.progressOf"), {
              current: card.progress.current,
              target: card.progress.target,
            })}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          {unlocked ? (
            <Check aria-hidden className="size-3" />
          ) : (
            <Lock aria-hidden className="size-3" />
          )}
          <span>{t(STATE_LABEL[card.state])}</span>
        </span>

        <span className="text-muted-foreground text-[11px]">{t(ORIGIN_LABEL[card.origin])}</span>
      </div>
    </article>
  );
}
