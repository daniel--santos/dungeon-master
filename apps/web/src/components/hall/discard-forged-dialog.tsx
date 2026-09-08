import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ForgedConflictBox } from "@/components/hall/forged-conflict";
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
import type { ForgedAchievementRecord } from "@/lib/api-types";
import { ForgedConflictError, useDiscardForgedAchievement } from "@/lib/forged";
import { useGlossary } from "@/lib/glossary";

export interface DiscardForgedDialogProps {
  /** A forjada em julgamento. `null` fecha o diálogo. */
  readonly achievement: ForgedAchievementRecord | null;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * A confirmação antes de descartar uma Conquista forjada (Fase 2.5C).
 *
 * É um `AlertDialog` porque a decisão é irreversível por contrato: o CAS do
 * servidor nunca sobrescreve uma decisão gravada, e uma forjada descartada
 * não volta à forja nem é renomeada. Se a sua decisão perdeu a corrida, o
 * `409` traz a forjada como ela ficou, e o diálogo mostra esse estado no
 * lugar da pergunta.
 */
export function DiscardForgedDialog({ achievement, onOpenChange }: DiscardForgedDialogProps) {
  const { t, theme } = useGlossary();
  const discard = useDiscardForgedAchievement();
  const [conflict, setConflict] = useState<ForgedAchievementRecord | null>(null);

  const open = achievement !== null;
  useEffect(() => {
    if (!open) return;
    setConflict(null);
  }, [open]);

  function confirm() {
    if (achievement === null) return;
    discard.mutate(achievement.id, {
      onSuccess: () => {
        onOpenChange(false);
        toast.success(t("forged.discard.done"));
      },
      onError: (error: Error) => {
        if (error instanceof ForgedConflictError) {
          setConflict(error.achievement);
          return;
        }
        toast.error(error.message);
        onOpenChange(false);
      },
    });
  }

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      {achievement !== null && (
        <AlertDialogContent data-discard-forged={achievement.id}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("forged.discard.title")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                <p className="text-foreground font-medium">
                  {theme === "dnd" ? achievement.name : achievement.plainName}
                </p>
                <p>{t("forged.discard.body")}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {conflict !== null ? (
            <ForgedConflictBox
              achievement={conflict}
              onDismiss={() => {
                onOpenChange(false);
              }}
            />
          ) : (
            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive/60 hover:bg-destructive/70 text-white"
                data-forged-confirm="discard"
                disabled={discard.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  confirm();
                }}
              >
                <Trash2 aria-hidden />
                <span>{t("forged.decision.discard")}</span>
              </AlertDialogAction>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
