import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/inbox")({
  component: InboxPage,
});

function InboxPage() {
  return <PlaceholderPage to="/inbox" note="A captura rápida chega ainda nesta fase, em breve." />;
}
