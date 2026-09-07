import { createFileRoute } from "@tanstack/react-router";
import { Plus, SquarePen, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { AgentDialog } from "@/components/execution/agent-dialog";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { AgentRecord } from "@/lib/api-types";
import { AGENT_ROLE } from "@/lib/execution-domain";
import { useAgents, useDeleteAgent } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/agents")({
  component: AgentsPage,
});

/**
 * O cadastro de Agents: quem faz o trabalho, sem o que ele leva.
 *
 * Papel e instruções moram aqui; ferramenta, modelo e perfil de execução moram
 * no Loadout. A separação é o que deixa o mesmo Agent aparecer em Loadouts
 * diferentes sem virar quatro cadastros quase iguais.
 */
function AgentsPage() {
  const { t, format } = useGlossary();
  const agents = useAgents();

  const [editing, setEditing] = useState<AgentRecord | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<AgentRecord | null>(null);
  const remove = useDeleteAgent();

  function edit(agent: AgentRecord) {
    setEditing(agent);
    setOpen(true);
  }

  function create() {
    setEditing(undefined);
    setOpen(true);
  }

  function confirmRemoval() {
    if (removing === null) return;
    remove.mutate(removing.id, {
      onSuccess: () => {
        setRemoving(null);
      },
      onError: (error: Error) => {
        // O `409` explica qual Equipamento ainda depende deste registro.
        toast.error(error.message);
        setRemoving(null);
      },
    });
  }

  const items = agents.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={t("nav.agents")}
        description={format(
          "Quem executa uma {run}: a {role} e as instruções que entram no prompt.",
          { run: t("entity.run"), role: t("entity.agentRole") },
        )}
        actions={
          <Button onClick={create}>
            <Plus aria-hidden />
            <span>{format("Novo {agent}", { agent: t("entity.agent") })}</span>
          </Button>
        }
      />

      <Panel className="flex flex-col px-5 pt-4 pb-3.5">
        <div className="flex items-center justify-between pb-1.5">
          <div className="flex items-center gap-2">
            <Users aria-hidden className="text-muted-foreground size-3.75" />
            <span className="text-sm font-medium">{t("entity.agent.plural")}</span>
          </div>
          <span className="text-muted-foreground text-xs">
            {format("{n} cadastrados", { n: items.length })}
          </span>
        </div>

        {agents.isPending && <p className="text-muted-foreground py-6 text-sm">Lendo…</p>}
        {agents.error !== null && (
          <p className="text-destructive py-6 text-sm">{agents.error.message}</p>
        )}

        {!agents.isPending && agents.error === null && items.length === 0 && (
          <EmptyState
            action={
              <Button onClick={create} size="sm" variant="outline">
                <Plus aria-hidden />
                <span>{format("Novo {agent}", { agent: t("entity.agent") })}</span>
              </Button>
            }
            icon={Users}
            title={format("Nenhum {agent} ainda", { agent: t("entity.agent") })}
          >
            {format(
              "Um {agent} é uma {role} com instruções. Sem nenhum, não há {loadout} a montar nem {run} a partir.",
              {
                agent: t("entity.agent"),
                role: t("entity.agentRole"),
                loadout: t("entity.loadout"),
                run: t("entity.run"),
              },
            )}
          </EmptyState>
        )}

        {items.map((agent, index) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            first={index === 0}
            onEdit={() => {
              edit(agent);
            }}
            onRemove={() => {
              setRemoving(agent);
            }}
          />
        ))}
      </Panel>

      <AgentDialog agent={editing} open={open} onOpenChange={setOpen} />

      <AlertDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (!next) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {format("Excluir {name}?", { name: removing?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {format(
                "Um {agent} usado por algum {loadout} não é excluído: a API recusa e diz qual. O histórico de {runs} já feitas nunca some.",
                {
                  agent: t("entity.agent"),
                  loadout: t("entity.loadout"),
                  runs: t("entity.run.plural"),
                },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive/60 text-white hover:bg-destructive/70"
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                confirmRemoval();
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function AgentRow({
  agent,
  first,
  onEdit,
  onRemove,
}: {
  agent: AgentRecord;
  first: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useGlossary();
  const initials = agent.name.split(" ")[0]?.slice(0, 2).toUpperCase() ?? "??";

  return (
    <div
      className={cn("flex items-start gap-3 py-3", !first && "border-border border-t")}
      data-agent={agent.name}
    >
      <span className="border-border bg-muted flex size-8 flex-none items-center justify-center rounded-full border text-[11px] font-semibold">
        {initials}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">{agent.name}</span>
          <span className="border-border inline-flex h-[22px] w-fit items-center rounded-lg border bg-white/[0.04] px-2 text-xs">
            {t(AGENT_ROLE[agent.role])}
          </span>
        </div>
        <span className="text-muted-foreground text-xs leading-4.5">
          {agent.description ?? agent.instructions}
        </span>
      </div>

      <div className="flex flex-none items-center gap-1">
        <Button aria-label={`Editar ${agent.name}`} onClick={onEdit} size="icon-sm" variant="ghost">
          <SquarePen aria-hidden />
        </Button>
        <Button
          aria-label={`Excluir ${agent.name}`}
          className="text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          size="icon-sm"
          variant="ghost"
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </div>
  );
}
