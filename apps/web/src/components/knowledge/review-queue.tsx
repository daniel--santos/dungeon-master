import { Link } from "@tanstack/react-router";
import { PenLine, Stamp, ThumbsDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EditKnowledgeItemDialog } from "@/components/knowledge/edit-knowledge-item-dialog";
import { KnowledgeTypeChip } from "@/components/knowledge/knowledge-chips";
import { KnowledgeConflictBox } from "@/components/knowledge/knowledge-conflict";
import { RejectKnowledgeItemDialog } from "@/components/knowledge/reject-knowledge-item-dialog";
import { Panel, PanelHeader } from "@/components/panel";
import { Button } from "@/components/ui/button";
import type { KnowledgeItemRecord } from "@/lib/api-types";
import { relativeTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import {
  KnowledgeConflictError,
  useApproveKnowledgeItem,
  usePendingKnowledge,
} from "@/lib/knowledge";
import { KNOWLEDGE_PENDING_COLOR } from "@/lib/knowledge-domain";

const ACCENT_GREEN = "var(--accent-green)";

function tint(color: string, percent: number): string {
  return `color-mix(in oklch, ${color} ${String(percent)}%, transparent)`;
}

export interface ReviewQueueProps {
  readonly projectId: string;
}

/**
 * A fila de revisão do Grimório (Fase 6B): os itens `PENDING_REVIEW` de um
 * Project, com as três saídas — selar, corrigir antes de selar, recusar.
 *
 * Aprovar é ação direta com toast: o item já foi lido na linha, e um diálogo
 * a mais só ensinaria a clicar sem ler. Recusar pede confirmação, porque não
 * tem volta. Se a aprovação perder a corrida (outra aba decidiu antes), o
 * `409` vira o aviso na própria linha, com o item como ficou.
 *
 * O painel não aparece quando a fila está vazia: a lista do Grimório fica
 * logo abaixo, e um painel vazio em cima dela seria só ruído.
 */
export function ReviewQueue({ projectId }: ReviewQueueProps) {
  const { t, format } = useGlossary();
  const pending = usePendingKnowledge(projectId);
  const items = pending.data?.items ?? [];

  const [editing, setEditing] = useState<KnowledgeItemRecord | null>(null);
  const [rejecting, setRejecting] = useState<KnowledgeItemRecord | null>(null);

  if (pending.isError) {
    return <p className="text-destructive text-sm">{pending.error.message}</p>;
  }

  if (items.length === 0) return null;

  return (
    <>
      <Panel className="overflow-hidden" data-review-queue={pending.data?.total ?? items.length}>
        <PanelHeader
          title={
            <span className="flex items-center gap-2">
              <Stamp aria-hidden className="size-3.75" style={{ color: KNOWLEDGE_PENDING_COLOR }} />
              <span>{t("knowledge.review.title")}</span>
            </span>
          }
          aside={format("{n} na fila", { n: pending.data?.total ?? items.length })}
        />

        <p className="text-muted-foreground border-border border-b px-5 py-3 text-[12.5px] leading-4.5">
          {t("knowledge.review.hint")}
        </p>

        <ul className="m-0 flex list-none flex-col p-0">
          {items.map((item) => (
            <ReviewRow
              key={item.id}
              item={item}
              onEdit={() => {
                setEditing(item);
              }}
              onReject={() => {
                setRejecting(item);
              }}
              projectId={projectId}
            />
          ))}
        </ul>
      </Panel>

      <EditKnowledgeItemDialog
        approveAfterSave
        item={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
      <RejectKnowledgeItemDialog
        item={rejecting}
        onOpenChange={(open) => {
          if (!open) setRejecting(null);
        }}
      />
    </>
  );
}

function ReviewRow({
  item,
  projectId,
  onEdit,
  onReject,
}: {
  item: KnowledgeItemRecord;
  projectId: string;
  onEdit: () => void;
  onReject: () => void;
}) {
  const { t, format } = useGlossary();
  const approve = useApproveKnowledgeItem();
  const [conflict, setConflict] = useState<KnowledgeItemRecord | null>(null);

  function seal() {
    approve.mutate(
      { id: item.id },
      {
        onSuccess: () => {
          toast.success(t("knowledge.approve.done"));
        },
        onError: (error: Error) => {
          if (error instanceof KnowledgeConflictError) {
            setConflict(error.item);
            return;
          }
          toast.error(error.message);
        },
      },
    );
  }

  const { provenance } = item;

  return (
    <li
      className="border-border flex flex-col gap-2.5 border-b px-5 py-3.5 last:border-b-0"
      data-review-item={item.id}
    >
      <div className="flex items-start gap-3.5">
        <span
          className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-full border"
          style={{
            borderColor: tint(KNOWLEDGE_PENDING_COLOR, 40),
            backgroundColor: tint(KNOWLEDGE_PENDING_COLOR, 12),
            color: KNOWLEDGE_PENDING_COLOR,
          }}
        >
          <Stamp aria-hidden className="size-3.5" />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className="text-[13.5px] leading-4.5 font-medium underline-offset-2 hover:underline"
              data-review-item-open
              params={{ id: projectId }}
              from="/projects/$id/knowledge"
              search={(previous) => ({ ...previous, item: item.id })}
              to="/projects/$id/knowledge"
            >
              {item.title}
            </Link>
            <KnowledgeTypeChip type={item.type} />
          </div>

          {/* Texto escrito por um modelo: renderizado como texto, nunca como HTML. */}
          <p className="text-muted-foreground m-0 line-clamp-4 text-[12.5px] leading-4.5 whitespace-pre-wrap">
            {item.content}
          </p>

          <span className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11.5px]">
            {provenance.runId !== null && (
              <>
                <span className="flex-none">{t("knowledge.provenance.run")}:</span>
                <Link
                  className="hover:text-foreground truncate underline-offset-2 hover:underline"
                  data-review-item-run={provenance.runId}
                  params={{ id: provenance.runId }}
                  to="/runs/$id"
                >
                  {format("Abrir o {cockpit}", { cockpit: t("run.cockpit") })}
                </Link>
                <span aria-hidden>·</span>
              </>
            )}
            <span>{format("escrita {when}", { when: relativeTime(item.createdAt) })}</span>
            {provenance.mergedCandidateIds.length > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {format("{n} {label}", {
                    n: provenance.mergedCandidateIds.length,
                    label: t("knowledge.provenance.merged").toLowerCase(),
                  })}
                </span>
              </>
            )}
          </span>
        </div>
      </div>

      {conflict !== null ? (
        <div className="pl-10.5">
          <KnowledgeConflictBox
            item={conflict}
            onDismiss={() => {
              setConflict(null);
            }}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pl-10.5">
          <Button
            className="border"
            data-knowledge-decision="approve"
            disabled={approve.isPending}
            onClick={seal}
            size="xs"
            style={{
              borderColor: tint(ACCENT_GREEN, 45),
              backgroundColor: tint(ACCENT_GREEN, 14),
              color: ACCENT_GREEN,
            }}
            variant="ghost"
          >
            <Stamp aria-hidden />
            <span>{t("knowledge.decision.approve")}</span>
          </Button>
          <Button
            data-knowledge-decision="edit-approve"
            disabled={approve.isPending}
            onClick={onEdit}
            size="xs"
            variant="outline"
          >
            <PenLine aria-hidden />
            <span>{t("knowledge.decision.editApprove")}</span>
          </Button>
          <Button
            className="border"
            data-knowledge-decision="reject"
            disabled={approve.isPending}
            onClick={onReject}
            size="xs"
            style={{
              borderColor: "color-mix(in oklch, var(--destructive) 45%, transparent)",
              backgroundColor: "color-mix(in oklch, var(--destructive) 14%, transparent)",
              color: "var(--destructive)",
            }}
            variant="ghost"
          >
            <ThumbsDown aria-hidden />
            <span>{t("knowledge.decision.reject")}</span>
          </Button>
        </div>
      )}
    </li>
  );
}
