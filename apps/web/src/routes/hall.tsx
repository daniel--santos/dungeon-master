import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/hall")({
  component: HallPage,
});

function HallPage() {
  return (
    <PlaceholderPage
      to="/hall"
      note="O catálogo em modo leitura chega ainda nesta fase, em breve."
    />
  );
}
