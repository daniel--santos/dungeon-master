import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/agents")({
  component: AgentsPage,
});

function AgentsPage() {
  return (
    <PlaceholderPage
      to="/agents"
      note="O cadastro chega na Fase 2A, quando as entidades de que ele depende passarem a existir. Sem execução, ainda não há o que configurar."
    />
  );
}
