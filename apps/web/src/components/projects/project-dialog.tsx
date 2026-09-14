import type { WorkspaceKind } from "@dungeon-master/contracts";
import { useEffect, useMemo, useState, type FormEvent } from "react";
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
import type { ProjectRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { useHydratedForm } from "@/lib/hydrated-form";
import { useCreateProject, useUpdateProject } from "@/lib/projects";
import { looksAbsolutePath, WORKSPACE_KIND, WORKSPACE_KINDS } from "@/lib/workspace";

export interface ProjectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Ausente cria; presente edita. */
  readonly project?: ProjectRecord | null;
}

/**
 * Criar e editar usam o mesmo formulário; o workspace só aparece ao editar.
 *
 * `POST /projects` aceita título e descrição, e nada mais: apontar o diretório é
 * uma decisão sobre a máquina local, que a API confere no disco antes de gravar.
 * Pedi-la na criação obrigaria a mandar duas requisições atrás de um botão só, e
 * a segunda poderia falhar sozinha — o Project existiria com um workspace que o
 * usuário acha que configurou.
 */
export function ProjectDialog({ open, onOpenChange, project }: ProjectDialogProps) {
  const { t, format } = useGlossary();
  const create = useCreateProject();
  const update = useUpdateProject();

  const [pathError, setPathError] = useState<string | null>(null);

  // A hidratação é da **abertura**, e não da identidade do registro: na tela de
  // detalhe o Project chega vivo, e qualquer evento do SSE que invalide
  // `["projects"]` devolve outro objeto (contagens e `updatedAt` mudam sozinhos)
  // enquanto o usuário digita o caminho do workspace.
  const server = useMemo(
    () => ({
      title: project?.title ?? "",
      description: project?.description ?? "",
      workspaceKind: project?.workspaceKind ?? ("GIT_REPO" as WorkspaceKind),
      workspacePath: project?.workspacePath ?? "",
    }),
    [project?.title, project?.description, project?.workspaceKind, project?.workspacePath],
  );
  const { value, set: setForm } = useHydratedForm(
    server,
    open ? (project?.id ?? "novo") : "closed",
  );
  const { title, description, workspaceKind, workspacePath } = value ?? server;

  useEffect(() => {
    if (open) setPathError(null);
  }, [open]);

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

    if (!editing) {
      create.mutate(body, done);
      return;
    }

    const path = workspacePath.trim();
    if (path !== "" && !looksAbsolutePath(path)) {
      setPathError(
        "O caminho precisa ser absoluto: D:\\Dev\\meu-projeto no Windows, /home/voce/projeto no macOS.",
      );
      return;
    }

    setPathError(null);
    update.mutate(
      { id: project.id, ...body, workspaceKind, workspacePath: path === "" ? null : path },
      {
        onSuccess: done.onSuccess,
        // A recusa da API é sobre o caminho — relativo, com `..` ou apontando
        // para um diretório que não existe — e o `detail` diz qual dos três.
        // Ele fica junto do campo, e não num toast que some.
        onError: (error: Error) => {
          setPathError(error.message);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing
              ? format("Editar {project}", { project: t("entity.project") })
              : format("Criar {project}", { project: t("entity.project") })}
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
                const next = event.target.value;
                setForm((current) => ({ ...current, title: next }));
              }}
              value={title}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="project-description">Descrição</Label>
            <Textarea
              id="project-description"
              onChange={(event) => {
                const next = event.target.value;
                setForm((current) => ({ ...current, description: next }));
              }}
              rows={4}
              value={description}
            />
          </div>

          {editing && (
            <fieldset className="border-border flex flex-col gap-3 rounded-lg border p-3.5">
              <legend className="px-1 text-[12.5px] font-medium">Workspace</legend>

              <div className="flex flex-col gap-2">
                <Label htmlFor="project-workspace-kind">Tipo</Label>
                <Select
                  value={workspaceKind}
                  onValueChange={(next) => {
                    setForm((current) => ({ ...current, workspaceKind: next as WorkspaceKind }));
                  }}
                >
                  <SelectTrigger aria-label="Tipo" id="project-workspace-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORKSPACE_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {t(WORKSPACE_KIND[kind])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground text-[11px] leading-4">
                  {format(
                    "Um {gitRepo} habilita a estratégia de worktree por {run}; numa {folder} só o diretório atual faz sentido.",
                    {
                      gitRepo: t("workspaceKind.gitRepo").toLowerCase(),
                      folder: t("workspaceKind.folder").toLowerCase(),
                      run: t("entity.run"),
                    },
                  )}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="project-workspace-path">Caminho</Label>
                <Input
                  className="font-mono text-[12.5px]"
                  id="project-workspace-path"
                  maxLength={4000}
                  onChange={(event) => {
                    const next = event.target.value;
                    setForm((current) => ({ ...current, workspacePath: next }));
                    setPathError(null);
                  }}
                  placeholder="D:\Dev\meu-projeto"
                  spellCheck={false}
                  value={workspacePath}
                />
                {pathError === null ? (
                  <span className="text-muted-foreground text-[11px] leading-4">
                    {format(
                      "Caminho absoluto de um diretório que existe na máquina que roda a {api}. Vazio desliga o workspace, e nenhuma {run} pode partir.",
                      { api: t("infra.api"), run: t("entity.run") },
                    )}
                  </span>
                ) : (
                  <span className="text-destructive text-[11px] leading-4" role="alert">
                    {pathError}
                  </span>
                )}
              </div>
            </fieldset>
          )}
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
