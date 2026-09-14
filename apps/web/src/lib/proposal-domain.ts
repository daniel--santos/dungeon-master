import type { ProposedTaskStatus } from "@dungeon-master/contracts";
import type { GlossaryKey } from "@dungeon-master/glossary";
import { Footprints, Trash2, type LucideIcon } from "lucide-react";

/**
 * A ponte entre os enums de proposta e o que a tela mostra (Fase 5B).
 *
 * Mesma disciplina de `lib/workflow-domain.ts`: nenhum label escrito, só
 * **chaves** de glossário resolvidas no ponto de render, e todo mapa é um
 * `Record<Enum, …>` para que um valor novo no contrato vire erro de compilação.
 */

const ACCENT_AMBER = "var(--accent-amber)";
const ACCENT_GREEN = "var(--accent-green)";

/** A cor das propostas em toda a interface: o âmbar de "espera uma decisão". */
export const PROPOSAL_COLOR = ACCENT_AMBER;

interface ProposalStatusPresentation {
  readonly label: GlossaryKey;
  readonly dot: string;
  readonly pulse: boolean;
}

export const PROPOSAL_STATUS: Record<ProposedTaskStatus, ProposalStatusPresentation> = {
  PROPOSED: { label: "proposal.status.proposed", dot: ACCENT_AMBER, pulse: true },
  APPROVED: { label: "proposal.status.approved", dot: ACCENT_GREEN, pulse: false },
  REJECTED: { label: "proposal.status.rejected", dot: "var(--destructive)", pulse: false },
};

export type ProposalDecision = "approve" | "reject";

interface DecisionPresentation {
  readonly label: GlossaryKey;
  readonly confirmTitle: GlossaryKey;
  readonly confirmBody: GlossaryKey;
  readonly icon: LucideIcon;
  readonly color: string;
}

export const PROPOSAL_DECISION: Record<ProposalDecision, DecisionPresentation> = {
  approve: {
    label: "proposal.decision.approve",
    confirmTitle: "proposal.approve.title",
    confirmBody: "proposal.approve.body",
    icon: Footprints,
    color: ACCENT_GREEN,
  },
  reject: {
    label: "proposal.decision.reject",
    confirmTitle: "proposal.reject.title",
    confirmBody: "proposal.reject.body",
    icon: Trash2,
    color: "var(--destructive)",
  },
};
