import type { GlossaryKey } from "@dungeon-master/glossary";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { NavPath } from "@/components/app-shell/navigation";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGlossary } from "@/lib/glossary";

/** As quatro abas do Arsenal, na ordem da árvore de Loadout do documento técnico. */
export const REGISTRY_TABS = ["skills", "tools", "mcp-servers", "providers"] as const;

export type RegistryTab = (typeof REGISTRY_TABS)[number];

const TAB: Record<RegistryTab, { readonly to: NavPath; readonly label: GlossaryKey }> = {
  skills: { to: "/skills", label: "entity.skill.plural" },
  tools: { to: "/tools", label: "entity.tool.plural" },
  "mcp-servers": { to: "/mcp-servers", label: "entity.mcpServer.plural" },
  providers: { to: "/providers", label: "entity.provider.plural" },
};

export interface RegistryHeaderProps {
  readonly tab: RegistryTab;
  readonly actions?: ReactNode;
}

/**
 * O cabeçalho do Arsenal (Fase 8C): um título, quatro abas, quatro rotas.
 *
 * Uma entrada só na barra lateral e quatro rotas próprias, em vez de uma
 * tela com abas na URL: cada registro tem link direto (`/skills`, `/tools`,
 * `/mcp-servers`, `/providers`) e a Habilidade ainda tem a página dela em
 * `/skills/:id`. A faixa de abas é o que faz as quatro parecerem uma tela.
 */
export function RegistryHeader({ tab, actions }: RegistryHeaderProps) {
  const { t } = useGlossary();
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        actions={actions}
        description={t("registry.description")}
        title={t("nav.registry")}
      />

      <Tabs
        className="gap-0"
        onValueChange={(next) => {
          void navigate({ to: TAB[next as RegistryTab].to });
        }}
        value={tab}
      >
        <TabsList data-registry-tabs>
          {REGISTRY_TABS.map((id) => (
            <TabsTrigger key={id} data-registry-tab={id} value={id}>
              {t(TAB[id].label)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </>
  );
}
