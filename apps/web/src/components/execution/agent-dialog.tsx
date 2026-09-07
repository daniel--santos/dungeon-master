import type { AgentRole } from "@dungeon-master/contracts";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { AgentRecord } from "@/lib/api-types";
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
import { AGENT_ROLE, AGENT_ROLES } from "@/lib/execution-domain";
import { useCreateAgent, useUpdateAgent } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";

export interface AgentDialogProps {
  /** Ausente cria; presente edita aquele Agent. */
  readonly agent?: AgentRecord;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Cadastro de um Agent: nome, papel e instruções.
 *
 * As instruções são o texto do papel injetado no prompt do Run, e não uma nota
 * para quem lê a tela — por isso ocupam o espaço que ocupam. A descrição é a
 * nota, e é opcional.
 */
export function AgentDialog({ agent, open, onOpenChange }: AgentDialogProps) {
  const { t, format } = useGlossary();
  const create = useCreateAgent();
  const update = useUpdateAgent();

  const [name, setName] = useState("");
  const [role, setRole] = useState<AgentRole>("ENGINEER");
  const [instructions, setInstructions] = useState("");
  const [description, setDescription] = useState("");

  // Reabrir o diálogo sobre outro Agent precisa recarregar os campos; manter o
  // estado do anterior salvaria o texto errado no registro errado.
  useEffect(() => {
    if (!open) return;
    setName(agent?.name ?? "");
    setRole(agent?.role ?? "ENGINEER");
    setInstructions(agent?.instructions ?? "");
    setDescription(agent?.description ?? "");
  }, [agent, open]);

  const pending = create.isPending || update.isPending;
  const valid = name.trim() !== "" && instructions.trim() !== "";

  function save() {
    const body = {
      name: name.trim(),
      role,
      instructions: instructions.trim(),
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

    if (agent === undefined) create.mutate(body, done);
    else update.mutate({ id: agent.id, ...body }, done);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {agent === undefined
              ? format("Novo {agent}", { agent: t("entity.agent") })
              : agent.name}
          </DialogTitle>
          <DialogDescription>
            {format(
              "A {role} e as instruções que vão no prompt. Nada de ferramenta nem de {model} aqui: isso é do {loadout}.",
              {
                role: t("entity.agentRole"),
                model: t("entity.model"),
                loadout: t("entity.loadout"),
              },
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-name">Nome</Label>
              <Input
                id="agent-name"
                maxLength={200}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                value={name}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-role">{t("entity.agentRole")}</Label>
              <Select
                value={role}
                onValueChange={(next) => {
                  setRole(next as AgentRole);
                }}
              >
                <SelectTrigger aria-label={t("entity.agentRole")} id="agent-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGENT_ROLES.map((candidate) => (
                    <SelectItem key={candidate} value={candidate}>
                      {t(AGENT_ROLE[candidate])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-instructions">Instruções</Label>
            <Textarea
              id="agent-instructions"
              maxLength={20_000}
              onChange={(event) => {
                setInstructions(event.target.value);
              }}
              rows={7}
              value={instructions}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-description">Descrição</Label>
            <Input
              id="agent-description"
              maxLength={2_000}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              placeholder="Uma linha para quem escolhe depois"
              value={description}
            />
          </div>
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
