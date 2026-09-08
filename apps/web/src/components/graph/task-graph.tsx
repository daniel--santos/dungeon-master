import "@xyflow/react/dist/style.css";

import type { TaskStatus } from "@dungeon-master/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type EdgeTypes,
  type IsValidConnection,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import { Unlink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { DependencyEdgeView, ParentEdge } from "@/components/graph/dependency-edge";
import { TaskNodeView } from "@/components/graph/task-node";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { TaskGraphRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { DependencyCycleError, describeCyclePath, useReplaceDependencies } from "@/lib/task-graph";
import {
  dependenciesOf,
  dependencyEdge,
  layoutTaskGraph,
  type TaskFlowEdge,
  type TaskFlowNode,
} from "@/lib/task-graph-layout";
import { cn } from "@/lib/utils";

const NODE_TYPES: NodeTypes = { task: TaskNodeView };

export interface TaskGraphProps {
  readonly graph: TaskGraphRecord;
  /** Só os nós nestes estados. Vazio é "todos". */
  readonly statuses?: readonly TaskStatus[];
  readonly className?: string;
}

/**
 * O Mapa da Campanha (Fase 5B): o grafo de Tasks de um Project, editável só
 * nas dependências.
 *
 * Ligar dois nós é arrastar da alça direita de um até o outro; a aresta
 * aparece na hora e o `PUT` sai em seguida com o conjunto novo. Se o servidor
 * recusar — um ciclo, com o caminho em `path` — a aresta volta atrás e o
 * motivo vai num toast com os títulos das Tasks do impasse. Desfazer uma
 * aresta remove uma dependência de verdade, então passa por um `AlertDialog`,
 * como toda ação irreversível aqui (decisões de UX da Fase 2). Adicionar não
 * pede confirmação: a aresta nova está à vista e se desfaz num clique.
 *
 * O que não se edita aqui: título, estado, mãe. Isso continua nas telas da
 * Task, e clicar num nó leva até ela. O layout também não se guarda: arrastar
 * um nó só reorganiza a leitura desta sessão.
 */
export function TaskGraph({ graph, statuses, className }: TaskGraphProps) {
  const { t, format } = useGlossary();
  const navigate = useNavigate();
  const replace = useReplaceDependencies();

  const layout = useMemo(() => layoutTaskGraph(graph, { statuses }), [graph, statuses]);
  const titles = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node.title])),
    [graph.nodes],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<TaskFlowNode>(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TaskFlowEdge>(layout.edges);

  // Uma releitura do grafo — pelo SSE, por uma decisão sobre proposta, pela
  // troca do filtro — redesenha tudo a partir do layout novo. As posições
  // arrastadas nesta sessão se perdem, de propósito: o layout não é guardado.
  useEffect(() => {
    setNodes(layout.nodes);
    setEdges(layout.edges);
  }, [layout, setEdges, setNodes]);

  const [removing, setRemoving] = useState<TaskFlowEdge | null>(null);

  // Os tipos de aresta precisam de identidade estável; a função de remover
  // passa por uma ref para o objeto não ser recriado a cada render.
  const onRemoveRef = useRef<(edgeId: string) => void>(() => undefined);
  const edgeTypes = useMemo<EdgeTypes>(
    () => ({
      dependency: DependencyEdgeView({
        onRemove: (edgeId) => {
          onRemoveRef.current(edgeId);
        },
      }),
      parent: ParentEdge,
    }),
    [],
  );
  useEffect(() => {
    onRemoveRef.current = (edgeId) => {
      const edge = edges.find((candidate) => candidate.id === edgeId);
      if (edge !== undefined && edge.data?.kind === "dependency") setRemoving(edge);
    };
  }, [edges]);

  const isValidConnection = useCallback<IsValidConnection<TaskFlowEdge>>(
    (connection) => {
      if (connection.source === connection.target) return false;
      // A mesma aresta duas vezes não diz nada novo; a inversa, e o ciclo
      // que ela fecharia, quem decide é o servidor.
      return !edges.some(
        (edge) =>
          edge.data?.kind === "dependency" &&
          edge.source === connection.source &&
          edge.target === connection.target,
      );
    },
    [edges],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const from = connection.source;
      const to = connection.target;
      const optimistic = dependencyEdge(from, to);
      setEdges((current) => addEdge(optimistic, current));

      replace.mutate(
        { id: to, dependsOn: [...dependenciesOf(graph, to), from] },
        {
          onError: (error: Error) => {
            setEdges((current) => current.filter((edge) => edge.id !== optimistic.id));
            if (error instanceof DependencyCycleError) {
              toast.error(
                format(t("graph.cycle"), { path: describeCyclePath(error.path, titles) }),
                { id: `cycle:${optimistic.id}` },
              );
              return;
            }
            toast.error(error.message);
          },
        },
      );
    },
    [format, graph, replace, setEdges, t, titles],
  );

  function confirmRemoval() {
    if (removing === null) return;
    const edge = removing;
    replace.mutate(
      {
        id: edge.target,
        dependsOn: dependenciesOf(graph, edge.target).filter((id) => id !== edge.source),
      },
      {
        onSuccess: () => {
          setRemoving(null);
          setEdges((current) => current.filter((candidate) => candidate.id !== edge.id));
        },
        onError: (error: Error) => {
          setRemoving(null);
          toast.error(error.message);
        },
      },
    );
  }

  const onNodeClick = useCallback<NodeMouseHandler<TaskFlowNode>>(
    (_event, node) => {
      void navigate({ to: "/tasks/$id", params: { id: node.id } });
    },
    [navigate],
  );

  return (
    <>
      <div
        className={cn("relative w-full", className)}
        data-task-graph={layout.nodes.length}
        data-task-graph-hidden={layout.hidden}
        style={{ height: "calc(100vh - 300px)", minHeight: 440 }}
      >
        <ReactFlow<TaskFlowNode, TaskFlowEdge>
          colorMode="dark"
          connectionRadius={36}
          deleteKeyCode={null}
          edgeTypes={edgeTypes}
          edges={edges}
          edgesReconnectable={false}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          isValidConnection={isValidConnection}
          maxZoom={1.6}
          minZoom={0.2}
          nodeTypes={NODE_TYPES}
          nodes={nodes}
          nodesConnectable
          nodesDraggable
          onConnect={onConnect}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onNodesChange={onNodesChange}
          panOnDrag
          zoomOnDoubleClick={false}
        >
          <Background color="var(--border)" gap={18} size={1.2} />
          <Controls className="!bg-card !border-border !shadow-sm" showInteractive={false} />
        </ReactFlow>
      </div>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        open={removing !== null}
      >
        {removing !== null && (
          <AlertDialogContent data-remove-edge-dialog={removing.id}>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("graph.removeEdge.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {format(t("graph.removeEdge.body"), {
                  from: titles.get(removing.source) ?? removing.source,
                  to: titles.get(removing.target) ?? removing.target,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive/60 hover:bg-destructive/70 text-white"
                data-remove-edge-confirm
                disabled={replace.isPending}
                onClick={(event) => {
                  // O AlertDialog fecha sozinho no clique da ação; segurar o
                  // fechamento deixa o botão desabilitado enquanto o pedido voa.
                  event.preventDefault();
                  confirmRemoval();
                }}
              >
                <Unlink aria-hidden />
                <span>{t("graph.removeEdge.title").replace(/\?$/, "")}</span>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </>
  );
}
