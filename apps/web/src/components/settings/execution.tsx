import { Check, ShieldAlert, X } from "lucide-react";

import { EnvBadge } from "@/components/execution/env-badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { relativeTime } from "@/lib/datetime";
import { useExecutionProfiles, useHarnesses } from "@/lib/execution";
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
  const harnesses = useHarnesses();
  const profiles = useExecutionProfiles();

  const dockerProfile = (profiles.data?.items ?? []).find(
    (profile) => profile.mode === "DOCKER" && profile.enabled,
  );
  const harnessItems = harnesses.data?.items ?? [];

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

      <Separator />

      <div className="flex flex-col gap-3" data-docker-execution>
        <div className="flex items-start justify-between gap-8">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t("env.docker")}</span>
            <span className="text-muted-foreground text-[13px] leading-5">
              {dockerProfile === undefined
                ? format(
                    "Nenhum perfil em container habilitado. Enquanto não houver um, o diálogo de partida não deixa escolher {docker}.",
                    { docker: t("env.docker") },
                  )
                : format(
                    "O perfil {profile} está habilitado, então a partida pode acontecer dentro de um container. Quais {harnesses} sabem rodar lá é declarado pelo adapter, e não descoberto:",
                    {
                      profile: dockerProfile.name,
                      harnesses: t("entity.harness.plural"),
                    },
                  )}
            </span>
            <EnvBadge className="mt-0.5" mode="DOCKER" size="md" />
          </div>
        </div>

        <ul className="flex flex-col gap-1.5">
          {harnessItems.map((harness) => {
            const supported = harness.capabilities.dockerExecution;
            return (
              <li
                className="border-border flex items-center gap-3 rounded-[10px] border bg-white/[0.025] px-3 py-2"
                data-docker-harness={harness.key}
                key={harness.id}
              >
                <span
                  className={
                    supported ? "text-[oklch(0.72_0.13_150)] flex" : "text-muted-foreground flex"
                  }
                >
                  {supported ? (
                    <Check aria-hidden className="size-3.5" />
                  ) : (
                    <X aria-hidden className="size-3.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px]">{harness.name}</span>
                <span className="text-muted-foreground flex-none text-[11.5px]">
                  {harness.installedVersion ?? "—"}
                </span>
                <span className="text-muted-foreground w-28 flex-none text-right text-[11px]">
                  {harness.checkedAt === null ? "—" : relativeTime(harness.checkedAt)}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Registrado no relatório: a API expõe o preflight do harness
            (`installedVersion`, `checkedAt`) mas não o do Docker — não há rota
            que diga se o daemon está no ar nem qual é a versão dele. O bloco
            mostra o que existe em vez de inventar um verde que não foi medido. */}
        <span className="text-muted-foreground text-[11.5px] leading-4.5">
          {/* Sem o nome do modo aqui: "o preflight do próprio Masmorra selada"
              não é frase. Container é infraestrutura, e infraestrutura não é
              tematizada (planejamento v0.4, seção 14). */}
          A versão e a data acima vêm do preflight de cada CLI. O preflight do container em si ainda
          não é exposto pela API.
        </span>
      </div>
    </section>
  );
}
