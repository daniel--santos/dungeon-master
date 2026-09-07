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

Todos os itens de Fase 0 do manifesto que envolvem cópia de código estão registrados
abaixo. A regra de lint do frontend foi escrita do zero em `eslint.config.mjs` e não é
cópia, por isso não tem entrada.

### Archon — packages/platform

#### `packages/platform/src/process-tree.ts`

- Origem: Archon — `packages/cli/src/utils/detached-run-control.ts@0773b97`, linhas 454–572
- Copyright: (c) 2026 Cole Medin. Licensed under the MIT License.
- Modo: adaptar (extrair)
- Fase: 0
- Changes: extraídos só `processExists`, `waitUntilGone`, `processGroupExists`,
  `commandTerminatedBySignal` e a terminação por sistema operacional; o IPC por socket
  e a lease de execução, que são o resto do arquivo, não vieram.
  `terminateDetachedProcessTree` virou `terminateProcessTree` e devolve
  `TerminationResult` em vez de lançar: o contrato passou a ser nunca lançar por causa
  do alvo, vivo ou morto, e lançar só por argumento inválido. As esperas viraram
  parâmetros (`graceMs`, `confirmMs`). No POSIX, um alvo que não lidera grupo nenhum
  deixou de ser erro e passa a ser sinalizado sozinho. Mensagens em português.

#### `packages/platform/src/path-validation.ts` e `path-validation.test.ts`

- Origem: Archon — `packages/core/src/utils/path-validation.ts@0773b97` e o `.test.ts` ao lado
- Copyright: (c) 2026 Cole Medin. Licensed under the MIT License.
- Modo: adaptar
- Fase: 0
- Changes: a raiz permitida deixou de vir de `@archon/paths` e virou o primeiro
  argumento, porque aqui a restrição é por working directory de Run e não por um
  diretório global; `isPathWithinWorkspace` virou `isPathWithinRoot`. A comparação
  passou a ser case-insensitive no Windows e no macOS, onde o sistema de arquivos é
  case-insensitive por padrão. Acrescentados `normalizeAbsolutePath`, `isInside` e
  `samePath`. No teste, `bun:test` virou Vitest, os casos deixaram de depender de
  variáveis de ambiente do Archon e os caminhos literais POSIX viraram caminhos válidos
  no sistema que estiver rodando, para o mesmo arquivo servir Windows e macOS.

### Sandcastle

#### `tooling/vitest/git-isolation.ts`

- Origem: Sandcastle — `src/testSetup.ts@e99f832`
- Copyright: (c) 2026 Matt Pocock. Licensed under the MIT License.
- Modo: copiar
- Fase: 0
- Changes: comentários traduzidos para o português; nenhuma mudança de comportamento.
  O arquivo não tinha import de `effect` para remover. O teste que prova o isolamento
  (`tooling/vitest/test/`) é nosso: o original não tinha um.

### Archon — SSE e eventos

Manifesto: planejamento v0.4, seção 13.2, linhas de `transport.ts`,
`dashboard-event-poller.ts` e do trecho de NOTIFY de `postgres.ts`.

Os três arquivos do Archon estão em `packages/server/src/adapters/web/` e
`packages/core/src/db/adapters/`, todos no commit fixado `0773b97`. Nenhum deles usa
API do Bun, o que a análise de 07/09/2026 já havia confirmado. O manifesto aponta o
transport e o poller para `apps/api/src/sse/`; eles foram para `packages/events` porque
não dependem de Hono nem de `pg` — a API entrega o writer e a fonte de eventos por
injeção, e o pacote roda inteiro em teste sem infraestrutura.

#### `packages/events/src/sse-transport.ts`

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

#### `packages/events/src/dashboard-event-poller.ts`

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

#### `packages/events/src/pg-notify-listener.ts`

- Origem: Archon — `packages/server/src/adapters/web/pg-notify-listener.ts@0773b97`
- Copyright: (c) 2026 Cole Medin. Licensed under the MIT License.
- Modo: adaptar
- Fase: 0
- Testes: `packages/events/src/pg-notify-listener.test.ts`
- Changes: o `DbNotificationListener` virou a interface `Notifier` declarada no próprio
  arquivo, para o pacote não importar `pg`; o canal entra por parâmetro; o logger virou
  contrato opcional. A reconexão com backoff exponencial, o teto de 30 s e o cuidado com
  `stop()` durante um `listen()` em voo são do original.

#### `packages/database/src/notify.ts` e o trigger da migração `0001`

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

### Archon — Fase 2

#### `packages/events/src/credential-sanitizer.ts` e `credential-sanitizer.test.ts`

- Origem: Archon — `packages/core/src/utils/credential-sanitizer.ts@0773b97` e o `.test.ts` ao lado
- Copyright: (c) 2026 Cole Medin. Licensed under the MIT License.
- Modo: adaptar
- Fase: 2
- Testes: `packages/events/src/credential-sanitizer.test.ts`
- Changes: a lista de variáveis sensíveis passou a incluir as chaves de API dos harnesses
  (Anthropic, OpenAI, Google) além dos tokens de git, porque aqui o alvo é o payload de
  evento de um agente e não a saída de um `git clone`; entrou `sanitizeJson`, que aplica a
  mesma função a todo texto de uma estrutura JSON, que é a forma em que os payloads de
  `run_event` chegam; entrou `MIN_SECRET_LENGTH`, para uma variável definida como `true`
  não transformar toda ocorrência da palavra em `[REDACTED]`; a lista de nomes e a origem
  dos valores deixaram de ser globais e viraram parâmetros opcionais, para o teste não
  depender de `process.env`, que em execução paralela do Vitest é estado compartilhado. A
  redação do `userinfo` de qualquer URL, que é o coração do arquivo, é do original.

#### `packages/events/src/terminal-status-write.ts`

- Origem: Archon — `packages/workflows/src/terminal-status-write.ts@0773b97`
- Copyright: (c) 2026 Cole Medin. Licensed under the MIT License.
- Modo: copiar
- Fase: 2
- Testes: `packages/events/src/terminal-status-write.test.ts` (o original não tem teste ao lado)
- Changes: `workflowRunId` virou `runId`, porque aqui o terminal é de Run e não de workflow
  run; o logger de `@archon/paths` virou o contrato opcional `EventsLogger` deste pacote,
  para ele continuar sem infraestrutura; `cause` passou a usar a propriedade nativa de
  `Error`; entrou `isTerminalStatusWriteError`, para o worker reconhecer o erro sem
  `instanceof`, que falharia com duas cópias do pacote no `node_modules`.

#### `packages/runs/src/capacity-lock.ts` e `capacity-lock.test.ts`

- Origem: Archon — `packages/core/src/utils/conversation-lock.ts@0773b97` e o `.test.ts` ao lado
- Copyright: (c) 2026 Cole Medin. Licensed under the MIT License.
- Modo: adaptar
- Fase: 2
- Testes: `packages/runs/src/capacity-lock.test.ts`
- Changes: `conversationId` virou `runId` e a fila por conversa virou fila por chave de
  recurso; o logger de `@archon/paths` virou contrato opcional; `acquireLock` deixou de ser
  fire-and-forget e passou a devolver também a promessa da execução, para o worker
  conseguir esperar o próprio trabalho sem espiar o estado interno; entrou `drain()`, pelo
  mesmo motivo, no desligamento; entraram o teto de fila e o descarte explícito, para uma
  rajada não crescer a fila sem limite. A trava sequencial por chave, o teto global, a
  distinção entre `queued-key` e `queued-capacity` e a liberação de capacidade que
  reprocessa a fila global são do original.

#### O trigger de `run_event` na migração `0004`

- Origem: Archon — `packages/core/src/db/adapters/postgres.ts@0773b97` (o SQL de NOTIFY)
- Copyright: (c) 2026 Cole Medin. Licensed under the MIT License.
- Modo: adaptar
- Fase: 2
- Testes: `apps/api/test/runs.test.ts` (replay e stream por Run)
- Changes: mesmo padrão do trigger de `dashboard_event` da migração `0001`, agora sobre
  `run_event` e no canal `dm_run_event`. Sem payload e `FOR EACH STATEMENT`, para um
  `INSERT` em lote de eventos de um Run acordar o drain uma vez.

### Sandcastle — packages/runtime e runtime-sandcastle (Fase 2)

#### `packages/runtime/src/bounded-tail.ts` e `bounded-tail.test.ts`

- Origem: Sandcastle — `src/boundedTail.ts@e99f832` e o `.test.ts` ao lado
- Copyright: (c) 2026 Matt Pocock. Licensed under the MIT License.
- Modo: copiar
- Fase: 2
- Testes: `packages/runtime/src/bounded-tail.test.ts`, com os oito casos da origem
- Changes: comentários traduzidos para o português e ampliados com o motivo nosso (a
  cauda é o texto de onde o bloco `<result>` é extraído); `items.shift()!` virou uma
  checagem explícita, porque `noUncheckedIndexedAccess` está ligado aqui. Nenhuma
  mudança de comportamento. O arquivo não tinha import de `effect` para remover.

#### `packages/runtime/src/structured-output.ts`

- Origem: Sandcastle — `src/extractStructuredOutput.ts@e99f832` e
  `src/run.ts@e99f832` (`buildStructuredOutputRetryFeedback`)
- Copyright: (c) 2026 Matt Pocock. Licensed under the MIT License.
- Modo: adaptar
- Fase: 2
- Testes: `packages/runtime/src/structured-output.test.ts`
- Changes: a extração deixou de lançar `StructuredOutputError` e passou a devolver um
  resultado discriminado, porque o runtime nunca lança para o consumidor — toda falha
  vira `ExecutionEvent`. A validação passou a aceitar qualquer Standard Schema pela
  interface mínima declarada em `standard-schema.ts`, sem depender de
  `@standard-schema/spec`. A montagem da instrução do prompt passou a viver aqui; no
  original, `run()` apenas verifica se a tag aparece no prompt de quem chamou. O
  contexto de commits, branch e worktree saiu do erro: aqui isso vive no evento. A regra
  "última ocorrência vence" e o desembrulho de cerca de código são do original.

#### `packages/runtime/src/workspace.ts` (par de flags do `worktree add`)

- Origem: Sandcastle — `src/WorktreeManager.ts@e99f832` (`NO_CONFIG_LOCK_FLAGS`)
- Copyright: (c) 2026 Matt Pocock. Licensed under the MIT License.
- Modo: ler (reimplementado)
- Fase: 2
- Testes: `packages/runtime/src/workspace.test.ts`
- Changes: só a ideia veio — `-c branch.autoSetupMerge=false -c push.autoSetupRemote=false`
  evita que o `worktree add` escreva em `.git/config` e dispute o `.git/config.lock` com
  outra criação concorrente. O resto do `WorktreeManager` não foi copiado: a nossa
  localização de worktree, a nomeação por Run e a política de preservação são outras, e
  a trava por par (repositório, caminho) vive no PostgreSQL.

#### `packages/runtime-sandcastle/src/claude-code.ts`, `codex.ts` e `pi.ts`

- Origem: Sandcastle — `src/AgentProvider.ts@e99f832` (providers `claudeCode`, `codex` e
  `pi`, com `parseStreamJsonLine`, `parseCodexStreamLine`, `parsePiStreamLine`,
  `parseCodexUsage` e `parseSessionUsage`)
- Copyright: (c) 2026 Matt Pocock. Licensed under the MIT License.
- Modo: ler (reimplementado com a mesma estrutura)
- Fase: 2
- Testes: `packages/runtime-sandcastle/src/parsers.test.ts`, com linhas reais das três
  CLIs capturadas em 07/09/2026, e a suíte de contrato em `contract.test.ts`
- Changes: o argv deixou de ser uma linha de comando de shell montada por concatenação e
  virou array, porque este projeto nunca usa shell (CLAUDE.md, seção 8) e o `shellEscape`
  do original usa aspas simples, que o `cmd.exe` não reconhece. Os parsers deixaram de
  descartar as ferramentas fora de uma allow-list de quatro nomes e passaram a traduzir
  todas, mais `tool_result`, `Artifact` e permissão negada; no Pi a comparação do
  original é contra nomes em maiúsculas e a CLI emite em minúsculas, de modo que nenhuma
  chamada de ferramenta sobrevivia. O bypass de permissões deixou de ser o padrão e
  passou a exigir política explícita. `codex exec fork` não existe na CLI 0.147.0, então
  `forkSession` é `false` em vez de prometido. O raciocínio de qual flag usar, qual linha
  traz o id de sessão e como mapear o consumo de tokens de cada harness é do original.

## Licença deste projeto

Dungeon Master é distribuído sob a licença MIT. Veja [`LICENSE`](./LICENSE).
