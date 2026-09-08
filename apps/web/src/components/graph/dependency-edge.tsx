import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { X } from "lucide-react";

import type { TaskFlowEdge } from "@/lib/task-graph-layout";

export interface DependencyEdgeCallbacks {
  /** Pede para desfazer a ligação. Quem confirma é o Mapa, num `AlertDialog`. */
  readonly onRemove: (edgeId: string) => void;
}

/**
 * A aresta de dependência, com o botão de desfazer no meio do traço.
 *
 * O botão existe porque a alternativa — selecionar a aresta e apertar Delete —
 * não é descoberta por ninguém. Ele só pede; a confirmação e a escrita moram no
 * Mapa, que sabe quais são as outras dependências da Task e monta o `PUT`.
 */
export function DependencyEdgeView(callbacks: DependencyEdgeCallbacks) {
  return function DependencyEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    style,
    selected,
  }: EdgeProps<TaskFlowEdge>) {
    const [path, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      borderRadius: 10,
    });

    return (
      <>
        <BaseEdge
          id={id}
          markerEnd={markerEnd}
          path={path}
          style={{ ...style, strokeWidth: selected ? 2.25 : style?.strokeWidth }}
        />
        <EdgeLabelRenderer>
          <button
            aria-label="Desfazer a ligação"
            className="nodrag nopan bg-card border-border text-muted-foreground hover:text-foreground hover:border-ring pointer-events-auto absolute flex size-5 items-center justify-center rounded-full border shadow-sm"
            data-remove-edge={id}
            onClick={(event) => {
              event.stopPropagation();
              callbacks.onRemove(id);
            }}
            style={{
              transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(labelY)}px)`,
            }}
            type="button"
          >
            <X aria-hidden className="size-3" />
          </button>
        </EdgeLabelRenderer>
      </>
    );
  };
}

/** A aresta de hierarquia: tracejada, sem seta, sem botão. Só leitura. */
export function ParentEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
}: EdgeProps<TaskFlowEdge>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 10,
  });

  return <BaseEdge id={id} path={path} style={style} />;
}
