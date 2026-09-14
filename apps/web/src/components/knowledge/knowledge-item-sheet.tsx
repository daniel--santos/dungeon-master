import { Link } from "@tanstack/react-router";
import { Archive, ArchiveRestore, PenLine, Stamp, ThumbsDown } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ArchiveKnowledgeItemDialog } from "@/components/knowledge/archive-knowledge-item-dialog";
import { EditKnowledgeItemDialog } from "@/components/knowledge/edit-knowledge-item-dialog";
import { KnowledgeStatusChip, KnowledgeTypeChip } from "@/components/knowledge/knowledge-chips";
import { KnowledgeConflictBox } from "@/components/knowledge/knowledge-conflict";
import { RejectKnowledgeItemDialog } from "@/components/knowledge/reject-knowledge-item-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { KnowledgeItemRecord } from "@/lib/api-types";
import { formatDateTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import {
  KnowledgeConflictError,
  useApproveKnowledgeItem,
  useKnowledgeItem,
  useKnowledgeItems,
  useUpdateKnowledgeItem,
} from "@/lib/knowledge";
import { useKnowledgeCandidates } from "@/lib/proposals";
import { useTask } from "@/lib/tasks";

const ACCENT_GREEN = "var(--accent-green)";

/** Quantos candidatos do Project a gaveta lê para nomear os fundidos. */
const CANDIDATE_PAGE_SIZE = 100;

export interface KnowledgeItemSheetProps {
  /** O item aberto, pela URL. `null` fecha a gaveta. */
  readonly itemId: string | null;
  readonly projectId: string;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * A gaveta de detalhe de um item do Grimório (Fase 6B).
 *
 * Uma gaveta, e não uma página: o item é lido no contexto da lista, e voltar
 * para ela é fechar. O que está aberto vive na URL (`item=`), então um link
 * de fora — o candidato promovido no cockpit — abre a gaveta certa.
 *
 * O conteúdo, escrito por um modelo, é renderizado como texto com as quebras
 * de linha preservadas; nunca como HTML. A proveniência liga a Expedição, a
 * Missão e o lote de origem, e nomeia os candidatos fundidos e, num resumo,
 * as Páginas cobertas.
 *
 * As ações mudam com o estado: em revisão, selar, corrigir e recusar; ativo,
 * corrigir e arquivar (atrás de confirmação); arquivado, devolver ao
 * Grimório; recusado, só leitura.
 */
export function KnowledgeItemSheet({ itemId, projectId, onOpenChange }: KnowledgeItemSheetProps) {
  const { t, format, theme } = useGlossary();
  const item = useKnowledgeItem(itemId);
  const approve = useApproveKnowledgeItem();
  const update = useUpdateKnowledgeItem();

  const [editing, setEditing] = useState<KnowledgeItemRecord | null>(null);
  const [editApprove, setEditApprove] = useState(false);
  const [rejecting, setRejecting] = useState<KnowledgeItemRecord | null>(null);
  const [archiving, setArchiving] = useState<KnowledgeItemRecord | null>(null);
  const [conflict, setConflict] = useState<KnowledgeItemRecord | null>(null);

  const data = item.data;
  const provenance = data?.provenance;

  // Os candidatos do Project, para dar nome aos ids fundidos: a API não tem
  // leitura por id de candidato. Pendência registrada no relatório da fase.
  const candidates = useKnowledgeCandidates({
    projectId,
    pageSize: CANDIDATE_PAGE_SIZE,
  });
  const candidateTitle = useMemo(() => {
    const byId = new Map<string, string>();
    for (const candidate of candidates.data?.items ?? []) byId.set(candidate.id, candidate.title);
    return byId;
  }, [candidates.data]);

  const covered = useKnowledgeItems(provenance?.coveredItemIds ?? []);
  const task = useTask(provenance?.taskId ?? null);

  function seal(current: KnowledgeItemRecord) {
    approve.mutate(
      { id: current.id },
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

  function unarchive(current: KnowledgeItemRecord) {
    update.mutate(
      { id: current.id, archived: false },
      {
        onSuccess: () => {
          toast.success(t("knowledge.unarchive.done"));
        },
        onError: (error: Error) => {
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <>
      <Sheet onOpenChange={onOpenChange} open={itemId !== null}>
        <SheetContent
          className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-2xl"
          data-knowledge-sheet={itemId ?? ""}
        >
          {item.isPending && itemId !== null && (
            <SheetHeader>
              <SheetTitle>{t("entity.knowledgeItem")}</SheetTitle>
              <SheetDescription>Lendo…</SheetDescription>
            </SheetHeader>
          )}

          {item.isError && (
            <SheetHeader>
              <SheetTitle>{t("entity.knowledgeItem")}</SheetTitle>
              <SheetDescription className="text-destructive">{item.error.message}</SheetDescription>
            </SheetHeader>
          )}

          {data !== undefined && provenance !== undefined && (
            <>
              <SheetHeader className="gap-2.5 pr-12">
                <div className="flex flex-wrap items-center gap-2">
                  <KnowledgeTypeChip type={data.type} />
                  <KnowledgeStatusChip status={data.status} />
                  <span className="text-muted-foreground text-[11px]">
                    {format("versão {n}", { n: data.version })}
                  </span>
                </div>
                <SheetTitle
                  className={
                    theme === "dnd" ? "font-display text-[19px] leading-6" : "text-[18px] leading-6"
                  }
                >
                  {data.title}
                </SheetTitle>
                <SheetDescription>
                  {format("Escrita em {created} · última escrita em {updated}", {
                    created: formatDateTime(data.createdAt),
                    updated: formatDateTime(data.updatedAt),
                  })}
                </SheetDescription>
              </SheetHeader>

              <div className="flex flex-col gap-4 px-4 pb-4">
                {conflict !== null && (
                  <KnowledgeConflictBox
                    item={conflict}
                    onDismiss={() => {
                      setConflict(null);
                    }}
                  />
                )}

                {conflict === null && (
                  <div className="flex flex-wrap items-center gap-2" data-knowledge-sheet-actions>
                    {data.status === "PENDING_REVIEW" && (
                      <>
                        <Button
                          className="border"
                          data-knowledge-decision="approve"
                          disabled={approve.isPending}
                          onClick={() => {
                            seal(data);
                          }}
                          size="xs"
                          style={{
                            borderColor: `color-mix(in oklch, ${ACCENT_GREEN} 45%, transparent)`,
                            backgroundColor: `color-mix(in oklch, ${ACCENT_GREEN} 14%, transparent)`,
                            color: ACCENT_GREEN,
                          }}
                          variant="ghost"
                        >
                          <Stamp aria-hidden />
                          <span>{t("knowledge.decision.approve")}</span>
                        </Button>
                        <Button
                          data-knowledge-decision="edit-approve"
                          onClick={() => {
                            setEditApprove(true);
                            setEditing(data);
                          }}
                          size="xs"
                          variant="outline"
                        >
                          <PenLine aria-hidden />
                          <span>{t("knowledge.decision.editApprove")}</span>
                        </Button>
                        <Button
                          className="border"
                          data-knowledge-decision="reject"
                          onClick={() => {
                            setRejecting(data);
                          }}
                          size="xs"
                          style={{
                            borderColor: "color-mix(in oklch, var(--destructive) 45%, transparent)",
                            backgroundColor:
                              "color-mix(in oklch, var(--destructive) 14%, transparent)",
                            color: "var(--destructive)",
                          }}
                          variant="ghost"
                        >
                          <ThumbsDown aria-hidden />
                          <span>{t("knowledge.decision.reject")}</span>
                        </Button>
                      </>
                    )}

                    {data.status === "ACTIVE" && (
                      <>
                        <Button
                          data-knowledge-decision="edit"
                          onClick={() => {
                            setEditApprove(false);
                            setEditing(data);
                          }}
                          size="xs"
                          variant="outline"
                        >
                          <PenLine aria-hidden />
                          <span>{t("knowledge.edit.title")}</span>
                        </Button>
                        {data.type !== "SUMMARY" && (
                          <Button
                            data-knowledge-decision="archive"
                            onClick={() => {
                              setArchiving(data);
                            }}
                            size="xs"
                            variant="ghost"
                          >
                            <Archive aria-hidden />
                            <span>{t("knowledge.archive.action")}</span>
                          </Button>
                        )}
                      </>
                    )}

                    {data.status === "ARCHIVED" && (
                      <Button
                        data-knowledge-decision="unarchive"
                        disabled={update.isPending}
                        onClick={() => {
                          unarchive(data);
                        }}
                        size="xs"
                        variant="outline"
                      >
                        <ArchiveRestore aria-hidden />
                        <span>{t("knowledge.unarchive.action")}</span>
                      </Button>
                    )}
                  </div>
                )}

                {/* Texto escrito por um modelo: renderizado como texto, nunca como HTML. */}
                <p
                  className="m-0 text-[13px] leading-5.5 whitespace-pre-wrap"
                  data-knowledge-sheet-content
                >
                  {data.content}
                </p>

                {data.reviewNote !== null && data.reviewNote !== "" && (
                  <div className="border-border flex flex-col gap-0.5 rounded-md border px-2.5 py-2">
                    <span className="text-muted-foreground text-[10.5px] tracking-[0.06em] uppercase">
                      {format("Nota da revisão · {when}", {
                        when: data.reviewedAt === null ? "—" : formatDateTime(data.reviewedAt),
                      })}
                    </span>
                    <span className="text-[12.5px] leading-4.5 whitespace-pre-wrap">
                      {data.reviewNote}
                    </span>
                  </div>
                )}

                <Separator />

                <section className="flex flex-col gap-2" data-knowledge-provenance>
                  <span className="text-[13px] font-medium">{t("knowledge.provenance.title")}</span>

                  {provenance.runId === null && provenance.taskId === null && (
                    <p className="text-muted-foreground m-0 text-[12.5px] leading-4.5">
                      {t("knowledge.provenance.none")}
                    </p>
                  )}

                  {provenance.runId !== null && (
                    <ProvenanceRow label={t("knowledge.provenance.run")}>
                      <Link
                        className="underline-offset-2 hover:underline"
                        data-knowledge-provenance-run={provenance.runId}
                        params={{ id: provenance.runId }}
                        to="/runs/$id"
                      >
                        {format("Abrir o {cockpit}", { cockpit: t("run.cockpit") })}
                      </Link>
                    </ProvenanceRow>
                  )}

                  {provenance.taskId !== null && (
                    <ProvenanceRow label={t("knowledge.provenance.task")}>
                      <Link
                        className="underline-offset-2 hover:underline"
                        data-knowledge-provenance-task={provenance.taskId}
                        params={{ id: provenance.taskId }}
                        to="/tasks/$id"
                      >
                        {task.data?.title ?? format("Abrir a {task}", { task: t("entity.task") })}
                      </Link>
                    </ProvenanceRow>
                  )}

                  {provenance.distillationRunId !== null && (
                    <ProvenanceRow label={t("knowledge.provenance.batch")}>
                      <Link
                        className="font-mono text-[11.5px] underline-offset-2 hover:underline"
                        data-knowledge-provenance-batch={provenance.distillationRunId}
                        params={{ id: projectId }}
                        from="/projects/$id/knowledge"
                        search={(previous) => ({ ...previous, tab: "batches", item: undefined })}
                        to="/projects/$id/knowledge"
                      >
                        {provenance.distillationRunId.slice(0, 8)}
                      </Link>
                    </ProvenanceRow>
                  )}

                  {provenance.harnessSessionId !== null && (
                    <ProvenanceRow label="Sessão">
                      <code className="font-mono text-[11.5px]">{provenance.harnessSessionId}</code>
                    </ProvenanceRow>
                  )}

                  {provenance.usage !== null && (
                    <ProvenanceRow label="Tokens">
                      <span className="font-mono text-[11.5px]">
                        {format("{in} entrada · {out} saída", {
                          in: provenance.usage.inputTokens,
                          out: provenance.usage.outputTokens,
                        })}
                      </span>
                    </ProvenanceRow>
                  )}

                  {provenance.mergedCandidateIds.length > 0 && (
                    <div
                      className="flex flex-col gap-1"
                      data-knowledge-merged={provenance.mergedCandidateIds.length}
                    >
                      <span className="text-muted-foreground text-xs">
                        {t("knowledge.provenance.merged")}
                      </span>
                      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                        {provenance.mergedCandidateIds.map((candidateId) => (
                          <li
                            className="text-[12.5px]"
                            data-knowledge-merged-candidate={candidateId}
                            key={candidateId}
                          >
                            {candidateTitle.get(candidateId) ?? (
                              <code className="font-mono text-[11.5px]">
                                {candidateId.slice(0, 8)}
                              </code>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {provenance.coveredItemIds.length > 0 && (
                    <div
                      className="flex flex-col gap-1"
                      data-knowledge-covered={provenance.coveredItemIds.length}
                    >
                      <span className="text-muted-foreground text-xs">
                        {t("knowledge.provenance.covered")}
                      </span>
                      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                        {provenance.coveredItemIds.map((coveredId) => (
                          <li className="text-[12.5px]" key={coveredId}>
                            <Link
                              className="underline-offset-2 hover:underline"
                              params={{ id: projectId }}
                              from="/projects/$id/knowledge"
                              search={(previous) => ({ ...previous, item: coveredId })}
                              to="/projects/$id/knowledge"
                            >
                              {covered.get(coveredId)?.title ?? (
                                <code className="font-mono text-[11.5px]">
                                  {coveredId.slice(0, 8)}
                                </code>
                              )}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <EditKnowledgeItemDialog
        approveAfterSave={editApprove}
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
      <ArchiveKnowledgeItemDialog
        item={archiving}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
      />
    </>
  );
}

function ProvenanceRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-muted-foreground flex-none text-xs">{label}</span>
      <span className="min-w-0 truncate text-right text-[12.5px]">{children}</span>
    </div>
  );
}
