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
import { ApiError } from "@/lib/problem";

export interface DeleteRegistryDialogProps {
  /** O registro a apagar: nome para o título, `null` fecha o diálogo. */
  readonly target: { readonly id: string; readonly name: string } | null;
  readonly title: string;
  readonly body: string;
  readonly action: string;
  readonly pending: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Apaga. A promessa rejeita com o erro da API; um `409` fica no diálogo. */
  readonly remove: (id: string) => Promise<void>;
  readonly onDeleted?: () => void;
  readonly done: string;
  readonly [attribute: `data-${string}`]: string | undefined;
}

/**
 * A confirmação antes de apagar um registro do Arsenal (Fase 8C).
 *
 * Ação irreversível pede `AlertDialog`, como apagar um Ritual. O `409` — um
 * Equipamento ainda leva a Habilidade, um Item ainda aponta para a Relíquia,
 * um Patrono ainda pertence ao Patronato — não vira toast: fica no próprio
 * diálogo, com o `detail` da API dizendo qual, porque a resposta muda o que o
 * usuário pode fazer e não só o que aconteceu.
 */
export function DeleteRegistryDialog({
  target,
  title,
  body,
  action,
  pending,
  onOpenChange,
  remove,
  onDeleted,
  done,
  ...rest
}: DeleteRegistryDialogProps) {
  const [inUse, setInUse] = useState<string | null>(null);
  const open = target !== null;

  useEffect(() => {
    if (open) setInUse(null);
  }, [open]);

  function confirm() {
    if (target === null) return;
    remove(target.id).then(
      () => {
        onOpenChange(false);
        toast.success(done);
        onDeleted?.();
      },
      (error: unknown) => {
        if (error instanceof ApiError && error.status === 409) {
          setInUse(error.message);
          return;
        }
        toast.error(error instanceof Error ? error.message : String(error));
        onOpenChange(false);
      },
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent {...rest}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              <p className="font-medium">{target?.name ?? ""}</p>
              <p>{body}</p>
              {inUse !== null && (
                <div
                  className="border-destructive/40 bg-destructive/8 text-foreground flex flex-col gap-1 rounded-[10px] border px-3 py-2.5"
                  data-registry-in-use
                >
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
              disabled={pending}
              onClick={(event) => {
                // O AlertDialog fecha sozinho no clique da ação; segurar o
                // fechamento é o que permite mostrar o 409 no lugar.
                event.preventDefault();
                confirm();
              }}
            >
              <Trash2 aria-hidden />
              <span>{action}</span>
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
