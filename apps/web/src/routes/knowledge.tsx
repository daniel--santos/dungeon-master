import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Gavel, ScrollText, Stamp } from "lucide-react";
import { useMemo } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import type { ProjectSummaryRecord } from "@/lib/api-types";
import { relativeTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { usePendingKnowledgeCounts, useProjectSummaries } from "@/lib/knowledge";
import { KNOWLEDGE_COLOR, KNOWLEDGE_PENDING_COLOR } from "@/lib/knowledge-domain";
import { useProjects } from "@/lib/projects";
import { cn } from "@/lib/utils";

/** Quantos Projects a visão geral lê. Um sistema de um usuário só não passa disso. */
const PROJECT_PAGE_SIZE = 100;

export const Route = createFileRoute("/knowledge")({
  component: KnowledgePage,
});

/**
 * A visão geral do Grimório (Fase 6B): todas as Campanhas, com o quanto cada
 * uma já sabe e o quanto espera decisão, e os atalhos para o Grimório de cada
 * uma.
 *
 * Não existe uma leitura "todos os itens de todos os Projects" na API — o
 * Grimório é por Project, e é assim que a Fase 7 vai lê-lo. Esta tela junta
 * o resumo e a fila de cada um; são poucas leituras, e o cache é o mesmo da
 * tela de detalhe.
 */
function KnowledgePage() {
  const { t, format, theme } = useGlossary();
  const projects = useProjects({ pageSize: PROJECT_PAGE_SIZE });
  const items = useMemo(() => projects.data?.items ?? [], [projects.data]);
  const ids = useMemo(() => items.map((project) => project.id), [items]);

  const summaries = useProjectSummaries(ids);
  const pending = usePendingKnowledgeCounts(ids);

  const rows = useMemo(
    () =>
      [...items].sort((a, b) => {
        // Quem espera decisão sobe; entre iguais, quem tem mais Páginas ativas.
        const pendingDiff = (pending.byProject.get(b.id) ?? 0) - (pending.byProject.get(a.id) ?? 0);
        if (pendingDiff !== 0) return pendingDiff;
        const activeDiff =
          (summaries.get(b.id)?.activeItemCount ?? 0) - (summaries.get(a.id)?.activeItemCount ?? 0);
        if (activeDiff !== 0) return activeDiff;
        return a.title.localeCompare(b.title);
      }),
    [items, pending.byProject, summaries],
  );

  return (
    <>
      <PageHeader
        title={t("nav.knowledge")}
        description={t("knowledge.overview.description")}
        actions={
          pending.total > 0 ? (
            <span
              className="flex items-center gap-2 text-[13px]"
              data-knowledge-pending-total={pending.total}
              style={{ color: KNOWLEDGE_PENDING_COLOR }}
            >
              <Stamp aria-hidden className="size-3.5" />
              <span>{format(t("knowledge.count.pending"), { n: pending.total })}</span>
            </span>
          ) : undefined
        }
      />

      {projects.isError && <p className="text-destructive text-sm">{projects.error.message}</p>}
      {projects.isPending && <p className="text-muted-foreground text-sm">Lendo…</p>}

      {!projects.isPending && !projects.isError && rows.length === 0 && (
        <Panel>
          <EmptyState icon={BookOpen} title={t("entity.knowledge")}>
            {t("knowledge.overview.empty")}
          </EmptyState>
        </Panel>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((project) => (
            <ProjectCard
              key={project.id}
              pending={pending.byProject.get(project.id)}
              projectId={project.id}
              summary={summaries.get(project.id)}
              themed={theme === "dnd"}
              title={project.title}
              archived={project.status === "ARCHIVED"}
            />
          ))}
        </div>
      )}
    </>
  );
}

function ProjectCard({
  projectId,
  title,
  archived,
  summary,
  pending,
  themed,
}: {
  projectId: string;
  title: string;
  archived: boolean;
  summary: ProjectSummaryRecord | undefined;
  pending: number | undefined;
  themed: boolean;
}) {
  const { t, format } = useGlossary();
  const item = summary?.item ?? null;

  return (
    <Panel
      className={cn("flex flex-col gap-3 p-4", archived && "opacity-70")}
      data-knowledge-project={projectId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
            {t("entity.project")}
          </span>
          <Link
            className={cn(
              "truncate text-[16px] leading-5.5 font-semibold underline-offset-2 hover:underline",
              themed && "font-display",
            )}
            params={{ id: projectId }}
            to="/projects/$id"
          >
            {title}
          </Link>
        </div>
        <span
          className="flex size-8 flex-none items-center justify-center rounded-full"
          style={{
            border: `1px solid color-mix(in oklab, ${KNOWLEDGE_COLOR} 40%, transparent)`,
            background: `color-mix(in oklab, ${KNOWLEDGE_COLOR} 12%, transparent)`,
            color: KNOWLEDGE_COLOR,
          }}
        >
          <BookOpen aria-hidden className="size-4" />
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <span
          className="text-muted-foreground"
          data-knowledge-project-active={summary?.activeItemCount ?? 0}
        >
          {summary === undefined
            ? "…"
            : format(t("knowledge.count.active"), { n: summary.activeItemCount })}
        </span>
        {pending !== undefined && pending > 0 && (
          <span
            className="flex items-center gap-1"
            data-knowledge-project-pending={pending}
            style={{ color: KNOWLEDGE_PENDING_COLOR }}
          >
            <Stamp aria-hidden className="size-3" />
            <span>{format(t("knowledge.count.pending"), { n: pending })}</span>
          </span>
        )}
      </div>

      <div className="text-muted-foreground flex items-center gap-1.5 text-[12px]">
        <ScrollText aria-hidden className="size-3" />
        <span>
          {item === null
            ? t("knowledge.overview.noSummary")
            : format(t("knowledge.overview.summaryAt"), { when: relativeTime(item.updatedAt) })}
        </span>
      </div>

      {/* Texto escrito por um modelo: renderizado como texto, nunca como HTML. */}
      {item !== null && (
        <p className="text-muted-foreground m-0 line-clamp-3 text-[12.5px] leading-4.5 whitespace-pre-wrap">
          {item.content}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Button asChild size="xs" variant="outline">
          <Link
            data-knowledge-project-open
            params={{ id: projectId }}
            search={{ tab: "items", page: 1 }}
            to="/projects/$id/knowledge"
          >
            <span>{t("knowledge.overview.open")}</span>
            <ArrowRight aria-hidden />
          </Link>
        </Button>
        <Button asChild size="xs" variant="ghost">
          <Link
            params={{ id: projectId }}
            search={{ tab: "decisions", page: 1 }}
            to="/projects/$id/knowledge"
          >
            <Gavel aria-hidden />
            <span>{t("entity.decision.plural")}</span>
          </Link>
        </Button>
      </div>
    </Panel>
  );
}
