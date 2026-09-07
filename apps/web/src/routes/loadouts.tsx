import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/loadouts")({
  component: LoadoutsPage,
});

function LoadoutsPage() {
  return (
    <PlaceholderPage
      to="/loadouts"
      note="O cadastro chega na Fase 2A, pelo mesmo motivo da tela anterior: sem execução, não há combinação a montar."
    />
  );
}
