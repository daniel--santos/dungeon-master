import { Link, useRouterState } from "@tanstack/react-router";
import { Fragment, useMemo } from "react";

import { BrandMark } from "@/components/app-shell/brand-mark";
import { NAV_ITEMS, navItemFor } from "@/components/app-shell/navigation";
import { usePendingGates } from "@/lib/approvals";
import { useGlossary } from "@/lib/glossary";
import { usePendingKnowledgeCounts } from "@/lib/knowledge";
import { KNOWLEDGE_PENDING_COLOR } from "@/lib/knowledge-domain";
import { PROPOSAL_COLOR } from "@/lib/proposal-domain";
import { useOpenProposalCount } from "@/lib/proposals";
import { useProjects } from "@/lib/projects";
import { WEB_VERSION } from "@/lib/version";

const AMBER = "var(--accent-amber)";

/** Quantos Projects o contador do Grimório soma. Um usuário só não passa disso. */
const PROJECT_PAGE_SIZE = 100;

/**
 * A barra lateral do design da Fase 1: marca, onze destinos em três grupos e
 * a versão no rodapé.
 *
 * Ícone, rota e ordem são iguais nos dois temas; só o texto do item muda.
 *
 * Três itens carregam contadores, e os três são perguntas que esperam uma
 * resposta humana: o de Expedições, com os Selos pendentes; o de Campanhas,
 * com as propostas de trabalho em aberto (Fase 5B); e o do Grimório, com as
 * Páginas que esperam o Selo do Escriba em todas as Campanhas (Fase 6B). A
 * proposta é decidida na Campanha, onde a mãe e as dependências fazem
 * sentido, e é por isso que o contador mora ali e não em Missões.
 */
export function Sidebar() {
  const { t } = useGlossary();
  const pending = usePendingGates();
  const pendingCount = pending.data?.total ?? 0;
  const proposals = useOpenProposalCount();
  const proposalCount = proposals.data ?? 0;

  // A fila do Grimório é por Project; o contador soma a de todos. O SSE de
  // `knowledge.*` invalida o prefixo, então a soma acompanha cada decisão.
  const projects = useProjects({ pageSize: PROJECT_PAGE_SIZE });
  const projectIds = useMemo(
    () => (projects.data?.items ?? []).map((project) => project.id),
    [projects.data],
  );
  const knowledge = usePendingKnowledgeCounts(projectIds);
  const knowledgeCount = knowledge.total;

  // O Arsenal (Fase 8C) é um item só para quatro rotas; o `activeProps` do
  // Link conhece uma, então o estado ativo dele é decidido aqui pela rota.
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const grouped = navItemFor(pathname);

  return (
    <aside className="bg-card border-border flex w-62 flex-none flex-col border-r">
      <div className="border-border flex h-14 items-center gap-2.5 border-b px-4">
        <BrandMark className="text-foreground size-5" />
        <span className="text-[15px] font-semibold tracking-tight">{t("system.name")}</span>
      </div>

      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-0.5 p-3">
        {NAV_ITEMS.map((item) => (
          <Fragment key={item.to}>
            {item.startsGroup === true && <div aria-hidden className="bg-border mx-1 my-2 h-px" />}
            <Link
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className="flex h-[34px] items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors"
              activeProps={{ className: "bg-muted text-foreground font-medium" }}
              inactiveProps={{
                className:
                  item.matches !== undefined && grouped === item
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
              }}
              {...(item.matches !== undefined && grouped === item
                ? { "data-nav-active": item.to }
                : {})}
            >
              <item.icon aria-hidden className="size-4 flex-none" />
              <span>{t(item.label)}</span>
              {item.to === "/runs" && pendingCount > 0 && (
                <span
                  aria-label={t("approval.pending.title")}
                  className="ml-auto flex h-4.5 min-w-4.5 items-center justify-center rounded-full border px-1.25 font-mono text-[10.5px] leading-none"
                  data-pending-gates-count={pendingCount}
                  style={{
                    borderColor: `color-mix(in oklch, ${AMBER} 45%, transparent)`,
                    backgroundColor: `color-mix(in oklch, ${AMBER} 14%, transparent)`,
                    color: AMBER,
                  }}
                >
                  {pendingCount}
                </span>
              )}
              {item.to === "/knowledge" && knowledgeCount > 0 && (
                <span
                  aria-label={t("knowledge.pending.title")}
                  className="ml-auto flex h-4.5 min-w-4.5 items-center justify-center rounded-full border px-1.25 font-mono text-[10.5px] leading-none"
                  data-pending-knowledge-count={knowledgeCount}
                  style={{
                    borderColor: `color-mix(in oklch, ${KNOWLEDGE_PENDING_COLOR} 45%, transparent)`,
                    backgroundColor: `color-mix(in oklch, ${KNOWLEDGE_PENDING_COLOR} 14%, transparent)`,
                    color: KNOWLEDGE_PENDING_COLOR,
                  }}
                >
                  {knowledgeCount}
                </span>
              )}
              {item.to === "/projects" && proposalCount > 0 && (
                <span
                  aria-label={t("proposal.open.title")}
                  className="ml-auto flex h-4.5 min-w-4.5 items-center justify-center rounded-full border px-1.25 font-mono text-[10.5px] leading-none"
                  data-open-proposals-count={proposalCount}
                  style={{
                    borderColor: `color-mix(in oklch, ${PROPOSAL_COLOR} 45%, transparent)`,
                    backgroundColor: `color-mix(in oklch, ${PROPOSAL_COLOR} 14%, transparent)`,
                    color: PROPOSAL_COLOR,
                  }}
                >
                  {proposalCount}
                </span>
              )}
            </Link>
          </Fragment>
        ))}
      </nav>

      <div className="border-border text-muted-foreground border-t px-4 py-3 text-[11px]">
        {t("system.name")} {WEB_VERSION}
      </div>
    </aside>
  );
}
