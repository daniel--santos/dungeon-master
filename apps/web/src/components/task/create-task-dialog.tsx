import type { TaskKind, TaskPriority } from "@dungeon-master/contracts";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TASK_KIND, TASK_KINDS, TASK_PRIORITIES, TASK_PRIORITY } from "@/lib/domain";
import { useGlossary } from "@/lib/glossary";
import { useProjects } from "@/lib/projects";
import { useCreateTask } from "@/lib/tasks";

export interface CreateTaskDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Preenchido e travado quando a criação já acontece dentro de um Project. */
  readonly projectId?: string;
  readonly onCreated?: (id: string) => void;
}

/**
 * A criação direta, sem passar pela Inbox.
 *
 * O Project é obrigatório: só a captura cria trabalho sem dono, e ela nasce em
 * `INBOX`. O que sai daqui já nasce em `READY`.
 */
export function CreateTaskDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: CreateTaskDialogProps) {
  const { t, format } = useGlossary();
  const create = useCreateTask();
  const projects = useProjects({ status: "ACTIVE" });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState(projectId ?? "");
  const [kind, setKind] = useState<TaskKind>("FEATURE");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setTarget(projectId ?? "");
    setKind("FEATURE");
    setPriority("MEDIUM");
  }, [open, projectId]);

  const options = projects.data?.items ?? [];
  const canSubmit = title.trim() !== "" && target !== "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || create.isPending) return;

    create.mutate(
      {
        projectId: target,
        title: title.trim(),
        description: description.trim() === "" ? null : description.trim(),
        kind,
        priority,
      },
      {
        onSuccess: (task) => {
          onOpenChange(false);
          onCreated?.(task.id);
        },
        onError: (error: Error) => {
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{format("Nova {task}", { task: t("entity.task") })}</DialogTitle>
          <DialogDescription>
            {format("Nasce pronta para ser trabalhada. Escolha onde ela vive.", {})}
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" id="create-task-form" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-task-title">Título</Label>
            <Input
              autoFocus
              id="create-task-title"
              maxLength={200}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              value={title}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-task-description">Descrição</Label>
            <Textarea
              id="create-task-description"
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              rows={4}
              value={description}
            />
          </div>

          {projectId === undefined && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="create-task-project">{t("entity.project")}</Label>
              <Select value={target} onValueChange={setTarget} disabled={options.length === 0}>
                <SelectTrigger className="w-full" id="create-task-project">
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
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="create-task-kind">Tipo</Label>
              <Select
                value={kind}
                onValueChange={(value) => {
                  setKind(value as TaskKind);
                }}
              >
                <SelectTrigger className="w-full" id="create-task-kind">
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
              <Label htmlFor="create-task-priority">Prioridade</Label>
              <Select
                value={priority}
                onValueChange={(value) => {
                  setPriority(value as TaskPriority);
                }}
              >
                <SelectTrigger className="w-full" id="create-task-priority">
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
          <Button disabled={!canSubmit || create.isPending} form="create-task-form" type="submit">
            Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
