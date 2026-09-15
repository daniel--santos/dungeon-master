import { Server } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Panel, PanelHeader } from "@/components/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { WorkerListRecord, WorkerStatusRecord } from "@/lib/api-types";
import { formatDateTime, relativeTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { formatCount, WORKER_STATUS } from "@/lib/metrics-domain";
import { cn } from "@/lib/utils";

/**
 * Os Workers conhecidos, com o batimento (planejamento v0.4, Fase 10B).
 *
 * `status` é calculado na leitura e chega pronto: `ONLINE` bateu dentro do
 * prazo, `STALE` não bate há mais de três intervalos e não se despediu,
 * `OFFLINE` desligou graciosamente. A tela não recalcula a partir do relógio
 * do browser — dois relógios fora de sincronia mostrariam estados diferentes
 * para o mesmo processo.
 *
 * `runningRuns` é o número que importa num `STALE`: é o que o processo morto
 * ainda segura, e o que a reconciliação do Worker sobrevivente vai zerar.
 */

export interface WorkerTableProps {
  readonly workers: WorkerListRecord | undefined;
  readonly isPending: boolean;
  readonly error: Error | null;
}

export function WorkerTable({ workers, isPending, error }: WorkerTableProps) {
  const { t } = useGlossary();
  const items = workers?.items ?? [];

  return (
    <Panel data-metrics-workers={items.length}>
      <PanelHeader title={t("metrics.worker.title")} aside={t("metrics.worker.description")} />

      {error !== null && <p className="text-destructive px-5 py-4 text-sm">{error.message}</p>}
      {isPending && <p className="text-muted-foreground px-5 py-4 text-sm">Lendo…</p>}

      {!isPending && error === null && items.length === 0 && (
        <EmptyState icon={Server} title={t("metrics.worker.empty")}>
          {t("metrics.worker.description")}
        </EmptyState>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>{t("metrics.worker.host")}</TableHead>
                <TableHead className="text-right">{t("metrics.worker.pid")}</TableHead>
                <TableHead>{t("metrics.worker.version")}</TableHead>
                <TableHead>{t("metrics.worker.lastHeartbeat")}</TableHead>
                <TableHead className="text-right">{t("metrics.worker.runningRuns")}</TableHead>
                <TableHead>{t("metrics.worker.harnesses")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((worker) => (
                <TableRow
                  data-worker={worker.id}
                  data-worker-status={worker.status}
                  key={worker.id}
                >
                  <TableCell>
                    <WorkerStatusChip status={worker.status} />
                  </TableCell>
                  <TableCell className="font-medium">{worker.hostname}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(worker.pid)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {`${worker.version} · Node ${worker.nodeVersion}`}
                  </TableCell>
                  <TableCell title={formatDateTime(worker.lastHeartbeatAt)}>
                    {relativeTime(worker.lastHeartbeatAt)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {`${formatCount(worker.runningRuns)} / ${formatCount(worker.capacity)}`}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {worker.harnesses.length === 0
                      ? "—"
                      : worker.harnesses
                          .map((harness) =>
                            harness.version === null
                              ? harness.key
                              : `${harness.key} ${harness.version}`,
                          )
                          .join(", ")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

/** O chip de estado: ponto colorido e texto, nunca só a cor. */
export function WorkerStatusChip({ status }: { status: WorkerStatusRecord }) {
  const { t } = useGlossary();
  const { label, dot, dim } = WORKER_STATUS[status];

  return (
    <span className="flex items-center gap-1.75 text-[12.5px] whitespace-nowrap">
      <span
        aria-hidden
        className="size-1.75 flex-none rounded-full"
        style={{ backgroundColor: dot }}
      />
      <span className={cn(dim && "text-muted-foreground")}>{t(label)}</span>
    </span>
  );
}
