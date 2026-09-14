import "@xyflow/react/dist/style.css";

import dagre from "@dagrejs/dagre";
import type { WorkflowStepType } from "@dungeon-master/contracts";
import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { useMemo } from "react";

import type { WorkflowDefinitionBody } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";
import { WORKFLOW_STEP_TYPE } from "@/lib/workflow-domain";

/**
 * O grafo de um Ritual, somente leitura (Fase 4C).
 *
 * Não é um editor: o planejamento deixa o editor visual fora de escopo por
 * padrão (CLAUDE.md, seção 12), e a definição continua sendo texto. O que o
 * grafo dá é a leitura que o texto não dá — quem depende de quem, onde está o
 * gate, qual step tem condição. O layout é do dagre, da esquerda para a
 * direita, porque `dependsOn` já é a ordem de leitura.
 */

export interface StepNodeData extends Record<string, unknown> {
  readonly key: string;
  readonly name: string;
  readonly type: WorkflowStepType;
  /** A chave do gate, só num step `approval`. */
  readonly gateKey: string | null;
  /** Quantos predicados o `when` tem. Zero é "roda quando as dependências assentam". */
  readonly conditions: number;
}

type StepNode = Node<StepNodeData, "step">;

const NODE_WIDTH = 208;
const NODE_HEIGHT = 74;

function tint(color: string, percent: number): string {
  return `color-mix(in oklch, ${color} ${String(percent)}%, transparent)`;
}

/** Nós e arestas já posicionados pelo dagre. */
export function layoutDefinition(definition: WorkflowDefinitionBody): {
  nodes: StepNode[];
  edges: Edge[];
} {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 64, marginx: 8, marginy: 8 });

  const known = new Set(definition.steps.map((step) => step.key));

  for (const step of definition.steps) {
    graph.setNode(step.key, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  const edges: Edge[] = [];
  for (const step of definition.steps) {
    for (const dependency of step.dependsOn) {
      // Uma dependência inexistente já foi recusada pela API; se o texto
      // chegou aqui torto por outro caminho, a aresta para o nada é omitida.
      if (!known.has(dependency) || dependency === step.key) continue;
      graph.setEdge(dependency, step.key);
      edges.push({
        id: `${dependency}->${step.key}`,
        source: dependency,
        target: step.key,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--ring)" },
        style: { stroke: "var(--ring)", strokeWidth: 1.25 },
      });
    }
  }

  dagre.layout(graph);

  const nodes = definition.steps.map((step): StepNode => {
    const placed = graph.node(step.key);
    return {
      id: step.key,
      type: "step",
      position: { x: placed.x - NODE_WIDTH / 2, y: placed.y - NODE_HEIGHT / 2 },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      draggable: false,
      selectable: false,
      connectable: false,
      data: {
        key: step.key,
        name: step.name,
        type: step.type,
        gateKey: step.type === "approval" ? step.gateKey : null,
        conditions: step.when?.length ?? 0,
      },
    };
  });

  return { nodes, edges };
}

function StepNodeView({ data }: NodeProps<StepNode>) {
  const { t, format } = useGlossary();
  const { icon: Icon, label, color } = WORKFLOW_STEP_TYPE[data.type];

  return (
    <div
      className="bg-card flex flex-col gap-1.5 rounded-lg border px-3 py-2"
      data-step-node={data.key}
      data-step-type={data.type}
      style={{ width: NODE_WIDTH, borderColor: tint(color, 45) }}
    >
      <Handle className="!opacity-0" position={Position.Left} type="target" />

      <div className="flex items-center gap-2">
        <span
          className="flex size-6 flex-none items-center justify-center rounded-full border"
          style={{ borderColor: tint(color, 40), backgroundColor: tint(color, 12), color }}
        >
          <Icon aria-hidden className="size-3.25" strokeWidth={1.8} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[12.5px] leading-4 font-medium">{data.name}</span>
          <span className="text-muted-foreground truncate font-mono text-[10px]">{data.key}</span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span
          className="flex h-4 items-center rounded-full border px-1.5 text-[9.5px] tracking-[0.04em] uppercase"
          style={{ borderColor: tint(color, 40), color }}
        >
          {t(label)}
        </span>
        {data.gateKey !== null && (
          <span className="border-border text-muted-foreground flex h-4 items-center rounded-full border px-1.5 font-mono text-[9.5px]">
            {data.gateKey}
          </span>
        )}
        {data.conditions > 0 && (
          <span className="border-border text-muted-foreground flex h-4 items-center rounded-full border px-1.5 text-[9.5px]">
            {format(data.conditions === 1 ? "{n} condição" : "{n} condições", {
              n: data.conditions,
            })}
          </span>
        )}
      </div>

      <Handle className="!opacity-0" position={Position.Right} type="source" />
    </div>
  );
}

const NODE_TYPES: NodeTypes = { step: StepNodeView };

export interface WorkflowGraphProps {
  readonly definition: WorkflowDefinitionBody;
  readonly className?: string;
}

export function WorkflowGraph({ definition, className }: WorkflowGraphProps) {
  const { nodes, edges } = useMemo(() => layoutDefinition(definition), [definition]);

  return (
    // A altura vai também em estilo inline: o React Flow mede o contêiner na
    // montagem, e em desenvolvimento a folha do Tailwind pode chegar um
    // instante depois — sem a altura imediata ele avisa que não tem onde desenhar.
    <div className={cn("w-full", className)} data-workflow-graph style={{ height: 320 }}>
      <ReactFlow
        colorMode="dark"
        edges={edges}
        edgesFocusable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1.1 }}
        maxZoom={1.6}
        minZoom={0.3}
        nodeTypes={NODE_TYPES}
        nodes={nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        nodesFocusable={false}
        panOnDrag
        preventScrolling={false}
        zoomOnDoubleClick={false}
        zoomOnScroll={false}
      >
        <Background color="var(--border)" gap={18} size={1.2} />
      </ReactFlow>
    </div>
  );
}
