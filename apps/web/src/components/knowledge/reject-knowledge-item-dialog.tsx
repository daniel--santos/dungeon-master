import { ThumbsDown } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { KnowledgeConflictBox } from "@/components/knowledge/knowledge-conflict";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { KnowledgeItemRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { KnowledgeConflictError, useRejectKnowledgeItem } from "@/lib/knowledge";

const NOTE_MAX_LENGTH = 5_000;

export interface RejectKnowledgeItemDialogProps {
  /** O item em julgamento. `null` fecha o diálogo. */
  readonly item: KnowledgeItemRecord | null;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * A confirmação antes de recusar um item do Grimório (Fase 6B).
 *
 * É um `AlertDialog` porque a decisão é irreversível por contrato: o CAS do
 * servidor nunca sobrescreve uma decisão gravada, e um item recusado não
 * volta à fila. A nota é opcional e fica no item. Se a sua decisão perdeu a
 * corrida, o `409` traz o item como ele ficou, e o diálogo mostra esse estado
 * no lugar da pergunta.
 */
export function RejectKnowledgeItemDialog({ item, onOpenChange }: RejectKnowledgeItemDialogProps) {
  const { t } = useGlossary();
  const reject = useRejectKnowledgeItem();
  const [note, setNote] = useState("");
  const [conflict, setConflict] = useState<KnowledgeItemRecord | null>(null);

  const open = item !== null;
  useEffect(() => {
    if (!open) return;
    setNote("");
    setConflict(null);
  }, [open]);

  function confirm() {
    if (item === null) return;
    reject.mutate(
      { id: item.id, note },
      {
        onSuccess: () => {
          onOpenChange(false);
          toast.success(t("knowledge.reject.done"));
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
  }

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      {item !== null && (
        <AlertDialogContent data-reject-knowledge-item={item.id}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("knowledge.reject.title")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                <p className="text-foreground font-medium">{item.title}</p>
                <p>{t("knowledge.reject.body")}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {conflict !== null ? (
            <KnowledgeConflictBox
              item={conflict}
              onDismiss={() => {
                onOpenChange(false);
              }}
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px]" htmlFor="reject-knowledge-note">
                Nota (opcional)
              </Label>
              <Textarea
                className="min-h-16 text-[13px]"
                id="reject-knowledge-note"
                maxLength={NOTE_MAX_LENGTH}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
                placeholder="Por que não entra. Fica registrada no item."
                rows={2}
                value={note}
              />
            </div>
          )}

          {conflict === null && (
            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive/60 hover:bg-destructive/70 text-white"
                data-knowledge-confirm="reject"
                disabled={reject.isPending}
                onClick={(event) => {
                  // O AlertDialog fecha sozinho no clique da ação; segurar o
                  // fechamento deixa o botão desabilitado enquanto o pedido voa.
                  event.preventDefault();
                  confirm();
                }}
              >
                <ThumbsDown aria-hidden />
                <span>{t("knowledge.decision.reject")}</span>
              </AlertDialogAction>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
