import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/agents")({
  component: AgentsPage,
});

function AgentsPage() {
  return (
    <PlaceholderPage to="/agents" note="O cadastro inicial chega ainda nesta fase, em breve." />
  );
}
