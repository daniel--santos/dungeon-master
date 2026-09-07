import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";

import { routeTree } from "@/routeTree.gen";

/**
 * Monta um componente com o contexto de router e de query que ele espera.
 *
 * `RouterContextProvider` dá o router sem renderizar a árvore de rotas: o teste
 * monta só o componente sob prova, e um `<Link to="/tasks/$id">` dentro dele
 * ainda resolve, porque a árvore real está registrada no router.
 */
export function renderInRouter(ui: ReactNode, initialEntry = "/"): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>{ui}</RouterContextProvider>
    </QueryClientProvider>,
  );
}
