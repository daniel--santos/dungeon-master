# Third Party Notices

Este produto inclui trechos de código copiados ou adaptados de projetos de terceiros
licenciados sob a licença MIT. O aviso de copyright e a permissão de cada titular
acompanham o respectivo código, conforme exigido pela licença.

O manifesto completo do que pode ser reaproveitado, com origem, modo (copiar, adaptar
ou ler), destino e fase, está na seção 13 de `docs/planejamento_dungeon_master_v0.4.md`.

## Regras (seção 13.0 do planejamento)

1. Nada é vendorizado como subsistema. Somente utilitários autocontidos, prompts e
   trechos de SQL.
2. Todo arquivo copiado ou adaptado leva o cabeçalho padrão abaixo **e** uma entrada
   nesta página.
3. Testes que acompanham o arquivo de origem são copiados junto e passam a rodar na
   nossa matriz de CI (`windows-latest` + `macos-latest`).
4. Antes de copiar, verificar imports de `bun:` / `Bun.` (Archon) e de `effect`
   (Sandcastle), e removê-los.
5. Commits de referência ficam fixados na tabela de projetos; qualquer atualização
   futura compara contra eles.

Cabeçalho padrão de todo arquivo copiado ou adaptado:

```ts
// Adapted from <projeto> — <caminho no repositório de origem>@<commit>
// Copyright (c) <ano> <titular>. Licensed under the MIT License.
// Changes: <resumo das adaptações feitas aqui>
```

## Projetos de referência e commits fixados

| Projeto                                                                          | Titular     | Licença | Commit fixado       | Data       |
| -------------------------------------------------------------------------------- | ----------- | ------- | ------------------- | ---------- |
| [Sandcastle](https://github.com/mattpocock/sandcastle)                           | Matt Pocock | MIT     | `e99f832` (v0.12.0) | 29/06/2026 |
| [Archon](https://github.com/coleam00/Archon)                                     | Cole Medin  | MIT     | `0773b97`           | 01/09/2026 |
| [TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) | Tencent     | MIT     | `3efcd31`           | 31/08/2026 |

## Entradas

Cada arquivo importado recebe uma entrada nesta seção, no formato abaixo.

```text
### <caminho no nosso repositório>

- Origem: <projeto> — <caminho no repositório de origem>@<commit>
- Copyright: (c) <ano> <titular>. Licensed under the MIT License.
- Modo: copiar | adaptar
- Fase: <n>
- Changes: <resumo das adaptações>
```

Cada seção abaixo agrupa as entradas de um mesmo assunto. Os demais itens de Fase 0 do
manifesto (terminação de árvore de processos e validação de caminho do Archon,
isolamento de gitconfig do Sandcastle, regra de lint do frontend) entram em seções
próprias junto com `packages/platform`.

## Archon — SSE e eventos

Manifesto: planejamento v0.4, seção 13.2, linhas de `transport.ts`,
`dashboard-event-poller.ts` e do trecho de NOTIFY de `postgres.ts`.

Os três arquivos do Archon estão em `packages/server/src/adapters/web/` e
`packages/core/src/db/adapters/`, todos no commit fixado `0773b97`. Nenhum deles usa
API do Bun, o que a análise de 07/09/2026 já havia confirmado. O manifesto aponta o
transport e o poller para `apps/api/src/sse/`; eles foram para `packages/events` porque
não dependem de Hono nem de `pg` — a API entrega o writer e a fonte de eventos por
injeção, e o pacote roda inteiro em teste sem infraestrutura.

### `packages/events/src/sse-transport.ts`

- Origem: Archon — `packages/server/src/adapters/web/transport.ts@0773b97`
- Copyright: (c) 2026 Cole Medin. Licensed under the MIT License.
- Modo: adaptar
- Fase: 0
- Testes: `packages/events/src/sse-transport.test.ts`
- Changes: a chave deixou de ser `conversationId` e passou a ser uma assinatura por
  conexão; o buffer de replay passou a ser indexado por `sequence`, o que troca
  "reenviar tudo que estava guardado" por "reenviar o que vem depois do cursor" e
  elimina duplicata na reconexão; `Bun.serve` saiu e o writer virou uma interface; o
  logger virou contrato opcional; entrou heartbeat. O invariante
  `EVENT_BUFFER_TTL_MS >= RECONNECT_GRACE_MS` foi mantido, ainda lança no carregamento
  do módulo e agora também vale para os valores passados ao construtor.

### `packages/events/src/dashboard-event-poller.ts`

- Origem: Archon — `packages/server/src/adapters/web/dashboard-event-poller.ts@0773b97`
- Copyright: (c) 2026 Cole Medin. Licensed under the MIT License.
- Modo: adaptar
- Fase: 0
- Testes: `packages/events/src/dashboard-event-poller.test.ts`
- Changes: o cursor deixou de ser `created_at` e passou a ser a `sequence` do
  `bigserial`, o que dispensa o `>= cursor` mais `seenAtBoundary` que o original precisa
  por causa da resolução de 1 segundo do SQLite; a fonte de dados entra por injeção; o
  stream `__dashboard__` virou "todo mundo conectado", porque o sistema é single-user. A
  coalescência de drains, a paginação até esvaziar e a escalada de log depois de cinco
  falhas seguidas são do original.

### `packages/events/src/pg-notify-listener.ts`

- Origem: Archon — `packages/server/src/adapters/web/pg-notify-listener.ts@0773b97`
- Copyright: (c) 2026 Cole Medin. Licensed under the MIT License.
- Modo: adaptar
- Fase: 0
- Testes: `packages/events/src/pg-notify-listener.test.ts`
- Changes: o `DbNotificationListener` virou a interface `Notifier` declarada no próprio
  arquivo, para o pacote não importar `pg`; o canal entra por parâmetro; o logger virou
  contrato opcional. A reconexão com backoff exponencial, o teto de 30 s e o cuidado com
  `stop()` durante um `listen()` em voo são do original.

### `packages/database/src/notify.ts` e o trigger da migração `0001`

- Origem: Archon — `packages/core/src/db/adapters/postgres.ts@0773b97` (`listen()` e o
  SQL de `WORKFLOW_EVENT_NOTIFY_SQL`)
- Copyright: (c) 2026 Cole Medin. Licensed under the MIT License.
- Modo: adaptar
- Fase: 0
- Testes: `packages/database/test/dashboard-event.test.ts`
- Changes: `listen()` saiu do `PostgresAdapter` e virou uma função sobre um `Pool`; a
  validação do nome do canal e o descarte da conexão dedicada (em vez de devolvê-la ao
  pool) são do original. O trigger deixou de carregar `NEW.workflow_run_id` e passou a
  emitir `pg_notify` **sem payload** de verdade, e passou a ser `FOR EACH STATEMENT`; ele
  vive numa migração versionada, e não num `CREATE OR REPLACE` a cada boot, porque aqui
  o PostgreSQL é o único banco suportado.

## Licença deste projeto

Dungeon Master é distribuído sob a licença MIT. Veja [`LICENSE`](./LICENSE).
