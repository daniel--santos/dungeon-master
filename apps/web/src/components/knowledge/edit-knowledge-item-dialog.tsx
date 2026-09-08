import type { KnowledgeItemType } from "@dungeon-master/contracts";
import { Stamp } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { KnowledgeConflictBox } from "@/components/knowledge/knowledge-conflict";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { KnowledgeItemRecord, UpdateKnowledgeItemBody } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import {
  KnowledgeConflictError,
  useApproveKnowledgeItem,
  useUpdateKnowledgeItem,
} from "@/lib/knowledge";
import { EDITABLE_KNOWLEDGE_TYPES, KNOWLEDGE_TYPE } from "@/lib/knowledge-domain";

const TITLE_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 20_000;

export interface EditKnowledgeItemDialogProps {
  /** O item em edição. `null` fecha o diálogo. */
  readonly item: KnowledgeItemRecord | null;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * "Corrigir antes de selar": depois de salvar, aprova. Só faz sentido para
   * um item em revisão; o botão principal muda de texto para dizer isso.
   */
  readonly approveAfterSave?: boolean;
}

/**
 * Edição de título, conteúdo e tipo de um item do Grimório (Fase 6B).
 *
 * Um diálogo de formulário, e não um alerta: editar tem volta (a versão sobe,
 * o texto anterior não é apagado do histórico de quem o escreveu). O `SUMMARY`
 * edita o texto mas não o tipo: o resumo é regenerado pelo Distiller, e um
 * item comum que virasse `SUMMARY` seria um segundo resumo corrente.
 *
 * Com `approveAfterSave`, o `PATCH` e o `POST /approve` saem em sequência; um
 * `409` na aprovação mostra o item como ficou, porque a correção já foi
 * gravada e o que falhou foi só o Selo.
 */
export function EditKnowledgeItemDialog({
  item,
  onOpenChange,
  approveAfterSave = false,
}: EditKnowledgeItemDialogProps) {
  const { t } = useGlossary();
  const update = useUpdateKnowledgeItem();
  const approve = useApproveKnowledgeItem();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState<KnowledgeItemType>("FACT");
  const [conflict, setConflict] = useState<KnowledgeItemRecord | null>(null);

  const open = item !== null;
  useEffect(() => {
    if (!open || item === null) return;
    setTitle(item.title);
    setContent(item.content);
    setType(item.type);
    setConflict(null);
  }, [open, item]);

  const busy = update.isPending || approve.isPending;
  const summary = item?.type === "SUMMARY";
  const valid = title.trim() !== "" && content.trim() !== "";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (item === null || !valid) return;

    // Só o que mudou vai no corpo: um `PATCH` com o mesmo texto ainda subiria
    // a versão em vão.
    const body: UpdateKnowledgeItemBody = {
      ...(title.trim() === item.title ? {} : { title: title.trim() }),
      ...(content.trim() === item.content ? {} : { content: content.trim() }),
      ...(type === item.type || type === "SUMMARY" ? {} : { type }),
    };

    const afterSave = (saved: KnowledgeItemRecord) => {
      if (!approveAfterSave) {
        onOpenChange(false);
        toast.success(t("knowledge.edit.done"));
        return;
      }
      approve.mutate(
        { id: saved.id },
        {
          onSuccess: () => {
            onOpenChange(false);
            toast.success(t("knowledge.approve.done"));
          },
          onError: (error: Error) => {
            if (error instanceof KnowledgeConflictError) {
              setConflict(error.item);
              return;
            }
            toast.error(error.message);
            onOpenChange(false);
          },
        },
      );
    };

    if (Object.keys(body).length === 0) {
      afterSave(item);
      return;
    }

    update.mutate(
      { id: item.id, ...body },
      {
        onSuccess: afterSave,
        onError: (error: Error) => {
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {item !== null && (
        <DialogContent className="sm:max-w-2xl" data-edit-knowledge-item={item.id}>
          <form className="flex flex-col gap-5" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{t("knowledge.edit.title")}</DialogTitle>
              <DialogDescription>{t("knowledge.edit.body")}</DialogDescription>
            </DialogHeader>

            {conflict !== null ? (
              <KnowledgeConflictBox
                item={conflict}
                onDismiss={() => {
                  onOpenChange(false);
                }}
              />
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-knowledge-title">Título</Label>
                  <Input
                    autoFocus
                    id="edit-knowledge-title"
                    maxLength={TITLE_MAX_LENGTH}
                    onChange={(event) => {
                      setTitle(event.target.value);
                    }}
                    value={title}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-knowledge-type">{t("knowledge.filter.type")}</Label>
                  <Select
                    disabled={summary}
                    onValueChange={(next) => {
                      setType(next as KnowledgeItemType);
                    }}
                    value={type}
                  >
                    <SelectTrigger
                      aria-label={t("knowledge.filter.type")}
                      className="w-full"
                      id="edit-knowledge-type"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {summary && (
                        <SelectItem value="SUMMARY">{t(KNOWLEDGE_TYPE.SUMMARY.label)}</SelectItem>
                      )}
                      {EDITABLE_KNOWLEDGE_TYPES.map((candidate) => (
                        <SelectItem key={candidate} value={candidate}>
                          {t(KNOWLEDGE_TYPE[candidate].label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-knowledge-content">Conteúdo</Label>
                  <Textarea
                    className="max-h-[50vh] min-h-40 font-mono text-[12.5px] leading-5"
                    id="edit-knowledge-content"
                    maxLength={CONTENT_MAX_LENGTH}
                    onChange={(event) => {
                      setContent(event.target.value);
                    }}
                    rows={10}
                    value={content}
                  />
                  <span className="text-muted-foreground text-[11px]">
                    {`${String(content.length)} / ${String(CONTENT_MAX_LENGTH)} · versão ${String(item.version)}`}
                  </span>
                </div>
              </div>
            )}

            {conflict === null && (
              <DialogFooter>
                <Button
                  onClick={() => {
                    onOpenChange(false);
                  }}
                  type="button"
                  variant="ghost"
                >
                  Cancelar
                </Button>
                <Button
                  data-knowledge-confirm={approveAfterSave ? "save-approve" : "save"}
                  disabled={busy || !valid}
                  type="submit"
                >
                  {approveAfterSave && <Stamp aria-hidden />}
                  <span>{approveAfterSave ? t("knowledge.decision.saveApprove") : "Salvar"}</span>
                </Button>
              </DialogFooter>
            )}
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
