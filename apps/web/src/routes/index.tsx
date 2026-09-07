import { fetchHealth, sendPing } from "@dungeon-master/api-client";
import type { UiTheme } from "@dungeon-master/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/lib/api";
import { type ConnectionStatus, useEventsStore } from "@/lib/events";
import { useSettings } from "@/lib/settings";

export const Route = createFileRoute("/")({
  component: HomePage,
});

/**
 * Nenhum label de entidade aparece nesta tela.
 *
 * O vocabulário do tema (Campanha, Missão, Expedição) só entra pelo
 * `packages/glossary`, que chega em outra tarefa da Fase 0. Até lá, esta rota
 * mostra apenas infraestrutura, que por regra nunca é tematizada
 * (planejamento v0.4, seção 14).
 */
function HomePage() {
  return (
    <div className="space-y-6">
      <HealthCard />
      <EventsCard />
      <SettingsCard />
    </div>
  );
}

function HealthCard() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchHealth(api),
    refetchInterval: 15_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Saúde da API</CardTitle>
        <CardDescription>
          Resultado de <code>GET /api/v1/health</code>, consumido pelo cliente gerado da spec
          OpenAPI.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        {health.isPending && <p className="text-muted-foreground">Consultando a API...</p>}

        {health.isError && (
          <p className="text-destructive">
            A API não respondeu. Suba com <code>pnpm dev:api</code> e confirme o proxy do Vite.
          </p>
        )}

        {health.data && (
          <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="font-medium">{health.data.status}</dd>

            <dt className="text-muted-foreground">Serviço</dt>
            <dd>{health.data.service}</dd>

            <dt className="text-muted-foreground">Versão</dt>
            <dd>{health.data.version}</dd>

            <dt className="text-muted-foreground">No ar há</dt>
            <dd>{health.data.uptimeSeconds.toFixed(1)} s</dd>

            <dt className="text-muted-foreground">Banco</dt>
            <dd>
              {health.data.database.ok
                ? `respondeu ao SELECT 1 em ${health.data.database.latencyMs} ms`
                : (health.data.database.error ?? "sem resposta")}
            </dd>

            <dt className="text-muted-foreground">Checado em</dt>
            <dd>{health.data.checkedAt}</dd>
          </dl>
        )}
      </CardContent>

      <CardFooter>
        <Button onClick={() => void health.refetch()} disabled={health.isFetching}>
          {health.isFetching ? "Atualizando..." : "Atualizar"}
        </Button>
      </CardFooter>
    </Card>
  );
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "conectando",
  open: "conectado",
  reconnecting: "reconectando",
};

function EventsCard() {
  const status = useEventsStore((state) => state.status);
  const lastSequence = useEventsStore((state) => state.lastSequence);
  const lastEvent = useEventsStore((state) => state.lastEvent);
  const received = useEventsStore((state) => state.received);

  const ping = useMutation({ mutationFn: () => sendPing(api) });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stream de eventos</CardTitle>
        <CardDescription>
          <code>GET /api/v1/events/stream</code> por <code>EventSource</code>. O cursor é a
          <code>sequence</code> do último evento; ao reconectar, ele volta para a API e o replay
          continua de onde parou.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">Conexão</dt>
          <dd className="flex items-center gap-2 font-medium">
            <span
              aria-hidden
              className={`inline-block size-2 rounded-full ${
                status === "open" ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
            {STATUS_LABEL[status]}
          </dd>

          <dt className="text-muted-foreground">Cursor</dt>
          <dd>{lastSequence === 0 ? "nenhum evento ainda" : lastSequence}</dd>

          <dt className="text-muted-foreground">Recebidos aqui</dt>
          <dd>{received}</dd>

          <dt className="text-muted-foreground">Último evento</dt>
          <dd>
            {lastEvent === null ? (
              <span className="text-muted-foreground">nenhum</span>
            ) : (
              <span>
                <code>{lastEvent.type}</code> em {lastEvent.createdAt}
              </span>
            )}
          </dd>
        </dl>

        {lastEvent !== null && (
          <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">
            {JSON.stringify(lastEvent.payload, null, 2)}
          </pre>
        )}

        {ping.isError && <p className="text-destructive">{ping.error.message}</p>}
      </CardContent>

      <CardFooter>
        <Button onClick={() => ping.mutate()} disabled={ping.isPending}>
          {ping.isPending ? "Enviando..." : "Ping"}
        </Button>
      </CardFooter>
    </Card>
  );
}

const TEMAS: UiTheme[] = ["dnd", "plain"];

function SettingsCard() {
  const { query, mutation } = useSettings();
  const tema = query.data?.["ui.theme"];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configurações</CardTitle>
        <CardDescription>
          Prova do ciclo completo: o <code>PUT</code> grava a configuração e o evento na mesma
          transação, o evento chega por SSE e a query se invalida sozinha. O interruptor de tema de
          verdade, com os labels do glossário, é da Fase 1.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        {query.isPending && <p className="text-muted-foreground">Lendo as configurações...</p>}
        {query.isError && <p className="text-destructive">{query.error.message}</p>}

        {tema !== undefined && (
          <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">
              <code>ui.theme</code>
            </dt>
            <dd className="font-medium">{tema}</dd>
          </dl>
        )}

        {mutation.isError && <p className="text-destructive">{mutation.error.message}</p>}
      </CardContent>

      <CardFooter className="gap-2">
        {TEMAS.map((valor) => (
          <Button
            key={valor}
            variant={valor === tema ? "default" : "outline"}
            disabled={mutation.isPending || valor === tema}
            onClick={() => {
              mutation.mutate({ key: "ui.theme", value: valor });
            }}
          >
            {valor}
          </Button>
        ))}
      </CardFooter>
    </Card>
  );
}
