import type { McpTransport } from "@dungeon-master/contracts";
import { KeyRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ChipInput } from "@/components/execution/chip-input";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { McpServerRegistryRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { useCreateMcpServer, useUpdateMcpServer } from "@/lib/registry";
import { isEnvKey, isMcpServerName, isMcpServerUrl, MCP_TRANSPORTS } from "@/lib/registry-domain";

export interface McpServerDialogProps {
  /** Ausente cria; presente edita aquele servidor. */
  readonly server?: McpServerRegistryRecord;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** Os argumentos, um por linha; linhas vazias não contam. */
function parseArgs(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Cadastro de uma Relíquia (Fase 8C): a forma de erguê-la, sem segredo.
 *
 * `STDIO` leva comando e argumentos **separados** — um caminho com espaço
 * sobrevive —, `HTTP` leva a URL sem `usuário:senha@`. Nos dois, `envKeys`
 * são nomes de variáveis, nunca valores: não existe campo de token aqui, e
 * a API recusaria um `NOME=valor`. O transporte não muda depois de criado.
 * Numa Relíquia `builtIn` só a descrição se edita; o resto é do Worker.
 */
export function McpServerDialog({ server, open, onOpenChange }: McpServerDialogProps) {
  const { t, format } = useGlossary();
  const create = useCreateMcpServer();
  const update = useUpdateMcpServer();

  const [transport, setTransport] = useState<McpTransport>("STDIO");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [envKeys, setEnvKeys] = useState<readonly string[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setTransport(server?.transport ?? "STDIO");
    setName(server?.name ?? "");
    setCommand(server?.command ?? "");
    setArgs((server?.args ?? []).join("\n"));
    setUrl(server?.url ?? "");
    setEnvKeys(server?.envKeys ?? []);
    setReadOnly(server?.readOnly ?? false);
    setDescription(server?.description ?? "");
  }, [open, server]);

  const builtIn = server?.builtIn === true;
  const pending = create.isPending || update.isPending;
  const nameOk = isMcpServerName(name.trim());
  const targetOk = transport === "STDIO" ? command.trim() !== "" : isMcpServerUrl(url.trim());
  const valid = builtIn || (nameOk && targetOk);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || pending) return;

    const done = {
      onSuccess: () => {
        onOpenChange(false);
        toast.success(t("mcpServer.save.done"));
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    };
    const note = description.trim() === "" ? null : description.trim();

    if (server === undefined) {
      create.mutate(
        transport === "STDIO"
          ? {
              transport,
              name: name.trim(),
              command: command.trim(),
              args: parseArgs(args),
              envKeys: [...envKeys],
              readOnly,
              description: note,
            }
          : {
              transport,
              name: name.trim(),
              url: url.trim(),
              envKeys: [...envKeys],
              readOnly,
              description: note,
            },
        done,
      );
      return;
    }

    if (builtIn) {
      update.mutate({ id: server.id, description: note }, done);
      return;
    }

    update.mutate(
      {
        id: server.id,
        name: name.trim(),
        envKeys: [...envKeys],
        readOnly,
        description: note,
        ...(server.transport === "STDIO"
          ? { command: command.trim(), args: parseArgs(args) }
          : { url: url.trim() }),
      },
      done,
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <form className="flex flex-col gap-4" data-mcp-server-form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {server === undefined ? t("mcpServer.create.title") : t("mcpServer.edit.title")}
            </DialogTitle>
            <DialogDescription>
              {builtIn
                ? t("mcpServer.builtIn.hint")
                : server === undefined
                  ? t("mcpServer.description")
                  : t("mcpServer.transportLocked")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-x-5 gap-y-3.5 sm:grid-cols-[140px_minmax(0,1fr)]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-transport">Transporte</Label>
              <Select
                disabled={server !== undefined}
                onValueChange={(next) => {
                  setTransport(next as McpTransport);
                }}
                value={transport}
              >
                <SelectTrigger aria-label="Transporte" id="mcp-transport">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MCP_TRANSPORTS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-name">Nome</Label>
              <Input
                aria-invalid={name !== "" && !nameOk}
                autoFocus={!builtIn}
                className="font-mono text-[13px]"
                disabled={builtIn}
                id="mcp-name"
                maxLength={63}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                value={name}
              />
              <span className="text-muted-foreground text-[11px] leading-4">
                {t("mcpServer.name.hint")}
              </span>
            </div>
          </div>

          {transport === "STDIO" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-command">Comando</Label>
                <Input
                  className="font-mono text-[13px]"
                  disabled={builtIn}
                  id="mcp-command"
                  maxLength={1_000}
                  onChange={(event) => {
                    setCommand(event.target.value);
                  }}
                  placeholder="node"
                  value={command}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-args">{t("mcpServer.args")}</Label>
                <Textarea
                  className="font-mono text-[12.5px]"
                  disabled={builtIn}
                  id="mcp-args"
                  onChange={(event) => {
                    setArgs(event.target.value);
                  }}
                  rows={3}
                  spellCheck={false}
                  value={args}
                />
                <span className="text-muted-foreground text-[11px] leading-4">
                  {t("mcpServer.args.hint")}
                </span>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-url">URL</Label>
              <Input
                aria-invalid={url !== "" && !targetOk}
                className="font-mono text-[13px]"
                disabled={builtIn}
                id="mcp-url"
                maxLength={2_000}
                onChange={(event) => {
                  setUrl(event.target.value);
                }}
                placeholder="https://"
                value={url}
              />
              <span className="text-muted-foreground text-[11px] leading-4">
                {t("mcpServer.url.hint")}
              </span>
            </div>
          )}

          {builtIn ? (
            <span className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-[11.5px]">
              <KeyRound aria-hidden className="size-3" />
              <span>{t("mcpServer.envKeys")}</span>
              <code className="font-mono text-[11px]">{envKeys.join(", ") || "—"}</code>
            </span>
          ) : (
            <ChipInput
              data-mcp-env-keys=""
              hint={t("mcpServer.envKeys.hint")}
              icon={KeyRound}
              label={t("mcpServer.envKeys")}
              mono
              normalize={(value) => value.toUpperCase()}
              onChange={setEnvKeys}
              placeholder="Adicionar variável"
              validate={isEnvKey}
              values={envKeys}
            />
          )}

          <div className="flex items-center justify-between gap-4">
            <Label className="text-[12.5px]" htmlFor="mcp-read-only">
              {t("mcpServer.readOnly")}
            </Label>
            <Switch
              checked={readOnly}
              disabled={builtIn}
              id="mcp-read-only"
              onCheckedChange={setReadOnly}
              size="sm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-description">Descrição</Label>
            <Input
              id="mcp-description"
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
              {server === undefined
                ? format("Criar {server}", { server: t("entity.mcpServer") })
                : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
