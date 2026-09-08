import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Footprints } from "lucide-react";
import { useMemo } from "react";

import { Panel } from "@/components/panel";
import { ProposalStatusChip } from "@/components/proposal/proposal-conflict";
import type { RunRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { PROPOSAL_COLOR } from "@/lib/proposal-domain";
import { useKnowledgeCandidates, useProposedTasks } from "@/lib/proposals";

/**
 * O que a Expedição trouxe além do resultado (Fase 5B): as propostas de
 * trabalho e os candidatos a conhecimento gravados no desfecho dela.
 *
 * É um resumo com link, e não a caixa de decisão: a proposta se decide na
 * Campanha ou na Missão de origem, onde mãe e dependências têm contexto. Os
 * candidatos ao Grimório só são contados — a tela deles é da Fase 6.
 *
 * `GET /proposed-tasks` filtra por Task de origem, e não por Run; as
 * propostas desta Expedição são separadas aqui, entre as da Task. Pendência
 * de API registrada no relatório da fase.
 */
export function RunOutcomePanel({ run }: { run: RunRecord }) {
  const { t, format } = useGlossary();
  const proposals = useProposedTasks({ taskId: run.taskId, pageSize: 100 });
  const candidates = useKnowledgeCandidates({ runId: run.id, pageSize: 1 });

  const mine = useMemo(
    () => (proposals.data?.items ?? []).filter((item) => item.originRunId === run.id),
    [proposals.data, run.id],
  );
  const open = mine.filter((item) => item.status === "PROPOSED").length;
  const learned = candidates.data?.total ?? 0;

  if (mine.length === 0 && learned === 0) return null;

  return (
    <Panel className="flex flex-col gap-3 px-5 py-4" data-run-outcome>
      <div className="flex flex-wrap items-center gap-2">
        <Footprints aria-hidden className="size-3.75" style={{ color: PROPOSAL_COLOR }} />
        <span className="text-sm font-medium">
          {format("O que a {run} trouxe", { run: t("entity.run") })}
        </span>
        <span className="flex-1" />
        {run.projectId !== null && open > 0 && (
          <Link
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11.5px] underline-offset-2 hover:underline"
            data-run-outcome-decide
            params={{ id: run.projectId }}
            to="/projects/$id"
          >
            <span>{format("Decidir na {project}", { project: t("entity.project") })}</span>
            <ArrowRight aria-hidden className="size-3" />
          </Link>
        )}
      </div>

      {mine.length > 0 && (
        <div className="flex flex-col gap-1.5" data-run-outcome-proposals={mine.length}>
          <span className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
            {format("{n} {label} · {open} em aberto", {
              n: mine.length,
              label: mine.length === 1 ? t("entity.proposedTask") : t("entity.proposedTask.plural"),
              open,
            })}
          </span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {mine.map((proposal) => (
              <li
                key={proposal.id}
                className="flex items-center gap-2.5"
                data-run-outcome-proposal={proposal.id}
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px]">
                  {proposal.createdTaskId === null ? (
                    proposal.title
                  ) : (
                    <Link
                      className="underline-offset-2 hover:underline"
                      params={{ id: proposal.createdTaskId }}
                      to="/tasks/$id"
                    >
                      {proposal.title}
                    </Link>
                  )}
                </span>
                <ProposalStatusChip status={proposal.status} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {learned > 0 && (
        <div
          className="text-muted-foreground flex items-center gap-2 text-[12px]"
          data-run-outcome-knowledge={learned}
        >
          <BookOpen aria-hidden className="size-3.5" />
          <span>
            {format(
              `${learned === 1 ? t("proposal.knowledge.one") : t("proposal.knowledge.many")}. A destilação para o {knowledge} chega na Fase 6.`,
              { n: learned, knowledge: t("entity.knowledge") },
            )}
          </span>
        </div>
      )}
    </Panel>
  );
}
