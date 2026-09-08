import { Feather } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useGlossary } from "@/lib/glossary";
import { useRequestDistillation } from "@/lib/knowledge";

export interface DistillButtonProps {
  readonly projectId: string;
  readonly className?: string;
  readonly size?: "xs" | "sm";
  readonly variant?: "default" | "outline";
}

/**
 * "Chamar o Escriba": pede um lote do Distiller para o Project (Fase 6B).
 *
 * A API responde `202` na hora, com quantos candidatos esperavam; o lote roda
 * no Worker. O toast diz o que esperar — inclusive que não vai sair nada,
 * quando nenhum candidato está pendente — e o resultado chega depois pelo
 * evento `knowledge.distilled`, que tem toast próprio.
 */
export function DistillButton({
  projectId,
  className,
  size = "sm",
  variant = "default",
}: DistillButtonProps) {
  const { t, format } = useGlossary();
  const distill = useRequestDistillation();

  return (
    <Button
      className={className}
      data-knowledge-distill
      disabled={distill.isPending}
      onClick={() => {
        distill.mutate(projectId, {
          onSuccess: (requested) => {
            toast.success(
              requested.pendingCandidates === 0
                ? t("knowledge.distill.nothing")
                : format(t("knowledge.distill.requested"), { n: requested.pendingCandidates }),
            );
          },
          onError: (error: Error) => {
            toast.error(error.message);
          },
        });
      }}
      size={size}
      variant={variant}
    >
      <Feather aria-hidden />
      <span>{t("knowledge.distill.now")}</span>
    </Button>
  );
}
