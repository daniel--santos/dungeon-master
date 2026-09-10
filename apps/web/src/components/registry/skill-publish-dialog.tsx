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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SkillDetailRecord, SkillVersionRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { SkillVersionConflictError, usePublishSkillVersion } from "@/lib/registry";

const CONTENT_MAX_LENGTH = 100_000;
const CHANGELOG_MAX_LENGTH = 2_000;

export interface SkillPublishDialogProps {
  /** A Skill, com a versão mais recente. `null` fecha o diálogo. */
  readonly skill: SkillDetailRecord | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPublished?: (version: SkillVersionRecord) => void;
}

/**
 * Publicar uma versão nova de uma Habilidade (Fase 8C).
 *
 * Um diálogo de formulário, e não um alerta: publicar tem consequência (os
 * Equipamentos que seguem a mais recente passam a levar este texto) mas não
 * apaga nada, e a versão anterior continua no histórico. O editor abre com o
 * texto da versão mais recente; a nota de versão é obrigatória, porque é o
 * que quem fixa uma versão no Equipamento vai ler.
 *
 * O envio leva `expectedLatestVersion`: quem editou a partir da v3 não
 * publica por cima de uma v4 que outra aba publicou. O `409` fica no
 * diálogo, com o texto preservado, para o usuário reler antes de insistir.
 */
export function SkillPublishDialog({ skill, onOpenChange, onPublished }: SkillPublishDialogProps) {
  const { t, format } = useGlossary();
  const publish = usePublishSkillVersion();

  const [content, setContent] = useState("");
  const [changelog, setChangelog] = useState("");
  const [conflict, setConflict] = useState<string | null>(null);

  const open = skill !== null;
  useEffect(() => {
    if (!open || skill === null) return;
    setContent(skill.latest.content);
    setChangelog("");
    setConflict(null);
  }, [open, skill]);

  const next = skill === null ? 1 : skill.latestVersion + 1;
  const nextLabel = `v${String(next)}`;
  const unchanged = skill !== null && content === skill.latest.content;
  const valid = changelog.trim() !== "" && !unchanged;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (skill === null || !valid || publish.isPending) return;

    publish.mutate(
      {
        id: skill.id,
        content,
        changelog: changelog.trim(),
        expectedLatestVersion: skill.latestVersion,
      },
      {
        onSuccess: (version) => {
          onOpenChange(false);
          toast.success(
            format(t("skill.publish.done"), { version: `v${String(version.version)}` }),
          );
          onPublished?.(version);
        },
        onError: (error: Error) => {
          if (error instanceof SkillVersionConflictError) {
            setConflict(error.message);
            return;
          }
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-[760px]">
        <form className="flex flex-col gap-4" data-skill-publish-form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{format(t("skill.publish.title"), { version: nextLabel })}</DialogTitle>
            <DialogDescription>{t("skill.publish.body")}</DialogDescription>
          </DialogHeader>

          {conflict !== null && (
            <div
              className="border-destructive/40 bg-destructive/8 flex flex-col gap-1 rounded-lg border px-3 py-2.5"
              data-skill-publish-conflict
              role="alert"
            >
              <span className="text-[12.5px] font-medium">
                {format(t("skill.publish.conflict"), { version: nextLabel })}
              </span>
              <span className="text-muted-foreground text-[11.5px] leading-4">{conflict}</span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="skill-publish-content">{t("skill.content.title")}</Label>
            <Textarea
              className="min-h-72 font-mono text-[12.5px] leading-5"
              id="skill-publish-content"
              maxLength={CONTENT_MAX_LENGTH}
              onChange={(event) => {
                setContent(event.target.value);
              }}
              spellCheck={false}
              value={content}
            />
            <span
              className={
                unchanged
                  ? "text-destructive text-[11px] leading-4"
                  : "text-muted-foreground text-[11px] leading-4"
              }
            >
              {unchanged
                ? t("skill.publish.unchanged")
                : format("{n} caracteres.", { n: content.length })}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="skill-publish-changelog">{t("skill.publish.changelog")}</Label>
            <Textarea
              id="skill-publish-changelog"
              maxLength={CHANGELOG_MAX_LENGTH}
              onChange={(event) => {
                setChangelog(event.target.value);
              }}
              rows={3}
              value={changelog}
            />
            <span className="text-muted-foreground text-[11px] leading-4">
              {t("skill.publish.changelog.hint")}
            </span>
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
            <Button disabled={!valid || publish.isPending} type="submit">
              {format(t("skill.publish.confirm"), { version: nextLabel })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
