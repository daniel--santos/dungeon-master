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

export interface HostAcknowledgement {
  /** `true` depois que o usuário aceitou executar sem isolamento. */
  readonly acknowledged: boolean;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  /** Grava o aceite, ou o revoga. */
  readonly set: (value: boolean) => void;
}

/**
 * O aceite explícito do modo `HOST`, lembrado entre Expedições.
 *
 * A Fase 2B exige aceite explícito antes de executar sem isolamento. Perguntar
 * a cada partida treinaria o usuário a marcar a caixa sem ler, então o aceite
 * fica em `user_setting` e Settings oferece revogá-lo. Lembrar o aceite não
 * apaga o aviso: o badge de ambiente e o texto canônico continuam em toda tela
 * que fala de execução.
 */
export function useHostAcknowledgement(): HostAcknowledgement {
  const { query, mutation } = useSettings();

  return {
    acknowledged: query.data?.["execution.hostAcknowledged"] ?? false,
    isLoading: query.isPending,
    isSaving: mutation.isPending,
    set: (value: boolean) => {
      mutation.mutate({ key: "execution.hostAcknowledged", value });
    },
  };
}
