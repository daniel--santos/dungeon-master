import { fetchHealth, sendPing } from "@dungeon-master/api-client";
import { useMutation, useQuery } from "@tanstack/react-query";

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

/**
 * Diagnóstico da plataforma, o que era a rota `/` na Fase 0.
 *
 * Nenhum label de entidade aparece aqui: só infraestrutura, que por regra
 * nunca é tematizada (planejamento v0.4, seção 14).
 */
export function DiagnosticsSection() {
  return (
    <section className="flex max-w-[760px] flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-base font-semibold">Diagnóstico</span>
        <span className="text-muted-foreground text-[13px]">
          O caminho entre a web, a API, o banco e o stream de eventos.
        </span>
      </div>

      <HealthCard />
      <EventsCard />
      <RawThemeCard />
    </section>
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

function RawThemeCard() {
  const { query } = useSettings();
  const theme = query.data?.["ui.theme"];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Valor bruto de <code>ui.theme</code>
        </CardTitle>
        <CardDescription>
          O que está gravado em <code>user_setting</code>, sem passar pelo glossário. É o par do
          interruptor acima: se os dois discordarem, o problema está entre a store e a API.
        </CardDescription>
      </CardHeader>

      <CardContent className="text-sm">
        {query.isPending && <p className="text-muted-foreground">Lendo as configurações...</p>}
        {query.isError && <p className="text-destructive">{query.error.message}</p>}
        {theme !== undefined && (
          <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">
              <code>ui.theme</code>
            </dt>
            <dd className="font-medium">{theme}</dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
