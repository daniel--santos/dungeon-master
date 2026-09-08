import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { CandidateStatusChip } from "@/components/knowledge/knowledge-chips";
import type { KnowledgeCandidateRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";

export interface CandidateListProps {
  readonly candidates: readonly KnowledgeCandidateRecord[];
}

/**
 * Os candidatos a conhecimento de uma Expedição, com o que o Distiller
 * decidiu sobre cada um (Fase 6B): pendente, promovido (com o link para a
 * Página), recusado (com o motivo) ou fundido (com o link para a Página em
 * que entrou).
 *
 * O motivo é texto escrito por um modelo e vai como texto, nunca como HTML.
 */
export function CandidateList({ candidates }: CandidateListProps) {
  const { t } = useGlossary();

  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {candidates.map((candidate) => (
        <li
          className="flex flex-col gap-1"
          data-run-outcome-candidate={candidate.id}
          key={candidate.id}
        >
          <div className="flex items-center gap-2.5">
            <span className="min-w-0 flex-1 truncate text-[12.5px]">{candidate.title}</span>
            <CandidateStatusChip status={candidate.status} />
          </div>
          {(candidate.reason !== null || candidate.knowledgeItemId !== null) && (
            <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-[11.5px]">
              {candidate.reason !== null && candidate.reason !== "" && (
                <span className="whitespace-pre-wrap" data-run-outcome-candidate-reason>
                  {candidate.reason}
                </span>
              )}
              {candidate.knowledgeItemId !== null && (
                <Link
                  className="hover:text-foreground flex items-center gap-1 underline-offset-2 hover:underline"
                  data-run-outcome-candidate-item={candidate.knowledgeItemId}
                  params={{ id: candidate.projectId }}
                  search={{ tab: "items", page: 1, item: candidate.knowledgeItemId }}
                  to="/projects/$id/knowledge"
                >
                  <span>{t("knowledge.candidate.openItem")}</span>
                  <ArrowRight aria-hidden className="size-3" />
                </Link>
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
