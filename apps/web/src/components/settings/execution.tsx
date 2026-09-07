import { ShieldAlert } from "lucide-react";

import { EnvBadge } from "@/components/execution/env-badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useGlossary } from "@/lib/glossary";
import { useHostAcknowledgement } from "@/lib/settings";

/**
 * A seção "Execução" de Settings: o aceite do modo host, e como revogá-lo.
 *
 * O aceite é lembrado para que o diálogo de partida não pergunte a cada
 * Expedição — perguntar sempre treina o usuário a marcar sem ler. Revogar
 * precisa existir no mesmo lugar, e ser um clique, porque um aceite que não se
 * desfaz não é um aceite.
 *
 * O badge fica aqui mesmo quando o aceite está dado: lembrar a decisão não é o
 * mesmo que esconder o que ela significa.
 */
export function ExecutionSection() {
  const { t, format } = useGlossary();
  const host = useHostAcknowledgement();

  return (
    <section className="bg-card border-border flex max-w-190 flex-col gap-4.5 rounded-[14px] border p-6 shadow-sm">
      <div className="flex flex-col gap-1">
        <span className="text-base font-semibold">Ambiente de execução</span>
        <span className="text-muted-foreground text-[13px]">
          {format("Onde uma {run} roda, e o que você já aceitou sobre isso.", {
            run: t("entity.run"),
          })}
        </span>
      </div>

      <Separator />

      <div className="flex items-start justify-between gap-8">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <ShieldAlert aria-hidden className="text-destructive size-3.5" />
            <span className="text-sm font-medium">
              {format("Aceite de execução {warning}", { warning: t("env.host.warning") })}
            </span>
          </div>

          <span className="text-muted-foreground text-[13px] leading-5">
            {host.acknowledged
              ? format(
                  "O aceite está dado: o {agent} pode rodar direto nesta máquina, com acesso ao disco e à rede. O diálogo de partida não pergunta de novo enquanto ele valer.",
                  { agent: t("entity.agent") },
                )
              : format(
                  "Nenhum aceite dado. A próxima {run} em {host} vai pedir o aceite explícito antes de partir.",
                  { run: t("entity.run"), host: t("env.host") },
                )}
          </span>

          <EnvBadge className="mt-0.5" mode="HOST" size="md" />
        </div>

        {host.acknowledged && (
          <Button
            className="flex-none"
            disabled={host.isLoading || host.isSaving}
            onClick={() => {
              host.set(false);
            }}
            size="sm"
            variant="outline"
          >
            Revogar
          </Button>
        )}
      </div>
    </section>
  );
}
