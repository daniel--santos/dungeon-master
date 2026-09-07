import { fetchSettings, updateSetting } from "@dungeon-master/api-client";
import type { UserSettings } from "@dungeon-master/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { api } from "@/lib/api";
import { useEventsStore } from "@/lib/events";

export const settingsQueryKey = ["settings"] as const;

/**
 * Configurações do usuário, com invalidação vinda do SSE.
 *
 * O ciclo completo é: PUT grava a configuração e o evento na mesma transação,
 * o trigger emite o NOTIFY, a API empurra `settings.changed` pelo stream, e o
 * hook invalida a query. Uma troca feita em outra aba, ou por outro processo,
 * chega a esta tela sem recarregar a página e sem polling.
 */
export function useSettings() {
  const queryClient = useQueryClient();
  const addListener = useEventsStore((state) => state.addListener);

  useEffect(() => {
    return addListener((event) => {
      if (event.type !== "settings.changed") return;
      void queryClient.invalidateQueries({ queryKey: settingsQueryKey });
    });
  }, [addListener, queryClient]);

  const query = useQuery({
    queryKey: settingsQueryKey,
    queryFn: () => fetchSettings(api),
  });

  const mutation = useMutation({
    mutationFn: ({ key, value }: { key: keyof UserSettings; value: unknown }) =>
      updateSetting(api, key, value),
    // A resposta do PUT já é o objeto completo. Escrever no cache aqui deixa a
    // tela certa mesmo que o evento demore ou se perca; quando ele chega, a
    // invalidação confirma contra o servidor.
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsQueryKey, settings);
    },
  });

  return { query, mutation };
}
