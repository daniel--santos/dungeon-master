import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useEventsStore } from "@/lib/events";

/**
 * Invalida as queries afetadas por cada evento de domínio do SSE.
 *
 * O caminho inteiro é: a escrita grava a linha de `activity` e o evento na
 * mesma transação, o trigger emite o `NOTIFY`, a API empurra pelo stream, e
 * aqui a query volta ao servidor. Uma captura feita em outra aba aparece no
 * Quadro sem recarregar e sem polling.
 *
 * A invalidação é por prefixo, e não por chave exata, porque o evento não diz
 * qual página da lista mudou — e uma lista errada por uma página é pior do que
 * uma releitura a mais.
 */
export function useLiveQueries(): void {
  const queryClient = useQueryClient();
  const addListener = useEventsStore((state) => state.addListener);

  useEffect(() => {
    return addListener((event) => {
      if (event.type.startsWith("task.")) {
        // Uma Task mexe na sua própria lista, na Inbox (que são Tasks em
        // `INBOX`) e nas contagens por estado que a tela de Project mostra.
        void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        void queryClient.invalidateQueries({ queryKey: ["inbox"] });
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
        return;
      }

      if (event.type.startsWith("project.")) {
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
      }
    });
  }, [addListener, queryClient]);
}
