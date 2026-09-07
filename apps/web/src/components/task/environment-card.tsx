import { ShieldAlert } from "lucide-react";

import { Panel } from "@/components/panel";
import { useGlossary } from "@/lib/glossary";

/**
 * O cartão de ambiente, com a regra da seção 14 do planejamento aplicada.
 *
 * Segurança nunca é tematizada a ponto de sumir: o nome do tema vem sempre
 * acompanhado do aviso e do texto canônico em monoespaçada, nos dois modos.
 * Na Fase 1 o valor é fixo — não há execução ainda, e mentir sobre isolamento
 * seria pior do que não mostrar nada.
 */
export function EnvironmentCard() {
  const { t, format } = useGlossary();

  return (
    <Panel className="flex flex-col gap-2.5 px-5 pt-4 pb-4.5">
      <div className="flex items-center gap-2">
        <ShieldAlert aria-hidden className="text-destructive size-3.5" />
        <span className="text-sm font-medium">Ambiente</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-medium">{t("env.host")}</span>
        <span className="text-muted-foreground text-base">·</span>
        <span className="text-destructive text-base">{t("env.host.warning")}</span>
      </div>

      <span className="border-destructive/40 bg-destructive/12 text-destructive flex h-5.5 w-fit items-center rounded-md border px-2 font-mono text-[11px] tracking-[0.04em]">
        {t("env.host.canonical")}
      </span>

      <p className="text-muted-foreground text-xs leading-4.5">
        {format(
          "O {agent} roda direto na sua máquina, com acesso ao disco e à rede do host. A alternativa isolada é {docker} ({canonical}), que chega na Fase 2.",
          {
            agent: t("entity.agent"),
            docker: t("env.docker"),
            canonical: t("env.docker.canonical"),
          },
        )}
      </p>
    </Panel>
  );
}
