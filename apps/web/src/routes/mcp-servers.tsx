import { createFileRoute } from "@tanstack/react-router";
import { Gem, KeyRound, Lock, Plus, SquarePen, Trash2 } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { DeleteRegistryDialog } from "@/components/registry/delete-registry-dialog";
import { McpServerDialog } from "@/components/registry/mcp-server-dialog";
import { RegistryHeader } from "@/components/registry/registry-header";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { McpServerRegistryRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { useDeleteMcpServer, useMcpServers } from "@/lib/registry";
import { mcpServerTarget, REGISTRY_COLOR } from "@/lib/registry-domain";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/mcp-servers")({
  component: McpServersPage,
});

/**
 * As Relíquias do Arsenal (Fase 8C): a forma de erguer cada uma, sem segredo.
 *
 * A linha mostra o transporte, o comando com os argumentos (ou a URL), os
 * **nomes** das variáveis de ambiente, e as duas marcas que importam para
 * quem monta o Equipamento: só leitura, e nascida com o sistema. Uma Relíquia
 * `builtIn` não se apaga — o botão fica desabilitado com o motivo, em vez de
 * sumir — e só a descrição dela se edita.
 */
function McpServersPage() {
  const { t, format } = useGlossary();
  const servers = useMcpServers();
  const remove = useDeleteMcpServer();

  const [editing, setEditing] = useState<McpServerRegistryRecord | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<McpServerRegistryRecord | null>(null);

  const items = servers.data?.items ?? [];

  function create() {
    setEditing(undefined);
    setOpen(true);
  }

  return (
    <>
      <RegistryHeader
        actions={
          <Button onClick={create}>
            <Plus aria-hidden />
            <span>{t("mcpServer.create.title")}</span>
          </Button>
        }
        tab="mcp-servers"
      />

      <Panel className="flex flex-col px-5 pt-4 pb-3.5">
        <div className="flex items-center justify-between gap-4 pb-1.5">
          <div className="flex items-center gap-2">
            <Gem aria-hidden className="size-3.75" style={{ color: REGISTRY_COLOR }} />
            <span className="text-sm font-medium">{t("entity.mcpServer.plural")}</span>
          </div>
          <span className="text-muted-foreground text-xs">
            {format("{n} cadastradas", { n: items.length })}
          </span>
        </div>
        <p className="text-muted-foreground m-0 pb-2 text-[12.5px] leading-5">
          {t("mcpServer.description")}
        </p>

        {servers.isPending && <p className="text-muted-foreground py-6 text-sm">Lendo…</p>}
        {servers.error !== null && (
          <p className="text-destructive py-6 text-sm">{servers.error.message}</p>
        )}

        {!servers.isPending && servers.error === null && items.length === 0 && (
          <EmptyState
            action={
              <Button onClick={create} size="sm" variant="outline">
                <Plus aria-hidden />
                <span>{t("mcpServer.create.title")}</span>
              </Button>
            }
            icon={Gem}
            title={format("Nenhuma {server} ainda", { server: t("entity.mcpServer") })}
          >
            {t("mcpServer.list.empty")}
          </EmptyState>
        )}

        {items.map((server, index) => (
          <div
            key={server.id}
            className={cn("flex items-start gap-3 py-3", index > 0 && "border-border border-t")}
            data-mcp-server={server.name}
            data-mcp-server-built-in={String(server.builtIn)}
          >
            <span className="border-border flex size-8 flex-none items-center justify-center rounded-lg border bg-[oklch(0.72_0.13_305)]/12">
              <Gem aria-hidden className="size-3.75" style={{ color: REGISTRY_COLOR }} />
            </span>

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[13px] font-medium">{server.name}</span>
                <span className="border-border inline-flex h-[20px] w-fit items-center rounded-lg border bg-white/[0.04] px-2 font-mono text-[10.5px]">
                  {server.transport}
                </span>
                {server.readOnly && (
                  <span className="border-border text-muted-foreground inline-flex h-[20px] w-fit items-center gap-1 rounded-lg border px-2 text-[11px]">
                    <Lock aria-hidden className="size-2.75" />
                    <span>{t("mcpServer.readOnly")}</span>
                  </span>
                )}
                {server.builtIn && (
                  <span
                    className="inline-flex h-[20px] w-fit items-center rounded-lg border px-2 text-[11px]"
                    data-mcp-built-in-badge
                    style={{
                      borderColor: `color-mix(in oklch, ${REGISTRY_COLOR} 45%, transparent)`,
                      color: REGISTRY_COLOR,
                    }}
                  >
                    {t("mcpServer.builtIn")}
                  </span>
                )}
              </div>
              <code className="text-muted-foreground truncate font-mono text-[11px]">
                {mcpServerTarget(server)}
              </code>
              {server.envKeys.length > 0 && (
                <span className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-[11px]">
                  <KeyRound aria-hidden className="size-3" />
                  {server.envKeys.map((key) => (
                    <code key={key} className="font-mono text-[10.5px]" data-mcp-env-key={key}>
                      {key}
                    </code>
                  ))}
                </span>
              )}
              {server.description !== null && server.description !== "" && (
                <span className="text-muted-foreground text-xs leading-4.5">
                  {server.description}
                </span>
              )}
            </div>

            <div className="flex flex-none items-center gap-1">
              <Button
                aria-label={`Editar ${server.name}`}
                onClick={() => {
                  setEditing(server);
                  setOpen(true);
                }}
                size="icon-sm"
                variant="ghost"
              >
                <SquarePen aria-hidden />
              </Button>
              {server.builtIn ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Button
                          aria-label={`Excluir ${server.name}`}
                          className="text-muted-foreground"
                          disabled
                          size="icon-sm"
                          variant="ghost"
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-72">
                      {t("mcpServer.builtIn.hint")}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <Button
                  aria-label={`Excluir ${server.name}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setRemoving(server);
                  }}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </div>
          </div>
        ))}
      </Panel>

      <McpServerDialog onOpenChange={setOpen} open={open} server={editing} />

      <DeleteRegistryDialog
        action={format("Apagar {server}", { server: t("entity.mcpServer") })}
        body={t("mcpServer.delete.body")}
        data-mcp-server-delete-dialog=""
        done={t("mcpServer.delete.done")}
        onOpenChange={(next) => {
          if (!next) setRemoving(null);
        }}
        pending={remove.isPending}
        remove={(id) => remove.mutateAsync(id)}
        target={removing}
        title={t("mcpServer.delete.title")}
      />
    </>
  );
}
