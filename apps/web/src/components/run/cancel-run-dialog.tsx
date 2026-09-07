import { CircleStop } from "lucide-react";
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
import type { RunRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { useCancelRun } from "@/lib/runs";

export interface CancelRunDialogProps {
  readonly run: RunRecord;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * A confirmação antes de encerrar uma Expedição.
 *
 * Decisão de UX da Fase 2: cancelar abre um diálogo, e não confirma no segundo
 * toque. O que o texto precisa dizer é o que o usuário não consegue adivinhar —
 * que a Task volta para o quadro, que o worktree fica de pé com o trabalho
 * dentro, e que a Expedição só é registrada como cancelada depois que a árvore
 * de processos for confirmada encerrada. Sem essa última frase, os segundos
 * entre o clique e o estado terminal pareceriam uma tela travada.
 *
 * A mutação sai só do botão de confirmação. Abrir o diálogo não pede nada ao
 * servidor, e é isso que separa "pensei em cancelar" de "cancelei".
 */
export function CancelRunDialog({ run, open, onOpenChange }: CancelRunDialogProps) {
  const { t, format } = useGlossary();
  const cancel = useCancelRun();

  function confirm() {
    cancel.mutate(run.id, {
      onSuccess: () => {
        onOpenChange(false);
      },
      onError: (error: Error) => {
        // O `409` de um Run que já terminou é informação, não falha da tela.
        toast.error(error.message);
        onOpenChange(false);
      },
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {format("Cancelar a {run}?", { run: t("entity.run") })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              <p>
                {format("A {task} volta para {ready}", {
                  task: t("entity.task"),
                  ready: t("task.status.ready"),
                })}
                {run.workspacePath === null ? (
                  <>
                    {format(" e nada do que o {agent} escreveu é descartado.", {
                      agent: t("entity.agent"),
                    })}
                  </>
                ) : (
                  <>
                    {format(" e o workspace é preservado: nada do que o {agent} escreveu em ", {
                      agent: t("entity.agent"),
                    })}
                    <code className="border-border text-foreground rounded-md border bg-white/[0.07] px-1.5 py-px font-mono text-[12px]">
                      {run.workspacePath}
                    </code>
                    {" é descartado."}
                  </>
                )}
              </p>
              <p>
                {format(
                  "A {run} fica registrada como {cancelled} só depois que a árvore de processos for confirmada encerrada. Isso leva alguns segundos.",
                  { run: t("entity.run"), cancelled: t("run.status.cancelled") },
                )}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive/60 hover:bg-destructive/70 text-white"
            disabled={cancel.isPending}
            onClick={(event) => {
              // O AlertDialog fecha sozinho no clique da ação; segurar o
              // fechamento deixa o botão desabilitado enquanto o pedido voa.
              event.preventDefault();
              confirm();
            }}
          >
            <CircleStop aria-hidden />
            <span>{format("Cancelar {run}", { run: t("entity.run") })}</span>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
