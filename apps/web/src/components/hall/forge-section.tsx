import { Link } from "@tanstack/react-router";
import { Anvil, Hammer, PenLine, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { DiscardForgedDialog } from "@/components/hall/discard-forged-dialog";
import { ForgedConflictBox } from "@/components/hall/forged-conflict";
import { RenameForgedDialog } from "@/components/hall/rename-forged-dialog";
import { Panel, PanelHeader } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { achievementIcon, RARITY_COLOR, RARITY_LABEL } from "@/lib/achievements";
import type { ForgedAchievementRecord } from "@/lib/api-types";
import { relativeTime } from "@/lib/datetime";
import {
  ForgedConflictError,
  NOTABLE_KIND_LABEL,
  useApproveForgedAchievement,
  useForgedAchievements,
} from "@/lib/forged";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";

const ACCENT_GREEN = "var(--accent-green)";

const tint = (color: string, percent: number) =>
  `color-mix(in oklab, ${color} ${String(percent)}%, transparent)`;

/**
 * "Na forja": as Conquistas forjadas em revisão (Fase 2.5C, entregue na 6B).
 *
 * Fica acima da grade do Hall, e só quando há alguma: a forjada não é uma
 * carta do Hall até o usuário pendurá-la lá. Cada uma mostra a carta
 * Heráldica como ela ficaria, o resultado notável que a motivou e as três
 * saídas: pendurar (ação direta com toast), reescrever (diálogo de
 * formulário) e descartar (`AlertDialog`, porque não tem volta).
 *
 * Com o tema desligado, o texto do modelo não é renderizado: a carta mostra
 * o nome e a descrição sóbrios, escritos pelo código — a regra de que texto
 * de sabor só existe no tema (planejamento v0.4, seção 14).
 */
export function ForgeSection() {
  const { t, format } = useGlossary();
  const forged = useForgedAchievements();
  const items = forged.data?.items ?? [];

  const [renaming, setRenaming] = useState<ForgedAchievementRecord | null>(null);
  const [discarding, setDiscarding] = useState<ForgedAchievementRecord | null>(null);

  if (forged.isError) {
    return <p className="text-destructive text-sm">{forged.error.message}</p>;
  }

  if (items.length === 0) return null;

  return (
    <>
      <Panel className="overflow-hidden" data-forge={items.length}>
        <PanelHeader
          aside={format("{n} em revisão", { n: items.length })}
          title={
            <span className="flex items-center gap-2">
              <Anvil aria-hidden className="text-muted-foreground size-3.75" />
              <span>{t("forged.section.title")}</span>
            </span>
          }
        />
        <p className="text-muted-foreground border-border border-b px-5 py-3 text-[12.5px] leading-4.5">
          {t("forged.section.hint")}
        </p>
        <ul className="m-0 grid list-none grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((achievement) => (
            <ForgedCard
              achievement={achievement}
              key={achievement.id}
              onDiscard={() => {
                setDiscarding(achievement);
              }}
              onRename={() => {
                setRenaming(achievement);
              }}
            />
          ))}
        </ul>
      </Panel>

      <RenameForgedDialog
        achievement={renaming}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
      />
      <DiscardForgedDialog
        achievement={discarding}
        onOpenChange={(open) => {
          if (!open) setDiscarding(null);
        }}
      />
    </>
  );
}

function ForgedCard({
  achievement,
  onRename,
  onDiscard,
}: {
  achievement: ForgedAchievementRecord;
  onRename: () => void;
  onDiscard: () => void;
}) {
  const { t, theme, format } = useGlossary();
  const approve = useApproveForgedAchievement();
  const [conflict, setConflict] = useState<ForgedAchievementRecord | null>(null);

  const themed = theme === "dnd";
  const color = RARITY_COLOR[achievement.rarity];
  const Icon = achievementIcon(achievement.icon);
  const { provenance } = achievement;

  function hang() {
    approve.mutate(
      { id: achievement.id },
      {
        onSuccess: () => {
          toast.success(t("forged.approve.done"));
        },
        onError: (error: Error) => {
          if (error instanceof ForgedConflictError) {
            setConflict(error.achievement);
            return;
          }
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <li
      className="bg-card flex h-full flex-col gap-3 rounded-xl p-4"
      data-forged={achievement.id}
      style={{
        border: `1px dashed ${tint(color, 55)}`,
        boxShadow: `0 6px 20px -14px ${tint(color, 45)}`,
      }}
    >
      <div className="flex items-start justify-between">
        <span
          className="flex size-10 flex-none items-center justify-center rounded-full"
          style={{ border: `1px solid ${tint(color, 40)}`, background: tint(color, 12), color }}
        >
          <Icon aria-hidden className="size-5" />
        </span>
        <span
          className="inline-flex h-5 w-fit items-center rounded-full px-2 text-[10px] font-semibold tracking-[0.08em] uppercase"
          style={{ border: `1px solid ${tint(color, 45)}`, background: tint(color, 12), color }}
        >
          {t(RARITY_LABEL[achievement.rarity])}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1.5">
        <h3
          className={cn(
            "text-base leading-5.5 font-semibold",
            themed && "font-display tracking-[0.03em] [font-variant:small-caps]",
          )}
          data-forged-name
        >
          {themed ? achievement.name : achievement.plainName}
        </h3>
        {/* Texto escrito por um modelo: renderizado como texto, nunca como HTML. */}
        <p className="text-muted-foreground text-xs leading-4.5">
          {themed ? achievement.description : achievement.plainDescription}
        </p>
        {themed && (
          <p className="text-muted-foreground/80 border-border mt-1 border-t pt-2 text-xs leading-4.5 italic">
            {achievement.flavor}
          </p>
        )}
      </div>

      <div className="text-muted-foreground flex flex-col gap-0.5 text-[11px]">
        <span>
          {format("{label}: {kind}", {
            label: t("forged.provenance"),
            kind: t(NOTABLE_KIND_LABEL[provenance.kind]),
          })}
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5">
          {provenance.runId !== null && (
            <Link
              className="hover:text-foreground underline-offset-2 hover:underline"
              data-forged-run={provenance.runId}
              params={{ id: provenance.runId }}
              to="/runs/$id"
            >
              {format("Abrir o {cockpit}", { cockpit: t("run.cockpit") })}
            </Link>
          )}
          {provenance.runId !== null && <span aria-hidden>·</span>}
          <span>{format("forjada {when}", { when: relativeTime(achievement.createdAt) })}</span>
        </span>
      </div>

      {conflict !== null ? (
        <ForgedConflictBox
          achievement={conflict}
          onDismiss={() => {
            setConflict(null);
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Button
            className="border"
            data-forged-decision="approve"
            disabled={approve.isPending}
            onClick={hang}
            size="xs"
            style={{
              borderColor: tint(ACCENT_GREEN, 45),
              backgroundColor: tint(ACCENT_GREEN, 14),
              color: ACCENT_GREEN,
            }}
            variant="ghost"
          >
            <Hammer aria-hidden />
            <span>{t("forged.decision.approve")}</span>
          </Button>
          <Button
            data-forged-decision="rename"
            disabled={approve.isPending}
            onClick={onRename}
            size="xs"
            variant="outline"
          >
            <PenLine aria-hidden />
            <span>{t("forged.decision.rename")}</span>
          </Button>
          <Button
            className="border"
            data-forged-decision="discard"
            disabled={approve.isPending}
            onClick={onDiscard}
            size="xs"
            style={{
              borderColor: "color-mix(in oklch, var(--destructive) 45%, transparent)",
              backgroundColor: "color-mix(in oklch, var(--destructive) 14%, transparent)",
              color: "var(--destructive)",
            }}
            variant="ghost"
          >
            <Trash2 aria-hidden />
            <span>{t("forged.decision.discard")}</span>
          </Button>
        </div>
      )}
    </li>
  );
}
