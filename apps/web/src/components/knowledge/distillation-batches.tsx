import { Link } from "@tanstack/react-router";
import { Feather, Hammer, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { BatchStatusChip } from "@/components/knowledge/knowledge-chips";
import { Panel, PanelHeader } from "@/components/panel";
import type { DistillationRunRecord } from "@/lib/api-types";
import { formatDateTime, relativeTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { useDistillationRuns } from "@/lib/knowledge";
import { batchDuration, DISTILLATION_TRIGGER } from "@/lib/knowledge-domain";

/** Quantos lotes a seção mostra. Os últimos bastam: a história inteira é da API. */
const BATCH_PAGE_SIZE = 10;

export interface DistillationBatchesProps {
  readonly projectId: string;
}

/**
 * Os últimos lotes do Distiller sobre o Project (Fase 6B).
 *
 * Cada linha é um `distillation_run`: estado, gatilho, contagens, duração e,
 * quando falhou, o erro — que é o que impede o retry morto do TencentDB
 * (documento técnico, seção 20.1): uma falha nunca some, e os candidatos
 * continuam pendentes para o lote seguinte. A releitura vem do SSE; o relógio
 * local só existe para a duração de um lote em andamento correr.
 */
export function DistillationBatches({ projectId }: DistillationBatchesProps) {
  const { t, format } = useGlossary();
  const batches = useDistillationRuns({ projectId, pageSize: BATCH_PAGE_SIZE });
  const items = batches.data?.items ?? [];

  const running = items.some((batch) => batch.status === "RUNNING");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [running]);

  if (batches.isError) {
    return <p className="text-destructive text-sm">{batches.error.message}</p>;
  }

  if (batches.isPending) {
    return <p className="text-muted-foreground text-sm">Lendo…</p>;
  }

  if (items.length === 0) {
    return (
      <Panel data-batches={0}>
        <EmptyState icon={Feather} title={t("knowledge.batches.title")}>
          {t("knowledge.batches.empty")}
        </EmptyState>
      </Panel>
    );
  }

  return (
    <Panel className="overflow-hidden" data-batches={items.length}>
      <PanelHeader
        aside={format("{count} no total · mais recentes primeiro", {
          count: batches.data?.total ?? items.length,
        })}
        title={t("knowledge.batches.title")}
      />
      <ul className="m-0 flex list-none flex-col p-0">
        {items.map((batch) => (
          <BatchRow batch={batch} key={batch.id} now={now} />
        ))}
      </ul>
    </Panel>
  );
}

function BatchRow({ batch, now }: { batch: DistillationRunRecord; now: number }) {
  const { t, format } = useGlossary();

  return (
    <li
      className="border-border flex flex-col gap-1.5 border-b px-5 py-3 last:border-b-0"
      data-batch={batch.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        <BatchStatusChip status={batch.status} />
        <span className="text-[12.5px]">{t(DISTILLATION_TRIGGER[batch.trigger])}</span>
        <span
          className="text-muted-foreground text-[11.5px]"
          title={formatDateTime(batch.startedAt)}
        >
          {relativeTime(batch.startedAt)}
        </span>
        <span className="flex-1" />
        <span className="text-muted-foreground font-mono text-[11.5px]" data-batch-duration>
          {batchDuration(batch.startedAt, batch.finishedAt, now)}
        </span>
      </div>

      <span className="text-muted-foreground text-[12px]" data-batch-counts>
        {format(t("knowledge.batch.counts"), {
          candidates: batch.candidateCount,
          promoted: batch.promoted,
          merged: batch.merged,
          rejected: batch.rejected,
        })}
      </span>

      {(batch.summaryRegenerated || batch.forgedAchievementId !== null) && (
        <span className="text-muted-foreground flex flex-wrap items-center gap-x-3 text-[11.5px]">
          {batch.summaryRegenerated && (
            <span className="flex items-center gap-1" data-batch-summary>
              <ScrollText aria-hidden className="size-3" />
              <span>{t("knowledge.batch.summaryRegenerated")}</span>
            </span>
          )}
          {batch.forgedAchievementId !== null && (
            <Link
              className="hover:text-foreground flex items-center gap-1 underline-offset-2 hover:underline"
              data-batch-forged={batch.forgedAchievementId}
              search={{ tab: "achievements" }}
              to="/hall"
            >
              <Hammer aria-hidden className="size-3" />
              <span>{t("knowledge.batch.forged")}</span>
            </Link>
          )}
        </span>
      )}

      {batch.error !== null && (
        <p
          className="text-destructive m-0 text-[12px] leading-4.5 whitespace-pre-wrap"
          data-batch-error
        >
          {batch.error}
        </p>
      )}
    </li>
  );
}
