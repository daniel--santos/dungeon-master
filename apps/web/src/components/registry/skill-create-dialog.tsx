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
import type { SkillDetailRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { useCreateSkill } from "@/lib/registry";

const NAME_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2_000;
const CONTENT_MAX_LENGTH = 100_000;
const CHANGELOG_MAX_LENGTH = 2_000;

export interface SkillCreateDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreated?: (skill: SkillDetailRecord) => void;
}

/**
 * Uma Habilidade nova, na v1 (Fase 8C).
 *
 * Nome, descrição e o texto da primeira versão, com uma nota opcional. O
 * texto é markdown que o Herói recebe, e vai como está: nunca é
 * interpretado aqui. Depois de criada, o texto não se edita — publica-se
 * uma versão nova.
 */
export function SkillCreateDialog({ open, onOpenChange, onCreated }: SkillCreateDialogProps) {
  const { t, format } = useGlossary();
  const create = useCreateSkill();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [changelog, setChangelog] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setContent("");
    setChangelog("");
  }, [open]);

  const valid = name.trim() !== "";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || create.isPending) return;

    create.mutate(
      {
        name: name.trim(),
        description: description.trim() === "" ? null : description.trim(),
        content,
        changelog: changelog.trim() === "" ? null : changelog.trim(),
      },
      {
        onSuccess: (skill) => {
          onOpenChange(false);
          toast.success(t("skill.create.done"));
          onCreated?.(skill);
        },
        onError: (error: Error) => {
          // O `409` é o nome já usado; o `detail` diz isso.
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-[680px]">
        <form className="flex flex-col gap-4" data-skill-create-form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("skill.create.title")}</DialogTitle>
            <DialogDescription>{t("skill.create.body")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-x-5 gap-y-3.5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="skill-name">Nome</Label>
              <Input
                autoFocus
                id="skill-name"
                maxLength={NAME_MAX_LENGTH}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                value={name}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="skill-description">Descrição</Label>
              <Input
                id="skill-description"
                maxLength={DESCRIPTION_MAX_LENGTH}
                onChange={(event) => {
                  setDescription(event.target.value);
                }}
                value={description}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="skill-content">{t("skill.content.title")}</Label>
            <Textarea
              className="min-h-56 font-mono text-[12.5px] leading-5"
              id="skill-content"
              maxLength={CONTENT_MAX_LENGTH}
              onChange={(event) => {
                setContent(event.target.value);
              }}
              spellCheck={false}
              value={content}
            />
            <span className="text-muted-foreground text-[11px] leading-4">
              {format("Markdown, como a {harness} vai receber. {n} caracteres.", {
                harness: t("entity.harness"),
                n: content.length,
              })}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="skill-changelog">{t("skill.publish.changelog")}</Label>
            <Input
              id="skill-changelog"
              maxLength={CHANGELOG_MAX_LENGTH}
              onChange={(event) => {
                setChangelog(event.target.value);
              }}
              placeholder="Opcional na v1"
              value={changelog}
            />
          </div>

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
            <Button disabled={!valid || create.isPending} type="submit">
              {format("Criar na {version}", { version: "v1" })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
