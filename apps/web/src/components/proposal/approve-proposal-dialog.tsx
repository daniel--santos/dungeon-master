import type { TaskKind, TaskPriority } from "@dungeon-master/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ProposalConflictBox } from "@/components/proposal/proposal-conflict";
import { StatusChip } from "@/components/task/chips";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { WorkflowSelect } from "@/components/workflow/workflow-select";
import type {
  ApproveProposedTaskBody,
  ProposedTaskListItemRecord,
  ProposedTaskRecord,
  TaskGraphNodeRecord,
} from "@/lib/api-types";
import { TASK_KIND, TASK_KINDS, TASK_PRIORITIES, TASK_PRIORITY } from "@/lib/domain";
import { useGlossary } from "@/lib/glossary";
import { PROPOSAL_DECISION } from "@/lib/proposal-domain";
import { ProposalConflictError, useApproveProposedTask } from "@/lib/proposals";
import { DependencyCycleError, describeCyclePath, useTaskGraph } from "@/lib/task-graph";
import { cn } from "@/lib/utils";

const NOTE_MAX_LENGTH = 5_000;

/** Os dois valores fixos do seletor de mãe; qualquer outro é o id de uma Task. */
const PARENT_ORIGIN = "__origin__";
const PARENT_NONE = "__none__";

export interface ApproveProposalDialogProps {
  /** A proposta em julgamento. `null` fecha o diálogo. */
  readonly proposal: ProposedTaskListItemRecord | null;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * O diálogo de aprovação (Fase 5B): a proposta vira uma Task de verdade.
 *
 * É um formulário, e não um alerta, porque aprovar é escolher: a mãe (a Task
 * de origem por padrão; "sem mãe" cria no topo do Project), as dependências
 * entre as Tasks do Project, o tipo, a prioridade, o Ritual e a nota. Nada é
 * inferido no servidor, então tudo o que a Task nova vai ter está aqui.
 *
 * A Task de origem entra pré-marcada como dependência **só quando não é a
 * mãe**: a proposta foi encontrada nela e costuma depender do que ela deixar
 * pronto. Quando ela é a mãe, a caixa fica desabilitada, porque uma filha que
 * espera a mãe trava as duas — a mãe só conclui depois das filhas.
 *
 * As Tasks do Project vêm do grafo, e não da lista paginada: o grafo devolve
 * todas de uma vez, e um seletor de dependências com uma página faltando
 * esconderia justamente a Task que o usuário procura.
 */
export function ApproveProposalDialog({ proposal, onOpenChange }: ApproveProposalDialogProps) {
  const open = proposal !== null;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {proposal !== null && <ApproveForm onOpenChange={onOpenChange} proposal={proposal} />}
    </Dialog>
  );
}

function ApproveForm({
  proposal,
  onOpenChange,
}: {
  proposal: ProposedTaskListItemRecord;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, format } = useGlossary();
  const navigate = useNavigate();
  const approve = useApproveProposedTask();
  const graph = useTaskGraph(proposal.projectId);

  const [parent, setParent] = useState<string>(PARENT_ORIGIN);
  const [dependsOn, setDependsOn] = useState<ReadonlySet<string>>(new Set());
  const [kind, setKind] = useState<TaskKind>("FEATURE");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [conflict, setConflict] = useState<ProposedTaskRecord | null>(null);

  // O formulário nasce zerado a cada proposta: o diálogo é montado por
  // proposta, então a chave é o próprio id.
  useEffect(() => {
    setParent(PARENT_ORIGIN);
    setDependsOn(new Set());
    setKind("FEATURE");
    setPriority("MEDIUM");
    setWorkflowId(null);
    setNote("");
    setQ("");
    setConflict(null);
  }, [proposal.id]);

  const nodes = useMemo(() => graph.data?.nodes ?? [], [graph.data]);
  const titles = useMemo(() => new Map(nodes.map((node) => [node.id, node.title])), [nodes]);
  const parentIsOrigin = parent === PARENT_ORIGIN || parent === proposal.originTaskId;

  const candidates = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered =
      needle === "" ? nodes : nodes.filter((node) => node.title.toLowerCase().includes(needle));
    // A de origem vai primeiro: é a que a explicação da dica cita.
    return [...filtered].sort((a, b) => {
      if (a.id === proposal.originTaskId) return -1;
      if (b.id === proposal.originTaskId) return 1;
      return 0;
    });
  }, [nodes, proposal.originTaskId, q]);

  function chooseParent(next: string) {
    setParent(next);
    const nextIsOrigin = next === PARENT_ORIGIN || next === proposal.originTaskId;
    setDependsOn((current) => {
      const copy = new Set(current);
      if (nextIsOrigin) copy.delete(proposal.originTaskId);
      else copy.add(proposal.originTaskId);
      return copy;
    });
  }

  function toggleDependency(id: string, checked: boolean) {
    setDependsOn((current) => {
      const copy = new Set(current);
      if (checked) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (approve.isPending) return;

    const body: ApproveProposedTaskBody = {
      // Chave ausente é "a Task de origem", que é o padrão da API; `null` é
      // "sem mãe". As duas precisam chegar diferentes ao servidor.
      ...(parent === PARENT_ORIGIN ? {} : { parentTaskId: parent === PARENT_NONE ? null : parent }),
      dependsOn: [...dependsOn],
      kind,
      priority,
      ...(workflowId === null ? {} : { workflowId }),
      ...(note.trim() === "" ? {} : { note: note.trim() }),
    };

    approve.mutate(
      { id: proposal.id, body },
      {
        onSuccess: (decided) => {
          onOpenChange(false);
          const createdTaskId = decided.createdTaskId;
          toast.success(t("proposal.approve.done"), {
            description: decided.title,
            ...(createdTaskId === null
              ? {}
              : {
                  action: {
                    label: format("Abrir a {task}", { task: t("entity.task") }),
                    onClick: () => {
                      void navigate({ to: "/tasks/$id", params: { id: createdTaskId } });
                    },
                  },
                }),
          });
        },
        onError: (error: Error) => {
          if (error instanceof ProposalConflictError) {
            setConflict(error.proposedTask);
            return;
          }
          if (error instanceof DependencyCycleError) {
            toast.error(format(t("graph.cycle"), { path: describeCyclePath(error.path, titles) }));
            return;
          }
          toast.error(error.message);
        },
      },
    );
  }

  const decision = PROPOSAL_DECISION.approve;

  return (
    <DialogContent className="sm:max-w-xl" data-approve-proposal={proposal.id}>
      <DialogHeader>
        <DialogTitle>{t(decision.confirmTitle)}</DialogTitle>
        <DialogDescription asChild>
          <div className="flex flex-col gap-1.5">
            <span className="text-foreground font-medium">{proposal.title}</span>
            <span>{t(decision.confirmBody)}</span>
          </div>
        </DialogDescription>
      </DialogHeader>

      {conflict !== null ? (
        <ProposalConflictBox
          onDismiss={() => {
            onOpenChange(false);
          }}
          proposedTask={conflict}
        />
      ) : (
        <form className="flex flex-col gap-4" id="approve-proposal-form" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="approve-proposal-parent">{t("proposal.approve.parent")}</Label>
            <Select onValueChange={chooseParent} value={parent}>
              <SelectTrigger
                aria-label={t("proposal.approve.parent")}
                className="w-full"
                id="approve-proposal-parent"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PARENT_ORIGIN}>
                  {`${t("proposal.approve.parent.origin")} · ${proposal.originTaskTitle}`}
                </SelectItem>
                <SelectItem value={PARENT_NONE}>{t("proposal.approve.parent.none")}</SelectItem>
                {nodes.some((node) => node.id !== proposal.originTaskId) && <SelectSeparator />}
                {nodes
                  .filter((node) => node.id !== proposal.originTaskId)
                  .map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {node.title}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="approve-proposal-dependencies-search">
                {t("proposal.approve.dependsOn")}
              </Label>
              <span className="text-muted-foreground text-[11px]">
                {format(dependsOn.size === 1 ? "{n} marcada" : "{n} marcadas", {
                  n: dependsOn.size,
                })}
              </span>
            </div>
            <Input
              className="h-8"
              id="approve-proposal-dependencies-search"
              onChange={(event) => {
                setQ(event.target.value);
              }}
              placeholder="Buscar por título"
              value={q}
            />
            <div
              className="border-border flex max-h-44 flex-col overflow-y-auto rounded-md border"
              data-approve-proposal-dependencies
            >
              {graph.isPending && (
                <p className="text-muted-foreground m-0 px-3 py-2.5 text-xs">Lendo…</p>
              )}
              {graph.isError && (
                <p className="text-destructive m-0 px-3 py-2.5 text-xs">{graph.error.message}</p>
              )}
              {graph.data !== undefined && candidates.length === 0 && (
                <p className="text-muted-foreground m-0 px-3 py-2.5 text-xs">
                  {format("Nenhuma {task} casa com essa busca.", { task: t("entity.task") })}
                </p>
              )}
              {candidates.map((node) => (
                <DependencyOption
                  key={node.id}
                  checked={dependsOn.has(node.id)}
                  disabled={parentIsOrigin && node.id === proposal.originTaskId}
                  isOrigin={node.id === proposal.originTaskId}
                  node={node}
                  onCheckedChange={(checked) => {
                    toggleDependency(node.id, checked);
                  }}
                />
              ))}
            </div>
            <span className="text-muted-foreground text-[11px] leading-4">
              {parentIsOrigin
                ? t("proposal.approve.dependsOn.parent")
                : t("proposal.approve.dependsOn.hint")}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="approve-proposal-kind">Tipo</Label>
              <Select
                onValueChange={(value) => {
                  setKind(value as TaskKind);
                }}
                value={kind}
              >
                <SelectTrigger aria-label="Tipo" className="w-full" id="approve-proposal-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_KINDS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(TASK_KIND[value].label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="approve-proposal-priority">Prioridade</Label>
              <Select
                onValueChange={(value) => {
                  setPriority(value as TaskPriority);
                }}
                value={priority}
              >
                <SelectTrigger
                  aria-label="Prioridade"
                  className="w-full"
                  id="approve-proposal-priority"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(TASK_PRIORITY[value].label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="approve-proposal-workflow">{t("entity.workflow")}</Label>
            <WorkflowSelect
              id="approve-proposal-workflow"
              onChange={setWorkflowId}
              value={workflowId}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="approve-proposal-note">Nota (opcional)</Label>
            <Textarea
              className="min-h-16 text-[13px]"
              id="approve-proposal-note"
              maxLength={NOTE_MAX_LENGTH}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              placeholder="O que pesou na decisão. Fica registrado junto dela."
              rows={2}
              value={note}
            />
          </div>
        </form>
      )}

      {conflict === null && (
        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
            type="button"
            variant="outline"
          >
            Voltar
          </Button>
          <Button
            className="text-white"
            data-proposal-confirm="approve"
            disabled={approve.isPending}
            form="approve-proposal-form"
            style={{ backgroundColor: decision.color }}
            type="submit"
          >
            <decision.icon aria-hidden />
            <span>{t(decision.label)}</span>
          </Button>
        </DialogFooter>
      )}
    </DialogContent>
  );
}

function DependencyOption({
  node,
  checked,
  disabled,
  isOrigin,
  onCheckedChange,
}: {
  node: TaskGraphNodeRecord;
  checked: boolean;
  disabled: boolean;
  isOrigin: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const { t, format } = useGlossary();
  const id = `approve-proposal-dependency-${node.id}`;

  return (
    <label
      className={cn(
        "border-border flex cursor-pointer items-center gap-2.5 border-b px-3 py-2 last:border-b-0",
        disabled && "cursor-not-allowed opacity-60",
      )}
      data-approve-proposal-dependency={node.id}
      htmlFor={id}
    >
      <Checkbox
        aria-label={node.title}
        checked={checked}
        disabled={disabled}
        id={id}
        onCheckedChange={(next) => {
          onCheckedChange(next === true);
        }}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] leading-4">{node.title}</span>
        {isOrigin && (
          <span className="text-muted-foreground text-[10.5px]">
            {format("{task} de origem", { task: t("entity.task") })}
          </span>
        )}
      </span>
      <StatusChip className="flex-none" status={node.status} />
    </label>
  );
}
