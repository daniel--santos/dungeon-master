import { createFileRoute } from "@tanstack/react-router";
import { Gem, Plus, SquarePen, Terminal, Trash2, Wrench } from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { DeleteRegistryDialog } from "@/components/registry/delete-registry-dialog";
import { RegistryHeader } from "@/components/registry/registry-header";
import { ToolDialog } from "@/components/registry/tool-dialog";
import { Button } from "@/components/ui/button";
import type { ToolRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { useDeleteTool, useMcpServers, useTools } from "@/lib/registry";
import { REGISTRY_COLOR, TOOL_KIND } from "@/lib/registry-domain";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tools")({
  component: ToolsPage,
});

/**
 * Os Itens do Arsenal (Fase 8C): comandos liberados e ferramentas de Relíquia.
 *
 * A lista mostra a espécie e a definição de cada um — o prefixo de argv, ou
 * a Relíquia e o nome anunciado — porque é isso que o Worker soma à
 * concessão do Run; o nome é só como o Equipamento o chama.
 */
function ToolsPage() {
  const { t, format } = useGlossary();
  const tools = useTools();
  const servers = useMcpServers();
  const remove = useDeleteTool();

  const [editing, setEditing] = useState<ToolRecord | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<ToolRecord | null>(null);

  const items = tools.data?.items ?? [];
  const serverNames = useMemo(
    () => new Map((servers.data?.items ?? []).map((server) => [server.id, server.name])),
    [servers.data],
  );

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
            <span>{t("tool.create.title")}</span>
          </Button>
        }
        tab="tools"
      />

      <Panel className="flex flex-col px-5 pt-4 pb-3.5">
        <div className="flex items-center justify-between gap-4 pb-1.5">
          <div className="flex items-center gap-2">
            <Wrench aria-hidden className="size-3.75" style={{ color: REGISTRY_COLOR }} />
            <span className="text-sm font-medium">{t("entity.tool.plural")}</span>
          </div>
          <span className="text-muted-foreground text-xs">
            {format("{n} cadastrados", { n: items.length })}
          </span>
        </div>
        <p className="text-muted-foreground m-0 pb-2 text-[12.5px] leading-5">
          {t("tool.description")}
        </p>

        {tools.isPending && <p className="text-muted-foreground py-6 text-sm">Lendo…</p>}
        {tools.error !== null && (
          <p className="text-destructive py-6 text-sm">{tools.error.message}</p>
        )}

        {!tools.isPending && tools.error === null && items.length === 0 && (
          <EmptyState
            action={
              <Button onClick={create} size="sm" variant="outline">
                <Plus aria-hidden />
                <span>{t("tool.create.title")}</span>
              </Button>
            }
            icon={Wrench}
            title={format("Nenhum {tool} ainda", { tool: t("entity.tool") })}
          >
            {t("tool.list.empty")}
          </EmptyState>
        )}

        {items.map((tool, index) => (
          <div
            key={tool.id}
            className={cn("flex items-center gap-3 py-3", index > 0 && "border-border border-t")}
            data-tool={tool.name}
            data-tool-kind={tool.kind}
          >
            <span className="border-border flex size-8 flex-none items-center justify-center rounded-lg border bg-[oklch(0.72_0.13_305)]/12">
              {tool.kind === "COMMAND" ? (
                <Terminal aria-hidden className="size-3.75" style={{ color: REGISTRY_COLOR }} />
              ) : (
                <Gem aria-hidden className="size-3.75" style={{ color: REGISTRY_COLOR }} />
              )}
            </span>

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium">{tool.name}</span>
                <span className="border-border inline-flex h-[20px] w-fit items-center rounded-lg border bg-white/[0.04] px-2 text-[11px]">
                  {t(TOOL_KIND[tool.kind])}
                </span>
              </div>
              <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs leading-4.5">
                <code className="font-mono text-[11px]">
                  {tool.kind === "COMMAND"
                    ? (tool.command ?? "")
                    : `${serverNames.get(tool.mcpServerId ?? "") ?? "…"} · ${tool.toolName ?? ""}`}
                </code>
                {tool.description !== null && tool.description !== "" && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="truncate">{tool.description}</span>
                  </>
                )}
              </span>
            </div>

            <div className="flex flex-none items-center gap-1">
              <Button
                aria-label={`Editar ${tool.name}`}
                onClick={() => {
                  setEditing(tool);
                  setOpen(true);
                }}
                size="icon-sm"
                variant="ghost"
              >
                <SquarePen aria-hidden />
              </Button>
              <Button
                aria-label={`Excluir ${tool.name}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  setRemoving(tool);
                }}
                size="icon-sm"
                variant="ghost"
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          </div>
        ))}
      </Panel>

      <ToolDialog onOpenChange={setOpen} open={open} tool={editing} />

      <DeleteRegistryDialog
        action={format("Apagar {tool}", { tool: t("entity.tool") })}
        body={t("tool.delete.body")}
        data-tool-delete-dialog=""
        done={t("tool.delete.done")}
        onOpenChange={(next) => {
          if (!next) setRemoving(null);
        }}
        pending={remove.isPending}
        remove={(id) => remove.mutateAsync(id)}
        target={removing}
        title={t("tool.delete.title")}
      />
    </>
  );
}
