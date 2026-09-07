import type { components } from "@dungeon-master/api-client";
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
import { Textarea } from "@/components/ui/textarea";
import { useGlossary } from "@/lib/glossary";
import { useCreateProject, useUpdateProject } from "@/lib/projects";

type Project = components["schemas"]["Project"];

export interface ProjectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Ausente cria; presente edita. */
  readonly project?: Project | null;
}

/** Criar e editar usam o mesmo formulário: os campos são exatamente os mesmos. */
export function ProjectDialog({ open, onOpenChange, project }: ProjectDialogProps) {
  const { t, format } = useGlossary();
  const create = useCreateProject();
  const update = useUpdateProject();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(project?.title ?? "");
    setDescription(project?.description ?? "");
  }, [open, project]);

  const editing = project != null;
  const pending = create.isPending || update.isPending;
  const canSubmit = title.trim() !== "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || pending) return;

    const body = {
      title: title.trim(),
      description: description.trim() === "" ? null : description.trim(),
    };

    const done = {
      onSuccess: () => {
        onOpenChange(false);
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    };

    if (editing) update.mutate({ id: project.id, ...body }, done);
    else create.mutate(body, done);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing
              ? format("Editar {project}", { project: t("entity.project") })
              : format("Nova {project}", { project: t("entity.project") })}
          </DialogTitle>
          <DialogDescription>
            {format("A unidade que guarda o contexto: {tasks}, diário e, na Fase 6, {knowledge}.", {
              tasks: t("entity.task.plural"),
              knowledge: t("entity.knowledge"),
            })}
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" id="project-form" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-title">Título</Label>
            <Input
              autoFocus
              id="project-title"
              maxLength={200}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              value={title}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="project-description">Descrição</Label>
            <Textarea
              id="project-description"
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              rows={4}
              value={description}
            />
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
          <Button disabled={!canSubmit || pending} form="project-form" type="submit">
            {editing ? "Salvar" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
