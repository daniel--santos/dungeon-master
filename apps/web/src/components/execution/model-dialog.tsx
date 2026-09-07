import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { HarnessRecord, ModelRecord } from "@/lib/api-types";
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
import { useCreateModel, useUpdateModel } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";

export interface ModelDialogProps {
  /** O Harness dono da chave. Um Model nunca existe solto. */
  readonly harness: HarnessRecord;
  /** Ausente cria; presente edita aquele Model. */
  readonly model?: ModelRecord;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Cadastro de um Model dentro de um Harness.
 *
 * A `key` é o identificador que a CLI aceita na linha de comando, e o `name` é
 * o que a tela mostra: separar os dois é o que permite trocar o nome sem
 * quebrar a execução. Marcar como padrão desmarca o padrão anterior do mesmo
 * Harness — a API resolve isso em vez de recusar.
 */
export function ModelDialog({ harness, model, open, onOpenChange }: ModelDialogProps) {
  const { t, format } = useGlossary();
  const create = useCreateModel();
  const update = useUpdateModel();

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKey(model?.key ?? "");
    setName(model?.name ?? "");
    setIsDefault(model?.isDefault ?? false);
  }, [model, open]);

  const pending = create.isPending || update.isPending;
  const valid = key.trim() !== "" && name.trim() !== "";

  function save() {
    const done = {
      onSuccess: () => {
        onOpenChange(false);
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    };

    if (model === undefined) {
      create.mutate({ harnessId: harness.id, key: key.trim(), name: name.trim(), isDefault }, done);
    } else {
      update.mutate({ id: model.id, key: key.trim(), name: name.trim(), isDefault }, done);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {model === undefined
              ? format("Novo {model} em {harness}", {
                  model: t("entity.model"),
                  harness: harness.name,
                })
              : model.name}
          </DialogTitle>
          <DialogDescription>
            {format("A chave é o que a CLI de {harness} aceita; o nome é o que esta tela mostra.", {
              harness: harness.name,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model-name">Nome</Label>
            <Input
              id="model-name"
              maxLength={200}
              onChange={(event) => {
                setName(event.target.value);
              }}
              value={name}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model-key">Chave</Label>
            <Input
              className="font-mono text-[13px]"
              id="model-key"
              maxLength={200}
              onChange={(event) => {
                setKey(event.target.value);
              }}
              placeholder="claude-opus-5"
              value={key}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <Checkbox
              checked={isDefault}
              onCheckedChange={(checked) => {
                setIsDefault(checked === true);
              }}
            />
            <span>{format("Padrão de {harness}", { harness: harness.name })}</span>
          </label>
        </div>

        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
            variant="outline"
          >
            Cancelar
          </Button>
          <Button disabled={!valid || pending} onClick={save}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
