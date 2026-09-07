import { createFileRoute, Link } from "@tanstack/react-router";
import { Folder, Inbox, ListChecks, type LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { useGlossary } from "@/lib/glossary";
import { useInboxCount } from "@/lib/inbox";
import { useProjects } from "@/lib/projects";
import { useTasks } from "@/lib/tasks";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

/**
 * O resumo do dia, no que a Fase 1 sabe de verdade.
 *
 * Três números, e nenhum a mais: o que está esperando triagem, o que está
 * aberto, e o que está pronto para ser trabalhado. Não há execução ainda, então
 * qualquer métrica de vitória ou tempo médio seria invenção.
 */
function DashboardPage() {
  const { t, format } = useGlossary();

  const captures = useInboxCount();
  const projects = useProjects({ status: "ACTIVE", pageSize: 1 });
  const ready = useTasks({ status: ["READY"], pageSize: 1 });

  return (
    <>
      <PageHeader
        title={t("nav.dashboard")}
        description={format("Onde o trabalho está agora. Sem execução ainda: isso é a Fase 2.", {})}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          icon={Inbox}
          label={t("nav.inbox")}
          note={format("esperando virar {task}", { task: t("entity.task") })}
          to="/inbox"
          value={captures.data}
        />
        <StatCard
          icon={Folder}
          label={t("entity.project.plural")}
          note="ativas agora"
          to="/projects"
          value={projects.data?.total}
        />
        <StatCard
          icon={ListChecks}
          label={t("entity.task.plural")}
          note={format("em {status}", { status: t("task.status.ready") })}
          to="/tasks"
          value={ready.data?.total}
        />
      </div>
    </>
  );
}

interface StatCardProps {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly note: string;
  readonly to: "/inbox" | "/projects" | "/tasks";
  readonly value: number | undefined;
}

function StatCard({ icon: Icon, label, note, to, value }: StatCardProps) {
  return (
    <Link className="no-underline" to={to}>
      <Panel className="hover:border-ring/60 flex h-full flex-col gap-3 p-5 transition-colors">
        <div className="text-muted-foreground flex items-center gap-2">
          <Icon aria-hidden className="size-4" />
          <span className="text-sm">{label}</span>
        </div>
        <span className="text-4xl leading-none font-semibold tabular-nums">
          {value === undefined ? "—" : value}
        </span>
        <span className="text-muted-foreground text-xs">{note}</span>
      </Panel>
    </Link>
  );
}
