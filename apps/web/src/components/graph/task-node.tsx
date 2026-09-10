import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Footprints, WandSparkles } from "lucide-react";

import { PriorityText } from "@/components/task/chips";
import { TASK_KIND, TASK_STATUS } from "@/lib/domain";
import { useGlossary } from "@/lib/glossary";
import { PROPOSAL_COLOR } from "@/lib/proposal-domain";
import { NODE_WIDTH, type TaskFlowNode } from "@/lib/task-graph-layout";
import { cn } from "@/lib/utils";

/**
 * Uma Task como cartão compacto do Mapa (Fase 5B).
 *
 * O estado usa a mesma cor do ponto dos chips das listas, para o Mapa e a
 * tabela contarem a mesma história. A marca de Ritual e a de propostas
 * abertas são ícones, iguais nos dois temas; o texto delas vai no `title`.
 *
 * As duas alças ficam visíveis de propósito: a da direita é de onde se
 * arrasta para dizer "esta termina antes daquela", e a da esquerda é onde a
 * ligação chega. Sem elas à vista, ninguém descobriria que o Mapa se edita.
 */
export function TaskNodeView({ data, selected }: NodeProps<TaskFlowNode>) {
  const { t } = useGlossary();
  const { task } = data;
  const status = TASK_STATUS[task.status];
  const { icon: KindIcon, label: kindLabel } = TASK_KIND[task.kind];
  const closed = task.status === "COMPLETED" || task.status === "CANCELLED";

  return (
    <div
      className={cn(
        "bg-card border-border flex flex-col gap-1.5 rounded-lg border px-3 py-2 shadow-sm transition-[border-color,box-shadow]",
        "hover:border-ring",
        selected && "border-ring ring-ring/40 ring-2",
        closed && "opacity-75",
      )}
      data-task-node={task.id}
      data-task-node-status={task.status}
      style={{ width: NODE_WIDTH }}
    >
      <Handle
        className="!bg-background !border-ring !size-2.5 !border"
        data-task-handle="target"
        position={Position.Left}
        type="target"
      />

      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-1.25 size-2 flex-none rounded-full"
          style={{ backgroundColor: status.dot }}
        />
        <span className="line-clamp-2 min-w-0 flex-1 text-[12.5px] leading-4 font-medium">
          {task.title}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={cn("text-[10.5px] whitespace-nowrap", status.dim && "text-muted-foreground")}
        >
          {t(status.label)}
        </span>
        <span aria-hidden className="text-muted-foreground text-[10px]">
          ·
        </span>
        <PriorityText className="text-[10.5px]" priority={task.priority} />
        <span
          className="text-muted-foreground flex items-center gap-1 text-[10.5px]"
          title={t(kindLabel)}
        >
          <KindIcon aria-hidden className="size-3" strokeWidth={1.6} />
        </span>
        <span className="flex-1" />
        {task.workflowId !== null && (
          <span
            className="text-muted-foreground flex items-center"
            data-task-node-workflow
            title={t("entity.workflow")}
          >
            <WandSparkles aria-hidden className="size-3" strokeWidth={1.6} />
            <span className="sr-only">{t("entity.workflow")}</span>
          </span>
        )}
        {task.hasOpenProposals && (
          <span
            className="flex items-center"
            data-task-node-proposals
            style={{ color: PROPOSAL_COLOR }}
            title={t("graph.openProposals")}
          >
            <Footprints aria-hidden className="size-3" strokeWidth={1.8} />
            <span className="sr-only">{t("graph.openProposals")}</span>
          </span>
        )}
      </div>

      <Handle
        className="!bg-background !border-ring !size-2.5 !border"
        data-task-handle="source"
        position={Position.Right}
        type="source"
      />
    </div>
  );
}
