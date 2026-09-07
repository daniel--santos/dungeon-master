import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/workflows")({
  component: WorkflowsPage,
});

function WorkflowsPage() {
  return <PlaceholderPage to="/workflows" note="Esta tela chega na Fase 4." />;
}
