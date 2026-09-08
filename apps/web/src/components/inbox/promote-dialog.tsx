import type { components } from "@dungeon-master/api-client";
import type { TaskKind, TaskPriority } from "@dungeon-master/contracts";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { WorkflowSelect } from "@/components/workflow/workflow-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TASK_KIND, TASK_KINDS, TASK_PRIORITIES, TASK_PRIORITY } from "@/lib/domain";
import { useGlossary } from "@/lib/glossary";
import { usePromoteInbox } from "@/lib/inbox";
import { useProjects } from "@/lib/projects";

type Task = components["schemas"]["Task"];

export interface PromoteDialogProps {
  /** A captura sendo promovida. `null` fecha o diálogo. */
  readonly capture: Task | null;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * A triagem de uma captura: onde ela mora, o que ela é, quanto corre e por
 * qual Ritual segue.
 *
 * O projeto é obrigatório porque `READY` sem projeto é um estado que o banco
 * recusa — a captura só existe sem dono enquanto está na Inbox. O Ritual é
 * opcional e só entra no corpo quando escolhido: ausente é a Expedição
 * simples, como na criação de uma Missão.
 */
export function PromoteDialog({ capture, onOpenChange }: PromoteDialogProps) {
  const { t, format } = useGlossary();
  const promote = usePromoteInbox();
  const projects = useProjects({ status: "ACTIVE" });

  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [kind, setKind] = useState<TaskKind>("FEATURE");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [workflowId, setWorkflowId] = useState<string | null>(null);

  // Reabrir o diálogo com outra captura recomeça o formulário; sem isto o
  // título da captura anterior ficaria no campo.
  useEffect(() => {
    if (capture === null) return;
    setTitle(capture.title);
    setKind(capture.kind);
    setPriority(capture.priority);
    setProjectId("");
    setWorkflowId(capture.workflowId);
  }, [capture]);

  const options = projects.data?.items ?? [];
  const canSubmit = capture !== null && projectId !== "" && title.trim() !== "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (capture === null || !canSubmit || promote.isPending) return;

    promote.mutate(
      {
        id: capture.id,
        projectId,
        title: title.trim(),
        kind,
        priority,
        ...(workflowId === null ? {} : { workflowId }),
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
        onError: (error: Error) => {
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <Dialog open={capture !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{format("Virar {task}", { task: t("entity.task") })}</DialogTitle>
          <DialogDescription>
            {format(
              "Escolha onde este item vive e o que ele é. Só depois disto ele deixa de ser uma anotação solta.",
              {},
            )}
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" id="promote-form" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="promote-title">Título</Label>
            <Input
              id="promote-title"
              maxLength={200}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              value={title}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="promote-project">{t("entity.project")}</Label>
            <Select value={projectId} onValueChange={setProjectId} disabled={options.length === 0}>
              <SelectTrigger className="w-full" id="promote-project">
                <SelectValue placeholder="Escolha uma" />
              </SelectTrigger>
              <SelectContent>
                {options.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!projects.isPending && options.length === 0 && (
              <p className="text-muted-foreground text-xs">
                Nada ativo ainda.{" "}
                <Link className="underline underline-offset-2" to="/projects">
                  {format("Comece em {projects}.", { projects: t("entity.project.plural") })}
                </Link>
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="promote-kind">Tipo</Label>
              <Select
                value={kind}
                onValueChange={(value) => {
                  setKind(value as TaskKind);
                }}
              >
                <SelectTrigger className="w-full" id="promote-kind">
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
              <Label htmlFor="promote-priority">Prioridade</Label>
              <Select
                value={priority}
                onValueChange={(value) => {
                  setPriority(value as TaskPriority);
                }}
              >
                <SelectTrigger className="w-full" id="promote-priority">
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
            <Label htmlFor="promote-workflow">{t("entity.workflow")}</Label>
            <WorkflowSelect id="promote-workflow" onChange={setWorkflowId} value={workflowId} />
            <span className="text-muted-foreground text-[11px] leading-4">
              {t("workflow.captureNote")}
            </span>
          </div>
        </form>

        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
            type="button"
            variant="outline"
          >
            Cancelar
          </Button>
          <Button disabled={!canSubmit || promote.isPending} form="promote-form" type="submit">
            {format("Virar {task}", { task: t("entity.task") })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
