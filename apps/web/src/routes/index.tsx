import { createFileRoute, Link } from "@tanstack/react-router";
import { CirclePlay, Folder, Inbox, ListChecks, type LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { useGlossary } from "@/lib/glossary";
import { useInboxCount } from "@/lib/inbox";
import { useProjects } from "@/lib/projects";
import { useRuns } from "@/lib/runs";
import { useTasks } from "@/lib/tasks";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

/**
 * O resumo do dia, no que o sistema sabe de verdade.
 *
 * Quatro números, e nenhum a mais: o que espera triagem, o que está aberto, o
 * que está pronto para ser trabalhado, e o que está rodando agora. Métrica de
 * vitória ou tempo médio continua fora — ela só diria algo depois de um
 * histórico que ainda não existe.
 */
function DashboardPage() {
  const { t, format } = useGlossary();

  const captures = useInboxCount();
  const projects = useProjects({ status: "ACTIVE", pageSize: 1 });
  const ready = useTasks({ status: ["READY"], pageSize: 1 });
  const running = useRuns({ status: ["RUNNING"], pageSize: 1 });

  return (
    <>
      <PageHeader
        title={t("nav.dashboard")}
        description={format("Onde o trabalho está agora.", {})}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
          note="em atividade"
          to="/projects"
          value={projects.data?.total}
        />
        <StatCard
          icon={ListChecks}
          label={t("entity.task.plural")}
          note={format("no estado {status}", { status: t("task.status.ready") })}
          to="/tasks"
          value={ready.data?.total}
        />
        <StatCard
          icon={CirclePlay}
          label={format("{runs} {status}", {
            runs: t("entity.run.plural"),
            status: t("run.status.running").toLowerCase(),
          })}
          note={format("com o {agent} trabalhando agora", { agent: t("entity.agent") })}
          search={{ status: ["RUNNING"] as const }}
          to="/runs"
          value={running.data?.total}
        />
      </div>
    </>
  );
}

interface StatCardProps {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly note: string;
  readonly to: "/inbox" | "/projects" | "/tasks" | "/runs";
  /** O filtro que o cartão abre já aplicado, como parâmetro de busca tipado. */
  readonly search?: { readonly status: readonly ["RUNNING"] };
  readonly value: number | undefined;
}

function StatCard({ icon: Icon, label, note, to, search, value }: StatCardProps) {
  return (
    <Link className="no-underline" search={search} to={to}>
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
