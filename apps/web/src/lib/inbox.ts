import type { components } from "@dungeon-master/api-client";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { fail } from "@/lib/problem";

/**
 * A captura rápida, que no modelo são Tasks em `INBOX` sem Project.
 *
 * Promover atribui o Project e leva a `READY`; descartar leva a `CANCELLED`
 * sem apagar a linha, porque o que foi capturado continua auditável.
 */

type InboxPage = components["schemas"]["InboxPage"];
type Task = components["schemas"]["Task"];
type PromoteBody = components["schemas"]["PromoteInbox"];

export const inboxKeys = {
  all: ["inbox"] as const,
  page: (page: number, pageSize: number) => ["inbox", "page", page, pageSize] as const,
};

export function useInbox(page = 1, pageSize = 50): UseQueryResult<InboxPage> {
  return useQuery({
    queryKey: inboxKeys.page(page, pageSize),
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/inbox", {
        params: { query: { page: String(page), pageSize: String(pageSize) } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível ler as capturas");
      return data;
    },
  });
}

/** Só o total, para quem mostra a contagem sem precisar da lista. */
export function useInboxCount(): UseQueryResult<number> {
  return useQuery({
    queryKey: [...inboxKeys.all, "count"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/v1/inbox", {
        params: { query: { page: "1", pageSize: "1" } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível contar as capturas");
      return data.total;
    },
  });
}

export function useCaptureInbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (text: string): Promise<Task> => {
      const { data, error, response } = await api.POST("/api/v1/inbox", { body: { text } });
      if (data === undefined) fail(error, response.status, "Não foi possível capturar");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inboxKeys.all });
    },
  });
}

export interface PromoteInput extends PromoteBody {
  readonly id: string;
}

export function usePromoteInbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...body }: PromoteInput): Promise<Task> => {
      const { data, error, response } = await api.POST("/api/v1/inbox/{id}/promote", {
        params: { path: { id } },
        body,
      });
      if (data === undefined) fail(error, response.status, "Não foi possível promover a captura");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inboxKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDiscardInbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<Task> => {
      const { data, error, response } = await api.POST("/api/v1/inbox/{id}/discard", {
        params: { path: { id } },
      });
      if (data === undefined) fail(error, response.status, "Não foi possível descartar a captura");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inboxKeys.all });
    },
  });
}
