import { KnowledgeStatusChip } from "@/components/knowledge/knowledge-chips";
import { Button } from "@/components/ui/button";
import type { KnowledgeItemRecord } from "@/lib/api-types";
import { formatDateTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { KNOWLEDGE_STATUS } from "@/lib/knowledge-domain";

export interface KnowledgeConflictBoxProps {
  /** O item como o `409` o trouxe: a verdade do instante da recusa. */
  readonly item: KnowledgeItemRecord;
  readonly onDismiss: () => void;
}

/**
 * O aviso de decisão perdida (CAS): outra decisão chegou antes.
 *
 * Mostra o item como ele ficou, com a nota e o instante da revisão. Nada é
 * sobrescrito, e o botão só fecha o aviso. Mesmo desenho do aviso da proposta
 * e do Selo, porque é o mesmo fato.
 */
export function KnowledgeConflictBox({ item, onDismiss }: KnowledgeConflictBoxProps) {
  const { t, format } = useGlossary();

  return (
    <div
      className="border-destructive/40 bg-destructive/8 flex flex-col gap-2 rounded-[10px] border px-3 py-2.5"
      data-knowledge-conflict={item.status}
    >
      <span className="text-[12.5px] leading-4.5 font-medium">
        {format(t("knowledge.conflict"), {
          status: t(KNOWLEDGE_STATUS[item.status].label).toLowerCase(),
        })}
      </span>
      <KnowledgeStatusChip status={item.status} />
      {item.reviewNote !== null && item.reviewNote !== "" && (
        <span className="text-muted-foreground text-[12px] leading-4.5 whitespace-pre-wrap">
          {item.reviewNote}
        </span>
      )}
      <span className="text-muted-foreground text-[11px]">
        {item.reviewedAt === null
          ? "—"
          : format("Decidido em {when}", { when: formatDateTime(item.reviewedAt) })}
      </span>
      <Button className="w-fit" onClick={onDismiss} size="xs" variant="outline">
        Entendi
      </Button>
    </div>
  );
}
