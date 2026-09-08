import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ProposalConflictBox } from "@/components/proposal/proposal-conflict";
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
import type { ProposedTaskListItemRecord, ProposedTaskRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { PROPOSAL_DECISION } from "@/lib/proposal-domain";
import { ProposalConflictError, useRejectProposedTask } from "@/lib/proposals";

const NOTE_MAX_LENGTH = 5_000;

export interface RejectProposalDialogProps {
  /** A proposta em julgamento. `null` fecha o diálogo. */
  readonly proposal: ProposedTaskListItemRecord | null;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * A confirmação antes de recusar uma proposta (Fase 5B).
 *
 * É um `AlertDialog`, e não um diálogo comum, porque a decisão é irreversível
 * por contrato: o CAS do servidor nunca sobrescreve uma decisão gravada. A
 * nota é opcional e vai junto. Se a sua decisão perdeu a corrida, o `409`
 * traz a proposta como ela ficou, e o diálogo mostra esse estado no lugar da
 * pergunta, em vez de tentar de novo ou fingir que a sua valeu.
 */
export function RejectProposalDialog({ proposal, onOpenChange }: RejectProposalDialogProps) {
  const { t, format } = useGlossary();
  const reject = useRejectProposedTask();
  const [note, setNote] = useState("");
  const [conflict, setConflict] = useState<ProposedTaskRecord | null>(null);

  const open = proposal !== null;
  useEffect(() => {
    if (!open) return;
    setNote("");
    setConflict(null);
  }, [open]);

  function confirm() {
    if (proposal === null) return;
    reject.mutate(
      { id: proposal.id, note: note.trim() },
      {
        onSuccess: (decided) => {
          onOpenChange(false);
          toast.success(
            format("{status}: {title}", {
              status: t("proposal.status.rejected"),
              title: decided.title,
            }),
          );
        },
        onError: (error: Error) => {
          if (error instanceof ProposalConflictError) {
            setConflict(error.proposedTask);
            return;
          }
          toast.error(error.message);
          onOpenChange(false);
        },
      },
    );
  }

  const decision = PROPOSAL_DECISION.reject;

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      {proposal !== null && (
        <AlertDialogContent data-reject-proposal={proposal.id}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(decision.confirmTitle)}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                <p className="text-foreground font-medium">{proposal.title}</p>
                <p>{t(decision.confirmBody)}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {conflict !== null ? (
            <ProposalConflictBox
              onDismiss={() => {
                onOpenChange(false);
              }}
              proposedTask={conflict}
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px]" htmlFor="reject-proposal-note">
                Nota (opcional)
              </Label>
              <Textarea
                className="min-h-16 text-[13px]"
                id="reject-proposal-note"
                maxLength={NOTE_MAX_LENGTH}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
                placeholder="Por que não seguir. Fica registrada junto da decisão."
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
                data-proposal-confirm="reject"
                disabled={reject.isPending}
                onClick={(event) => {
                  // O AlertDialog fecha sozinho no clique da ação; segurar o
                  // fechamento deixa o botão desabilitado enquanto o pedido voa.
                  event.preventDefault();
                  confirm();
                }}
              >
                <decision.icon aria-hidden />
                <span>{t(decision.label)}</span>
              </AlertDialogAction>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
