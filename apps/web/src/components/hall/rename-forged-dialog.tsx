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
import type { ForgedAchievementRecord, RenameForgedAchievementBody } from "@/lib/api-types";
import { useRenameForgedAchievement } from "@/lib/forged";
import { useGlossary } from "@/lib/glossary";

/** Os limites do `LocalizedTextSchema` das Conquistas (VOICE.md, seção 7). */
const NAME_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 120;
const FLAVOR_MAX_LENGTH = 240;

export interface RenameForgedDialogProps {
  /** A forjada em edição. `null` fecha o diálogo. */
  readonly achievement: ForgedAchievementRecord | null;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Reescrever uma Conquista forjada (Fase 2.5C, entregue na 6B).
 *
 * Um diálogo de formulário, e não um alerta: reescrever tem volta. Só o texto
 * do tema é editável — nome, descrição e fala — porque a versão sóbria é
 * escrita pelo código a partir do resultado notável e descreve a condição,
 * que não muda. Ela aparece no diálogo, só leitura, para o usuário saber o
 * que a carta vai dizer com o tema desligado.
 *
 * Os limites são os do catálogo: passar deles reprovaria a definição no
 * carregador, e o servidor recusa antes disso.
 */
export function RenameForgedDialog({ achievement, onOpenChange }: RenameForgedDialogProps) {
  const { t } = useGlossary();
  const rename = useRenameForgedAchievement();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [flavor, setFlavor] = useState("");

  const open = achievement !== null;
  useEffect(() => {
    if (!open || achievement === null) return;
    setName(achievement.name);
    setDescription(achievement.description);
    setFlavor(achievement.flavor);
  }, [open, achievement]);

  const valid = name.trim() !== "" && description.trim() !== "" && flavor.trim() !== "";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (achievement === null || !valid) return;

    // Só o que mudou vai no corpo.
    const body: RenameForgedAchievementBody = {
      ...(name.trim() === achievement.name ? {} : { name: name.trim() }),
      ...(description.trim() === achievement.description
        ? {}
        : { description: description.trim() }),
      ...(flavor.trim() === achievement.flavor ? {} : { flavor: flavor.trim() }),
    };

    if (Object.keys(body).length === 0) {
      onOpenChange(false);
      return;
    }

    rename.mutate(
      { id: achievement.id, body },
      {
        onSuccess: () => {
          onOpenChange(false);
          toast.success(t("forged.rename.done"));
        },
        onError: (error: Error) => {
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {achievement !== null && (
        <DialogContent className="sm:max-w-xl" data-rename-forged={achievement.id}>
          <form className="flex flex-col gap-5" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{t("forged.rename.title")}</DialogTitle>
              <DialogDescription>{t("forged.rename.body")}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rename-forged-name">{t("forged.rename.name")}</Label>
                <Input
                  autoFocus
                  id="rename-forged-name"
                  maxLength={NAME_MAX_LENGTH}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  value={name}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rename-forged-description">{t("forged.rename.description")}</Label>
                <Textarea
                  className="min-h-16 text-[13px]"
                  id="rename-forged-description"
                  maxLength={DESCRIPTION_MAX_LENGTH}
                  onChange={(event) => {
                    setDescription(event.target.value);
                  }}
                  rows={2}
                  value={description}
                />
                <span className="text-muted-foreground text-[11px]">
                  {`${String(description.length)} / ${String(DESCRIPTION_MAX_LENGTH)}`}
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rename-forged-flavor">{t("forged.rename.flavor")}</Label>
                <Textarea
                  className="min-h-20 text-[13px] italic"
                  id="rename-forged-flavor"
                  maxLength={FLAVOR_MAX_LENGTH}
                  onChange={(event) => {
                    setFlavor(event.target.value);
                  }}
                  rows={3}
                  value={flavor}
                />
                <span className="text-muted-foreground text-[11px]">
                  {`${String(flavor.length)} / ${String(FLAVOR_MAX_LENGTH)}`}
                </span>
              </div>

              <div
                className="border-border bg-input/20 flex flex-col gap-1 rounded-lg border px-3 py-2.5"
                data-rename-forged-plain
              >
                <span className="text-muted-foreground text-[10.5px] tracking-[0.06em] uppercase">
                  {t("forged.rename.plain")}
                </span>
                <span className="text-[13px] font-medium">{achievement.plainName}</span>
                <span className="text-muted-foreground text-[12.5px] leading-4.5">
                  {achievement.plainDescription}
                </span>
              </div>
            </div>

            <DialogFooter>
              <Button
                onClick={() => {
                  onOpenChange(false);
                }}
                type="button"
                variant="ghost"
              >
                Cancelar
              </Button>
              <Button
                data-forged-confirm="rename"
                disabled={rename.isPending || !valid}
                type="submit"
              >
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
