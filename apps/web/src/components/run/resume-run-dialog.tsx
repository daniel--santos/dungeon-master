import { useNavigate } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { CopyRow } from "@/components/run/runtime-column";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { RunRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { resumePrompt, useCreateRun } from "@/lib/runs";

export interface ResumeRunDialogProps {
  readonly run: RunRecord;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Retomar a sessão do harness de uma Expedição que não venceu.
 *
 * A retomada é sempre uma Expedição nova, com `attempt` maior: a anterior já
 * terminou e reescrevê-la apagaria a história que Task e Run existem para
 * contar. O que se herda é a sessão da CLI, e com ela o contexto que o agente
 * tinha — o Equipamento e o perfil vêm do Run de origem sem passar por aqui.
 *
 * O prompt abre preenchido e editável pelo mesmo motivo do diálogo de partida:
 * o que estiver escrito é o que o harness recebe, e a instrução de continuar
 * sem dizer de quê costuma render um agente refazendo o começo.
 *
 * A recusa da API vira toast em vez de bloquear o diálogo: um `409` aqui quase
 * sempre é a Task que saiu de `READY`/`FAILED` enquanto a tela estava aberta, e
 * o texto do `detail` diz exatamente isso.
 */
export function ResumeRunDialog({ run, open, onOpenChange }: ResumeRunDialogProps) {
  const { t, format } = useGlossary();
  const navigate = useNavigate();
  const create = useCreateRun();

  const [prompt, setPrompt] = useState("");

  // O prompt nasce a cada abertura: o diagnóstico é o daquela tentativa, e
  // reaproveitar o texto de uma sessão anterior mandaria o agente atrás do erro
  // errado.
  useEffect(() => {
    if (!open) return;
    setPrompt(resumePrompt(run));
  }, [open, run]);

  function resume() {
    create.mutate(
      { taskId: run.taskId, resumeFromRunId: run.id, prompt: prompt.trim() },
      {
        onSuccess: (created) => {
          onOpenChange(false);
          void navigate({ to: "/runs/$id", params: { id: created.id } });
        },
        onError: (error: Error) => {
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{format("Retomar a {run}", { run: t("entity.run") })}</DialogTitle>
          <DialogDescription>
            {format(
              "Parte uma {run} nova que continua a sessão da {harness} {name}, com {attempt} maior. O que a tentativa anterior escreveu continua onde estava.",
              {
                run: t("entity.run"),
                harness: t("entity.harness"),
                name: run.loadoutSnapshot.harness.name,
                attempt: "attempt",
              },
            )}
          </DialogDescription>
        </DialogHeader>

        {run.harnessSessionId !== null && (
          <CopyRow label="Sessão retomada" value={run.harnessSessionId} />
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="resume-prompt">Prompt de continuação</Label>
          <Textarea
            id="resume-prompt"
            maxLength={100_000}
            onChange={(event) => {
              setPrompt(event.target.value);
            }}
            rows={6}
            value={prompt}
          />
          <span className="text-muted-foreground text-[11px] leading-4">
            {format(
              "O diagnóstico da tentativa anterior vem junto: a sessão devolve o histórico da CLI, não a conclusão de quem leu o erro.",
              {},
            )}
          </span>
        </div>

        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
            type="button"
            variant="outline"
          >
            Voltar
          </Button>
          <Button disabled={prompt.trim() === "" || create.isPending} onClick={resume}>
            <Play aria-hidden />
            <span>{format("Retomar a {run}", { run: t("entity.run") })}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
