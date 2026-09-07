import { fetchHealth } from "@dungeon-master/api-client";
import { useQuery } from "@tanstack/react-query";
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

export const Route = createFileRoute("/")({
  component: HealthPage,
});

/**
 * Nenhum label de entidade aparece nesta tela.
 *
 * O vocabulário do tema (Campanha, Missão, Expedição) só entra pelo
 * `packages/glossary`, que chega em outra tarefa da Fase 0. Até lá, esta rota
 * mostra apenas infraestrutura, que por regra nunca é tematizada
 * (planejamento v0.4, seção 14).
 */
function HealthPage() {
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
