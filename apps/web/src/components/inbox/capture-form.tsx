import { CornerDownLeft } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGlossary } from "@/lib/glossary";
import { useCaptureInbox } from "@/lib/inbox";

/** O limite que a API aplica ao texto da captura. */
const MAX_LENGTH = 200;

/**
 * A entrada rápida: uma linha, Enter, e acabou.
 *
 * Não há campo de projeto, tipo nem prioridade de propósito. Pedir triagem no
 * momento da captura é o que faz a captura não acontecer; a decisão vem depois,
 * quando o item vira trabalho de verdade.
 */
export function CaptureForm() {
  const { t, format } = useGlossary();
  const [text, setText] = useState("");
  const capture = useCaptureInbox();

  const trimmed = text.trim();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (trimmed === "" || capture.isPending) return;

    capture.mutate(trimmed, {
      onSuccess: () => {
        setText("");
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    });
  }

  return (
    <Panel className="flex flex-col gap-3 p-5">
      <form className="flex items-center gap-3" onSubmit={submit}>
        <Input
          aria-label={t("entity.inbox")}
          autoFocus
          className="h-10 flex-1 text-[15px] md:text-[15px]"
          maxLength={MAX_LENGTH}
          onChange={(event) => {
            setText(event.target.value);
          }}
          placeholder={format("O que você não quer esquecer? Vira {task} depois.", {
            task: t("entity.task"),
          })}
          value={text}
        />
        <Button className="h-10" disabled={trimmed === "" || capture.isPending} type="submit">
          Capturar
        </Button>
      </form>

      <div className="text-muted-foreground flex items-center gap-2">
        <CornerDownLeft aria-hidden className="size-3.5" />
        <span className="text-xs">
          {format(
            "Enter captura. Sem {project}, sem tipo, sem prioridade — isso vem quando virar {task}.",
            { project: t("entity.project"), task: t("entity.task") },
          )}
        </span>
      </div>
    </Panel>
  );
}
