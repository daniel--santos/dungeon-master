import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/loadouts")({
  component: LoadoutsPage,
});

function LoadoutsPage() {
  return (
    <PlaceholderPage to="/loadouts" note="O cadastro inicial chega ainda nesta fase, em breve." />
  );
}
