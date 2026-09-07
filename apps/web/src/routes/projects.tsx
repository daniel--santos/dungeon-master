import { createFileRoute } from "@tanstack/react-router";

import { PlaceholderPage } from "@/components/placeholder-page";

export const Route = createFileRoute("/projects")({
  component: ProjectsPage,
});

function ProjectsPage() {
  return (
    <PlaceholderPage to="/projects" note="O cadastro completo chega ainda nesta fase, em breve." />
  );
}
