import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { AppearanceSection } from "@/components/settings/appearance";
import { DiagnosticsSection } from "@/components/settings/diagnostics";
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
      <DiagnosticsSection />
    </>
  );
}
