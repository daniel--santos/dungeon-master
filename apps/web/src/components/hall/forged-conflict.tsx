import { Button } from "@/components/ui/button";
import type { ForgedAchievementRecord } from "@/lib/api-types";
import { formatDateTime } from "@/lib/datetime";
import { FORGED_STATUS_LABEL } from "@/lib/forged";
import { useGlossary } from "@/lib/glossary";

export interface ForgedConflictBoxProps {
  /** A forjada como o `409` a trouxe: a verdade do instante da recusa. */
  readonly achievement: ForgedAchievementRecord;
  readonly onDismiss: () => void;
}

/**
 * O aviso de decisão perdida (CAS) sobre uma forjada: outra decisão chegou
 * antes. Mostra o estado em que ela ficou e o instante; nada é sobrescrito.
 */
export function ForgedConflictBox({ achievement, onDismiss }: ForgedConflictBoxProps) {
  const { t, format } = useGlossary();

  return (
    <div
      className="border-destructive/40 bg-destructive/8 flex flex-col gap-2 rounded-[10px] border px-3 py-2.5"
      data-forged-conflict={achievement.reviewStatus}
    >
      <span className="text-[12.5px] leading-4.5 font-medium">
        {format(t("forged.conflict"), {
          status: t(FORGED_STATUS_LABEL[achievement.reviewStatus]).toLowerCase(),
        })}
      </span>
      <span className="text-muted-foreground text-[11px]">
        {achievement.reviewedAt === null
          ? "—"
          : format("Decidido em {when}", { when: formatDateTime(achievement.reviewedAt) })}
      </span>
      <Button className="w-fit" onClick={onDismiss} size="xs" variant="outline">
        Entendi
      </Button>
    </div>
  );
}
