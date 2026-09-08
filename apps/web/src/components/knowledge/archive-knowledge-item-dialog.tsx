import { Archive } from "lucide-react";
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
import type { KnowledgeItemRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { useUpdateKnowledgeItem } from "@/lib/knowledge";

export interface ArchiveKnowledgeItemDialogProps {
  /** O item a arquivar. `null` fecha o diálogo. */
  readonly item: KnowledgeItemRecord | null;
  readonly onOpenChange: (open: boolean) => void;
  /** Chamado depois de arquivar, para quem quiser fechar a gaveta junto. */
  readonly onArchived?: (item: KnowledgeItemRecord) => void;
}

/**
 * A confirmação antes de arquivar um item do Grimório (Fase 6B).
 *
 * Arquivar tem volta (`archived: false` desarquiva), mas tira o item do que o
 * Distiller lê para o resumo e do que a Fase 7 vai reinjetar em prompts; é
 * uma mudança de efeito imediato que merece o `AlertDialog`. Desarquivar não
 * pede confirmação: devolver o que já estava lá não surpreende ninguém.
 */
export function ArchiveKnowledgeItemDialog({
  item,
  onOpenChange,
  onArchived,
}: ArchiveKnowledgeItemDialogProps) {
  const { t } = useGlossary();
  const update = useUpdateKnowledgeItem();

  function confirm() {
    if (item === null) return;
    update.mutate(
      { id: item.id, archived: true },
      {
        onSuccess: (archived) => {
          onOpenChange(false);
          toast.success(t("knowledge.archive.done"));
          onArchived?.(archived);
        },
        onError: (error: Error) => {
          toast.error(error.message);
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <AlertDialog onOpenChange={onOpenChange} open={item !== null}>
      {item !== null && (
        <AlertDialogContent data-archive-knowledge-item={item.id}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("knowledge.archive.title")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                <p className="text-foreground font-medium">{item.title}</p>
                <p>{t("knowledge.archive.body")}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              data-knowledge-confirm="archive"
              disabled={update.isPending}
              onClick={(event) => {
                event.preventDefault();
                confirm();
              }}
            >
              <Archive aria-hidden />
              <span>{t("knowledge.archive.action")}</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
