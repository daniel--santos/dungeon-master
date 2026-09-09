import type { ToolKind } from "@dungeon-master/contracts";
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
import type { ToolRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { useCreateTool, useMcpServers, useUpdateTool } from "@/lib/registry";
import { TOOL_KIND, TOOL_KINDS } from "@/lib/registry-domain";

export interface ToolDialogProps {
  /** Ausente cria; presente edita aquela Tool. */
  readonly tool?: ToolRecord;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Cadastro de um Item (Fase 8C): comando liberado ou ferramenta de Relíquia.
 *
 * A espécie se escolhe na criação e não muda: os campos da outra espécie
 * são recusados pela API com `409`, e um formulário que fingisse trocar só
 * adiaria a recusa. O comando é um prefixo de argv, no formato da allow-list
 * do perfil — `git add`, nunca `git` inteiro.
 */
export function ToolDialog({ tool, open, onOpenChange }: ToolDialogProps) {
  const { t, format } = useGlossary();
  const create = useCreateTool();
  const update = useUpdateTool();
  const servers = useMcpServers();

  const [kind, setKind] = useState<ToolKind>("COMMAND");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [mcpServerId, setMcpServerId] = useState("");
  const [toolName, setToolName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setKind(tool?.kind ?? "COMMAND");
    setName(tool?.name ?? "");
    setCommand(tool?.command ?? "");
    setMcpServerId(tool?.mcpServerId ?? "");
    setToolName(tool?.toolName ?? "");
    setDescription(tool?.description ?? "");
  }, [open, tool]);

  const pending = create.isPending || update.isPending;
  const valid =
    name.trim() !== "" &&
    (kind === "COMMAND" ? command.trim() !== "" : mcpServerId !== "" && toolName.trim() !== "");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || pending) return;

    const done = {
      onSuccess: () => {
        onOpenChange(false);
        toast.success(t("tool.save.done"));
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    };

    const note = description.trim() === "" ? null : description.trim();

    if (tool === undefined) {
      create.mutate(
        kind === "COMMAND"
          ? { kind, name: name.trim(), command: command.trim(), description: note }
          : { kind, name: name.trim(), mcpServerId, toolName: toolName.trim(), description: note },
        done,
      );
      return;
    }

    update.mutate(
      {
        id: tool.id,
        name: name.trim(),
        description: note,
        ...(tool.kind === "COMMAND"
          ? { command: command.trim() }
          : { mcpServerId, toolName: toolName.trim() }),
      },
      done,
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form className="flex flex-col gap-4" data-tool-form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {tool === undefined ? t("tool.create.title") : t("tool.edit.title")}
            </DialogTitle>
            <DialogDescription>
              {tool === undefined ? t("tool.description") : t("tool.kindLocked")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tool-kind">Espécie</Label>
            <Select
              disabled={tool !== undefined}
              onValueChange={(next) => {
                setKind(next as ToolKind);
              }}
              value={kind}
            >
              <SelectTrigger aria-label="Espécie" id="tool-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TOOL_KINDS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {t(TOOL_KIND[item])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tool-name">Nome</Label>
            <Input
              autoFocus
              id="tool-name"
              maxLength={200}
              onChange={(event) => {
                setName(event.target.value);
              }}
              value={name}
            />
          </div>

          {kind === "COMMAND" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tool-command">{t("tool.command")}</Label>
              <Input
                className="font-mono text-[13px]"
                id="tool-command"
                maxLength={500}
                onChange={(event) => {
                  setCommand(event.target.value);
                }}
                placeholder="git add"
                value={command}
              />
              <span className="text-muted-foreground text-[11px] leading-4">
                {t("tool.command.hint")}
              </span>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tool-server">{t("entity.mcpServer")}</Label>
                <Select onValueChange={setMcpServerId} value={mcpServerId}>
                  <SelectTrigger aria-label={t("entity.mcpServer")} id="tool-server">
                    <SelectValue placeholder={t("entity.mcpServer")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(servers.data?.items ?? []).map((server) => (
                      <SelectItem key={server.id} value={server.id}>
                        {server.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tool-tool-name">{t("tool.toolName")}</Label>
                <Input
                  className="font-mono text-[13px]"
                  id="tool-tool-name"
                  maxLength={200}
                  onChange={(event) => {
                    setToolName(event.target.value);
                  }}
                  placeholder="search_knowledge"
                  value={toolName}
                />
                <span className="text-muted-foreground text-[11px] leading-4">
                  {t("tool.toolName.hint")}
                </span>
              </div>
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tool-description">Descrição</Label>
            <Input
              id="tool-description"
              maxLength={2_000}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              value={description}
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
            <Button disabled={!valid || pending} type="submit">
              {tool === undefined ? format("Criar {tool}", { tool: t("entity.tool") }) : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
