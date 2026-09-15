import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { AppearanceSection } from "@/components/settings/appearance";
import { ContextSection } from "@/components/settings/context";
import { DiagnosticsSection } from "@/components/settings/diagnostics";
import { ExecutionSection } from "@/components/settings/execution";
import { KnowledgeSection } from "@/components/settings/knowledge";
import { PricesSection } from "@/components/settings/prices";
import { useGlossary } from "@/lib/glossary";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useGlossary();

  return (
    <>
      <PageHeader
        title={t("nav.settings")}
        description="Preferências desta máquina. Aplicadas na hora, sem recarregar a página."
      />
      <AppearanceSection />
      <ExecutionSection />
      <KnowledgeSection />
      <ContextSection />
      {/* Fase 10B: quanto custa um token de cada Model, e como cada Provider
          fatura. Sem isto, todo custo da Torre de Vigia fica `NOT_MEASURED`. */}
      <PricesSection />
      <DiagnosticsSection />
    </>
  );
}
