import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
import type { WorkflowRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { ApiError } from "@/lib/problem";
import { useDeleteWorkflow } from "@/lib/workflows";

export interface DeleteWorkflowDialogProps {
  readonly workflow: WorkflowRecord;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDeleted?: () => void;
}

/**
 * A confirmação antes de apagar um Ritual.
 *
 * Ação irreversível pede `AlertDialog`, como o cancelamento de Expedição. O
 * `409` — alguma versão já foi usada por um Run — não vira toast: ele fica no
 * próprio diálogo, com o texto do glossário explicando por quê, porque a
 * resposta muda o que o usuário pode fazer e não só o que aconteceu.
 */
export function DeleteWorkflowDialog({
  workflow,
  open,
  onOpenChange,
  onDeleted,
}: DeleteWorkflowDialogProps) {
  const { t, format } = useGlossary();
  const remove = useDeleteWorkflow();
  const [inUse, setInUse] = useState<string | null>(null);

  useEffect(() => {
    if (open) setInUse(null);
  }, [open]);

  function confirm() {
    remove.mutate(workflow.id, {
      onSuccess: () => {
        onOpenChange(false);
        toast.success(format("{workflow} apagado.", { workflow: t("entity.workflow") }));
        onDeleted?.();
      },
      onError: (error: Error) => {
        if (error instanceof ApiError && error.status === 409) {
          setInUse(error.message);
          return;
        }
        toast.error(error.message);
        onOpenChange(false);
      },
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("workflow.delete.title")}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              <p className="font-medium">{workflow.name}</p>
              <p>{t("workflow.delete.body")}</p>
              {inUse !== null && (
                <div
                  className="border-destructive/40 bg-destructive/8 text-foreground flex flex-col gap-1 rounded-lg border px-3 py-2.5"
                  data-workflow-in-use
                >
                  <span className="text-[12.5px] font-medium">{t("workflow.delete.inUse")}</span>
                  <span className="text-muted-foreground text-[11.5px] leading-4">{inUse}</span>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          {inUse === null && (
            <AlertDialogAction
              className="bg-destructive/60 hover:bg-destructive/70 text-white"
              disabled={remove.isPending}
              onClick={(event) => {
                // O AlertDialog fecha sozinho no clique da ação; segurar o
                // fechamento é o que permite mostrar o 409 no lugar.
                event.preventDefault();
                confirm();
              }}
            >
              <Trash2 aria-hidden />
              <span>{format("Apagar {workflow}", { workflow: t("entity.workflow") })}</span>
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
