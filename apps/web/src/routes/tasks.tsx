import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/tasks")({
  component: TasksPage,
});

function TasksPage() {
  return (
    <PlaceholderPage to="/tasks" note="A lista com filtros chega ainda nesta fase, em breve." />
  );
}
