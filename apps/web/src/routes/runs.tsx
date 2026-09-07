import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/runs")({
  component: RunsPage,
});

function RunsPage() {
  return (
    <PlaceholderPage
      to="/runs"
      note="Esta tela chega na Fase 2, quando o sistema passar a executar trabalho."
    />
  );
}
