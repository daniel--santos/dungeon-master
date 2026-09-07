import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";

import { useEventsStore } from "@/lib/events";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  const connect = useEventsStore((state) => state.connect);

  // Uma conexão SSE por aba, aberta no layout raiz e viva enquanto a aba
  // estiver. `connect` é idempotente, o que importa porque o StrictMode monta o
  // componente duas vezes em desenvolvimento.
  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="border-border border-b">
        <div className="mx-auto flex max-w-3xl items-baseline gap-3 px-6 py-5">
          <span className="text-lg font-semibold tracking-tight">Dungeon Master</span>
          <span className="text-muted-foreground text-sm">Control Plane</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}
