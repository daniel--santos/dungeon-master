import type { components } from "@dungeon-master/api-client";
import { createFileRoute } from "@tanstack/react-router";
import { Inbox as InboxIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { CaptureForm } from "@/components/inbox/capture-form";
import { PromoteDialog } from "@/components/inbox/promote-dialog";
import { PageHeader } from "@/components/page-header";
import { Panel, PanelHeader } from "@/components/panel";
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
import { relativeTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { useDiscardInbox, useInbox } from "@/lib/inbox";

type Task = components["schemas"]["Task"];

export const Route = createFileRoute("/inbox")({
  component: InboxPage,
});

function InboxPage() {
  const { t, format } = useGlossary();
  const inbox = useInbox();
  const discard = useDiscardInbox();

  const [promoting, setPromoting] = useState<Task | null>(null);
  const [discarding, setDiscarding] = useState<Task | null>(null);

  const items = inbox.data?.items ?? [];
  const total = inbox.data?.total ?? 0;

  function confirmDiscard() {
    if (discarding === null) return;
    discard.mutate(discarding.id, {
      onSuccess: () => {
        setDiscarding(null);
      },
      onError: (error: Error) => {
        setDiscarding(null);
        toast.error(error.message);
      },
    });
  }

  return (
    <>
      <PageHeader
        title={t("nav.inbox")}
        description={format(
          "Capture agora, decida depois. Nada aqui é uma {task} até você dizer que é.",
          { task: t("entity.task") },
        )}
      />

      <CaptureForm />

      <Panel className="flex flex-col overflow-hidden">
        <PanelHeader
          title={
            inbox.isPending
              ? "Lendo…"
              : format(total === 1 ? "{n} item capturado" : "{n} itens capturados", { n: total })
          }
          aside="Mais recentes primeiro"
        />

        {inbox.isError && (
          <p className="text-destructive px-5 py-6 text-sm">{inbox.error.message}</p>
        )}

        {!inbox.isPending && !inbox.isError && items.length === 0 && (
          <EmptyState icon={InboxIcon} title="Nada capturado ainda">
            {format(
              "O campo acima aceita qualquer coisa que você não queira esquecer. Depois cada item vira {task} ou vai embora.",
              { task: t("entity.task") },
            )}
          </EmptyState>
        )}

        {items.map((item, index) => (
          <div
            key={item.id}
            className={`flex items-center gap-4 px-5 py-3.5 ${index === 0 ? "" : "border-border border-t"}`}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm leading-5">{item.title}</span>
              <span className="text-muted-foreground text-xs leading-4">
                {format("capturado {when}", { when: relativeTime(item.createdAt) })}
              </span>
            </div>

            <div className="flex flex-none items-center gap-2">
              <Button
                onClick={() => {
                  setPromoting(item);
                }}
                size="sm"
                variant="outline"
              >
                {format("Virar {task}", { task: t("entity.task") })}
              </Button>
              <Button
                className="text-muted-foreground"
                onClick={() => {
                  setDiscarding(item);
                }}
                size="sm"
                variant="ghost"
              >
                Descartar
              </Button>
            </div>
          </div>
        ))}
      </Panel>

      <PromoteDialog
        capture={promoting}
        onOpenChange={(open) => {
          if (!open) setPromoting(null);
        }}
      />

      <AlertDialog
        open={discarding !== null}
        onOpenChange={(open) => {
          if (!open) setDiscarding(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar esta captura?</AlertDialogTitle>
            <AlertDialogDescription>
              Ela sai da lista, mas a linha continua no banco: o que você capturou permanece
              auditável, e o histórico não fica com um buraco.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter</AlertDialogCancel>
            <AlertDialogAction disabled={discard.isPending} onClick={confirmDiscard}>
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
