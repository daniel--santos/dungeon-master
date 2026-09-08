import { useVirtualizer } from "@tanstack/react-virtual";
import { BookOpen } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Panel, PanelHeader } from "@/components/panel";
import { Button } from "@/components/ui/button";
import {
  achievementIcon,
  RARITY_COLOR,
  RARITY_LABEL,
  useMarkUnlocksSeen,
  useUnlocks,
  type AchievementUnlockRecord,
} from "@/lib/achievements";
import { formatDateTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";

/**
 * A Crônica: a linha do tempo de desbloqueios, do mais recente ao mais antigo.
 *
 * A lista é virtualizada porque ela só cresce — cada tier de cada Conquista
 * deixa uma linha, e nada aqui é apagado. A paginação é incremental e acumula
 * no cliente: a API pagina por número de página, e a Crônica é ordenada por um
 * instante que não muda depois de gravado, então uma página já lida continua
 * valendo enquanto uma nova chega na frente.
 *
 * Abrir a aba marca como visto o que ainda não foi. É aqui e no Hall que a
 * marcação acontece, e não no toast: um toast pode passar despercebido, mas
 * abrir a Crônica é a prova de que o usuário olhou.
 *
 * O instante é o do **fato**, não o da gravação: uma reconstrução produz a
 * mesma Crônica, com as mesmas datas.
 */

const PAGE_SIZE = 25;
const ROW_HEIGHT = 68;
const VIEWPORT_HEIGHT = 560;

const tint = (color: string, percent: number) =>
  `color-mix(in oklab, ${color} ${String(percent)}%, transparent)`;

export function ChronicleTab() {
  const { t, format } = useGlossary();
  const [page, setPage] = useState(1);
  const [seen, setSeen] = useState<readonly AchievementUnlockRecord[]>([]);

  const query = useUnlocks({ page, pageSize: PAGE_SIZE });

  // Acumula as páginas já lidas. A chave da query é a página, então cada uma
  // fica no cache por conta própria; o que mora aqui é só a costura delas.
  useEffect(() => {
    const data = query.data;
    if (data === undefined) return;

    setSeen((previous) => {
      const byId = new Map(previous.map((item) => [item.id, item]));
      for (const item of data.items) byId.set(item.id, item);
      return [...byId.values()].sort((a, b) =>
        a.unlockedAt === b.unlockedAt
          ? b.id.localeCompare(a.id)
          : b.unlockedAt.localeCompare(a.unlockedAt),
      );
    });
  }, [query.data]);

  useMarkUnlocksSeen(query.data?.items);

  const total = query.data?.total ?? 0;
  const hasMore = seen.length < total;

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: seen.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const rows = virtualizer.getVirtualItems();
  const height = useMemo(() => virtualizer.getTotalSize(), [virtualizer, rows.length]);

  if (query.isError) {
    return <p className="text-destructive text-sm">{query.error.message}</p>;
  }

  if (query.isPending && seen.length === 0) {
    return <p className="text-muted-foreground text-sm">Lendo…</p>;
  }

  if (seen.length === 0) {
    return (
      <Panel>
        <EmptyState icon={BookOpen} title={t("hall.tab.chronicle")}>
          {format("Nenhuma {achievement} desbloqueada ainda.", {
            achievement: t("entity.achievement"),
          })}
        </EmptyState>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader
        aside={format("{count} no total", { count: total })}
        title={t("hall.tab.chronicle")}
      />

      <div
        className="overflow-y-auto"
        data-chronicle
        ref={scrollRef}
        style={{ height: `${String(Math.min(VIEWPORT_HEIGHT, Math.max(height, ROW_HEIGHT)))}px` }}
      >
        <div className="relative w-full" style={{ height: `${String(height)}px` }}>
          {rows.map((row) => {
            const unlock = seen[row.index];
            if (unlock === undefined) return null;

            return (
              <div
                key={unlock.id}
                className="absolute top-0 left-0 w-full"
                style={{
                  height: `${String(row.size)}px`,
                  transform: `translateY(${String(row.start)}px)`,
                }}
              >
                <ChronicleRow unlock={unlock} />
              </div>
            );
          })}
        </div>
      </div>

      {hasMore && (
        <div className="border-border flex justify-center border-t px-4 py-3">
          <Button
            disabled={query.isFetching}
            onClick={() => {
              setPage((current) => current + 1);
            }}
            size="sm"
            variant="outline"
          >
            {t("hall.chronicle.loadMore")}
          </Button>
        </div>
      )}
    </Panel>
  );
}

function ChronicleRow({ unlock }: { unlock: AchievementUnlockRecord }) {
  const { t, theme } = useGlossary();
  const color = RARITY_COLOR[unlock.rarity];
  const Icon = achievementIcon(unlock.icon);
  const themed = theme === "dnd";
  const name = themed ? unlock.name.theme : unlock.name.plain;
  const label = unlock.tierLabel;

  return (
    <div
      className="border-border flex h-full items-center gap-3 border-b px-4"
      data-chronicle-unlock={unlock.id}
    >
      <span
        className="flex size-8 flex-none items-center justify-center rounded-full"
        style={{
          border: `1px solid ${tint(color, 40)}`,
          background: tint(color, 12),
          color,
        }}
      >
        <Icon aria-hidden className="size-4" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={
            themed
              ? "font-display truncate text-[14px] font-semibold tracking-[0.03em] [font-variant:small-caps]"
              : "truncate text-[14px] font-semibold"
          }
        >
          {label === null ? name : `${name} ${label}`}
        </span>
        <span className="text-muted-foreground text-[11.5px]">
          {formatDateTime(unlock.unlockedAt)}
        </span>
      </div>

      <span
        className="inline-flex h-5 flex-none items-center rounded-full px-2 text-[10px] font-semibold tracking-[0.08em] uppercase"
        style={{
          border: `1px solid ${tint(color, 45)}`,
          background: tint(color, 12),
          color,
        }}
      >
        {t(RARITY_LABEL[unlock.rarity])}
      </span>

      {unlock.seenAt === null && (
        <span
          aria-label={t("hall.unseen")}
          className="size-1.75 flex-none rounded-full"
          style={{ background: color }}
          title={t("hall.unseen")}
        />
      )}
    </div>
  );
}
