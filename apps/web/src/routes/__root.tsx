import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";

import { CommandPalette, useCommandPalette } from "@/components/app-shell/command-palette";
import { Header } from "@/components/app-shell/header";
import { Sidebar } from "@/components/app-shell/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { useAchievementToasts } from "@/lib/achievement-toast";
import { useApprovalToasts } from "@/lib/approval-toast";
import { useEventsStore } from "@/lib/events";
import { useForgedToasts } from "@/lib/forged-toast";
import { useThemeSetting } from "@/lib/glossary";
import { useKnowledgeToasts } from "@/lib/knowledge-toast";
import { useLiveQueries } from "@/lib/live";
import { useProposalToasts } from "@/lib/proposal-toast";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  const connect = useEventsStore((state) => state.connect);
  const palette = useCommandPalette();

  // Hidrata o glossário com `ui.theme` e mantém a store em dia quando a
  // configuração muda, aqui ou em outra aba.
  useThemeSetting();

  // Uma escrita em qualquer aba — ou por outro processo — invalida a query
  // correspondente aqui, pelo mesmo stream.
  useLiveQueries();

  // O desbloqueio acontece enquanto o usuário está em qualquer tela, então o
  // anúncio mora no layout raiz e não no Hall.
  useAchievementToasts();

  // O pedido de Selo chega enquanto o usuário está em qualquer tela, pelo
  // mesmo motivo; o toast leva ao cockpit, onde a decisão acontece.
  useApprovalToasts();

  // As propostas de trabalho chegam no desfecho de uma Expedição, que também
  // acontece enquanto o usuário está em qualquer tela; o toast leva à Campanha.
  useProposalToasts();

  // O lote do Distiller e a forjada acontecem no Worker, em segundo plano,
  // enquanto o usuário está em qualquer tela (Fase 6B): um toast leva ao
  // Grimório, o outro à forja no Hall.
  useKnowledgeToasts();
  useForgedToasts();

  // Uma conexão SSE por aba, aberta no layout raiz e viva enquanto a aba
  // estiver. `connect` é idempotente, o que importa porque o StrictMode monta o
  // componente duas vezes em desenvolvimento.
  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <div className="bg-background text-foreground flex min-h-screen items-stretch">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          onOpenPalette={() => {
            palette.setOpen(true);
          }}
        />
        <main className="flex min-h-0 flex-1 flex-col gap-6 px-8 py-7">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
      <Toaster />
    </div>
  );
}
