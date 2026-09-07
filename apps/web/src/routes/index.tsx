import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  return <PlaceholderPage to="/" note="O resumo do dia chega ainda nesta fase, em breve." />;
}
