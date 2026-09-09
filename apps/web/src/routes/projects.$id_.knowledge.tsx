import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BookOpen, ChevronRight } from "lucide-react";
import { useCallback, useMemo } from "react";

import { DecisionsTimeline } from "@/components/knowledge/decisions-timeline";
import { DistillButton } from "@/components/knowledge/distill-button";
import { DistillationBatches } from "@/components/knowledge/distillation-batches";
import { KnowledgeItemSheet } from "@/components/knowledge/knowledge-item-sheet";
import { KnowledgeList, type KnowledgeFilterValue } from "@/components/knowledge/knowledge-list";
import { ReviewQueue } from "@/components/knowledge/review-queue";
import { SummaryPanel } from "@/components/knowledge/summary-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGlossary } from "@/lib/glossary";
import { usePendingKnowledge } from "@/lib/knowledge";
import { KNOWLEDGE_PENDING_COLOR } from "@/lib/knowledge-domain";
import { useProject } from "@/lib/projects";
import { knowledgeSearchSchema, type KnowledgeTab } from "@/lib/search";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/projects/$id_/knowledge")({
  validateSearch: knowledgeSearchSchema,
  component: ProjectKnowledgePage,
});

/**
 * O Grimório da Campanha (Fase 6B): a tela de conhecimento de um Project.
 *
 * Vive na própria URL, `/projects/:id/knowledge`, como o Mapa: um link leva
 * direto a uma Página (`item=`), a uma aba (`tab=`) ou a um filtro. A ordem
 * de cima para baixo é a ordem em que as perguntas chegam: o que o projeto
 * sabe (o resumo), o que espera decisão (a fila), e o resto (a lista, as
 * decisões em ordem, os lotes).
 *
 * As decisões são uma aba aqui, e não uma tela própria: uma decisão é uma
 * Página com tipo próprio, e a gaveta dela é a mesma. O que a aba acrescenta
 * é a ordem cronológica.
 */
function ProjectKnowledgePage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/projects/$id/knowledge" });
  const { t, theme, format } = useGlossary();

  const project = useProject(id);
  const pending = usePendingKnowledge(id);
  const pendingCount = pending.data?.total ?? 0;

  // Memoizado sobre os campos da URL, como em `runs.index.tsx` e `hall.tsx`: um
  // objeto novo a cada render entra em toda dependência lá embaixo.
  const filters = useMemo<KnowledgeFilterValue>(
    () => ({
      type: search.type,
      status: search.status,
      review: search.review,
      q: search.q,
      page: search.page,
    }),
    [search.type, search.status, search.review, search.q, search.page],
  );

  const onFiltersChange = useCallback(
    (next: KnowledgeFilterValue) => {
      void navigate({
        search: (previous) => ({
          ...previous,
          type: next.type,
          status: next.status,
          review: next.review,
          q: next.q,
          page: next.page,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  if (project.isPending) {
    return <p className="text-muted-foreground text-sm">Lendo…</p>;
  }

  if (project.isError) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-destructive text-sm">{project.error.message}</p>
        <Link className="text-sm underline underline-offset-2" to="/projects">
          {t("nav.projects")}
        </Link>
      </div>
    );
  }

  const detail = project.data;

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <nav
          aria-label="Trilha"
          className="text-muted-foreground flex items-center gap-1.5 text-xs"
        >
          <Link className="hover:text-foreground" to="/projects">
            {t("nav.projects")}
          </Link>
          <ChevronRight aria-hidden className="size-3" />
          <Link className="hover:text-foreground" params={{ id }} to="/projects/$id">
            {detail.title}
          </Link>
          <ChevronRight aria-hidden className="size-3" />
          <span className="text-foreground">{t("entity.knowledge")}</span>
        </nav>

        <div className="flex items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-muted-foreground flex items-center gap-1.5 text-[11px] tracking-[0.1em] uppercase">
              <BookOpen aria-hidden className="size-3" />
              <span>{t("entity.project")}</span>
            </span>
            <h1
              className={cn(
                "text-[30px] leading-9 font-semibold",
                theme === "dnd" ? "font-display" : "tracking-[-0.02em]",
              )}
            >
              {t("entity.knowledge")}
            </h1>
            <p className="text-muted-foreground max-w-3xl text-sm leading-5">
              {format(
                "O que {project} já aprendeu com as {runs}. O {scribe} escreve; você decide o que entra.",
                {
                  project: detail.title,
                  runs: t("entity.run.plural"),
                  scribe: t("knowledge.scribe"),
                },
              )}
            </p>
          </div>

          <div className="flex flex-none items-center gap-2 pt-3">
            <DistillButton projectId={id} variant="outline" />
          </div>
        </div>
      </div>

      <SummaryPanel projectId={id} />

      <ReviewQueue projectId={id} />

      <Tabs
        onValueChange={(next) => {
          void navigate({
            search: (previous) => ({ ...previous, tab: next as KnowledgeTab }),
            replace: true,
          });
        }}
        value={search.tab}
      >
        <TabsList>
          <TabsTrigger value="items">{t("knowledge.tab.items")}</TabsTrigger>
          <TabsTrigger value="decisions">
            <span>{t("entity.decision.plural")}</span>
          </TabsTrigger>
          <TabsTrigger value="batches">{t("knowledge.tab.batches")}</TabsTrigger>
          {pendingCount > 0 && (
            <span
              className="ml-1 flex h-4.5 min-w-4.5 items-center justify-center self-center rounded-full border px-1.25 font-mono text-[10.5px] leading-none"
              data-knowledge-pending={pendingCount}
              style={{
                borderColor: `color-mix(in oklch, ${KNOWLEDGE_PENDING_COLOR} 45%, transparent)`,
                backgroundColor: `color-mix(in oklch, ${KNOWLEDGE_PENDING_COLOR} 14%, transparent)`,
                color: KNOWLEDGE_PENDING_COLOR,
              }}
              title={t("knowledge.pending.title")}
            >
              {pendingCount}
            </span>
          )}
        </TabsList>

        <TabsContent value="items">
          <KnowledgeList onChange={onFiltersChange} projectId={id} value={filters} />
        </TabsContent>

        <TabsContent value="decisions">
          <DecisionsTimeline projectId={id} />
        </TabsContent>

        <TabsContent value="batches">
          <DistillationBatches projectId={id} />
        </TabsContent>
      </Tabs>

      <KnowledgeItemSheet
        itemId={search.item ?? null}
        onOpenChange={(open) => {
          if (open) return;
          void navigate({
            search: (previous) => ({ ...previous, item: undefined }),
            replace: true,
          });
        }}
        projectId={id}
      />
    </>
  );
}
