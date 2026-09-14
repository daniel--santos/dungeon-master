import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Gauge } from "lucide-react";

import { AutonomyLevelPanel } from "@/components/autonomy/autonomy-level-panel";
import { BreakerList } from "@/components/autonomy/breaker-list";
import { BudgetList } from "@/components/autonomy/budget-list";
import { PolicyList } from "@/components/autonomy/policy-list";
import { RoutingRuleList } from "@/components/autonomy/routing-rule-list";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjectAutonomy } from "@/lib/autonomy";
import { AUTONOMY_COLOR, AUTONOMY_LEVEL } from "@/lib/autonomy-domain";
import { useGlossary } from "@/lib/glossary";
import { useProject } from "@/lib/projects";
import { autonomySearchSchema, type AutonomyScope, type AutonomyTab } from "@/lib/search";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/projects/$id_/autonomy")({
  validateSearch: autonomySearchSchema,
  component: ProjectAutonomyPage,
});

/**
 * A Rédea da Campanha (Fase 9C): a tela de autonomia de um Project.
 *
 * Vive na própria URL, `/projects/:id/autonomy`, como o Grimório e o Mapa:
 * um link leva direto a uma aba (`tab=`) e a um escopo (`scope=`). A ordem
 * das abas é a ordem em que a partida consulta as regras: o nível primeiro,
 * porque é ele que diz se as políticas valem; depois as políticas, os
 * orçamentos, os disjuntores e o roteamento.
 *
 * As regras globais moram aqui também, e não numa aba de Settings: o que
 * decide por esta Campanha é a união das dela com as globais — é exatamente
 * o conjunto que a API consulta —, e ver as duas juntas, com o chip de
 * escopo, é o que deixa prever o que a próxima partida vai fazer. O filtro
 * "todas" abre a vista completa, com as de outras Campanhas e as escopadas
 * por Equipamento ou Guilda, para quem quer o cadastro inteiro.
 */
function ProjectAutonomyPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/projects/$id/autonomy" });
  const { t, theme, format } = useGlossary();

  const project = useProject(id);
  const autonomy = useProjectAutonomy(id);

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
  const level = autonomy.data?.autonomyLevel;

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
          <span className="text-foreground">{t("autonomy.title")}</span>
        </nav>

        <div className="flex items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-muted-foreground flex items-center gap-1.5 text-[11px] tracking-[0.1em] uppercase">
              <Gauge aria-hidden className="size-3" style={{ color: AUTONOMY_COLOR }} />
              <span>{t("entity.project")}</span>
            </span>
            <h1
              className={cn(
                "text-[30px] leading-9 font-semibold",
                theme === "dnd" ? "font-display" : "tracking-[-0.02em]",
              )}
            >
              {t("autonomy.title")}
            </h1>
            <p className="text-muted-foreground max-w-3xl text-sm leading-5">
              {t("autonomy.description")}
            </p>
          </div>

          {level !== undefined && (
            <span
              className="flex flex-none items-center gap-2 self-center rounded-lg border px-2.5 py-1.5 text-[12.5px]"
              data-autonomy-header-level={level}
              style={{
                borderColor: `color-mix(in oklch, ${AUTONOMY_COLOR} 45%, transparent)`,
                color: AUTONOMY_COLOR,
              }}
            >
              <span className="font-mono text-[11px]">{level}</span>
              <span>{t(AUTONOMY_LEVEL[level].label)}</span>
            </span>
          )}
        </div>
      </div>

      <Tabs
        onValueChange={(next) => {
          void navigate({
            search: (previous) => ({ ...previous, tab: next as AutonomyTab }),
            replace: true,
          });
        }}
        value={search.tab}
      >
        <div className="flex flex-wrap items-center gap-3">
          <TabsList data-autonomy-tabs>
            <TabsTrigger data-autonomy-tab="level" value="level">
              {t("autonomy.title")}
            </TabsTrigger>
            <TabsTrigger data-autonomy-tab="policies" value="policies">
              {t("entity.policy.plural")}
            </TabsTrigger>
            <TabsTrigger data-autonomy-tab="budgets" value="budgets">
              {t("entity.budget.plural")}
            </TabsTrigger>
            <TabsTrigger data-autonomy-tab="breakers" value="breakers">
              {t("entity.breaker.plural")}
            </TabsTrigger>
            <TabsTrigger data-autonomy-tab="routing" value="routing">
              {t("entity.routingRule.plural")}
            </TabsTrigger>
          </TabsList>

          {search.tab !== "level" && (
            <Select
              onValueChange={(next) => {
                void navigate({
                  search: (previous) => ({ ...previous, scope: next as AutonomyScope }),
                  replace: true,
                });
              }}
              value={search.scope}
            >
              <SelectTrigger
                aria-label="Escopo"
                className="w-64"
                data-autonomy-scope={search.scope}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project">
                  {format("{scope} · {title}", {
                    scope: t("autonomy.scope.all"),
                    title: detail.title,
                  })}
                </SelectItem>
                <SelectItem value="all">{t("autonomy.scope.everything")}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        <TabsContent value="level">
          <AutonomyLevelPanel projectId={id} />
        </TabsContent>

        <TabsContent value="policies">
          <PolicyList
            autonomy={autonomy.data}
            projectId={id}
            projectTitle={detail.title}
            scope={search.scope}
          />
        </TabsContent>

        <TabsContent value="budgets">
          <BudgetList projectId={id} projectTitle={detail.title} scope={search.scope} />
        </TabsContent>

        <TabsContent value="breakers">
          <BreakerList projectId={id} projectTitle={detail.title} scope={search.scope} />
        </TabsContent>

        <TabsContent value="routing">
          <RoutingRuleList projectId={id} projectTitle={detail.title} scope={search.scope} />
        </TabsContent>
      </Tabs>
    </>
  );
}
