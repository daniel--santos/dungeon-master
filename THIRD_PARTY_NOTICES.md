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

### Sandcastle — packages/runtime (Fase 2C, execução em Docker)

#### `packages/runtime/src/docker.ts` (montagem do workspace)

- Origem: Sandcastle — `src/mountUtils.ts@e99f832` (`PARENT_GIT_SANDBOX_DIR`,
  `parseGitdirPath` e `patchGitMountsForWindows`)
- Copyright: (c) 2026 Matt Pocock. Licensed under the MIT License.
- Modo: adaptar
- Fase: 2C
- Testes: `packages/runtime/src/docker.test.ts`, com os casos de `mountUtils.test.ts` que
  se aplicam: clone comum (`.git` diretório, atalho de saída), worktree com `gitdir:` em
  caminho do Windows, worktree com `gitdir:` POSIX, `.git` sem a linha `gitdir:` e `.git`
  ilegível. Os casos da origem que não vieram são os que reescrevem uma lista de mounts
  vinda de `resolveGitMounts`, função que não existe aqui.
- Changes: o `Effect.gen`/`Effect.tryPromise` virou `async`/`await` com `try`/`catch`, e
  o `WorktreeError` virou o campo `warning` do resultado — um `.git` estranho vira
  `Diagnostic` e não derruba o Run. O remapeamento do `.git` pai deixou de ser
  condicional a `win32`: no original, fora do Windows o `.git` pai é montado no mesmo
  caminho do host e o `gitdir:` resolve por acaso, o que faz o caminho do host vazar para
  dentro do container e cria dois comportamentos para testar em vez de um. Aqui o
  destino é sempre `/.dungeon-master-parent-git` e o `.git` de sobreposição é sempre
  escrito. `parseGitdirPath` devolve `undefined` em vez de confiar na forma do caminho,
  porque a entrada vem de um arquivo no disco do usuário. A função produz os mounts do
  zero em vez de reescrever uma lista pré-existente. Os parâmetros injetáveis de I/O da
  origem foram preservados: são o que torna o comportamento de Windows testável na nossa
  matriz. Nenhum import de `effect` sobrou.

  O que **não** veio: `normalizeMounts`, `formatVolumeMount`, `processFileMountParents`,
  `resolveUserMounts` e `defaultImageName`. O ciclo de vida do container também é nosso e
  não do original — o Sandcastle usa `docker run -d` mais `docker exec` sobre uma imagem
  com `ENTRYPOINT ["sleep","infinity"]`, e aqui é um `docker run --rm` por Run, porque o
  `docker exec` de lá não aceita `-e` e o `env` do provider não chega a container longevo
  (documento técnico, seção 18.1). O `docker/agent.Dockerfile` tem entrada própria,
  logo abaixo.

#### `docker/agent.Dockerfile`

- Origem: Sandcastle — `.sandcastle/Dockerfile@e99f832` (v0.12.0)
- Copyright: (c) 2026 Matt Pocock. Licensed under the MIT License.
- Modo: adaptar
- Fase: 2C
- Testes: não há teste unitário de Dockerfile na origem. O que a origem garante por
  convenção, aqui é verificado pelo preflight de `packages/runtime`, que lê
  `docker image inspect --format '{{.Config.User}}'` e compara o `UID:GID` da imagem com
  o do worker antes de aceitar o modo container.
- Changes: base Node 24 em vez de 22; as CLIs são instaladas com versão fixa em vez de
  instalador remoto (npm para as três de Node, objeto versionado com SHA-512 conferido
  para o Antigravity); `gh` removido; `ENTRYPOINT ["sleep","infinity"]` removido porque
  aqui o container é de uma execução só (`docker run --rm`) e não um container longevo
  com `docker exec`; os diretórios de configuração das CLIs são criados no build para que
  um file mount não os crie como `root:root`.

  O que veio da origem é o **contrato de UID/GID** (ADR 0005 e ADR 0014 de lá): UID e GID
  como build args, o usuário `node` da imagem base renomeado para `agent` e realinhado, e
  `groupmod -o`/`usermod -o` obrigatórios — sem `-o` o build morre no macOS, onde o GID
  primário do usuário é 20 (`staff`), que a imagem base já entrega a `dialout`. O `USER`
  numérico, e não `USER agent`, é decisão nossa: é o que faz o `docker image inspect`
  devolver um `UID:GID` parseável para o preflight.

### TencentDB Agent Memory — packages/knowledge (Fase 6)

Manifesto: planejamento v0.4, seção 13.3. Todos os arquivos estão no commit fixado
`3efcd31`. Nenhum serviço veio: o `MemoryProxy`, o gateway, o store SQLite, a ACL e o
checkpoint ficaram de fora, como a seção 13.3 manda. O que entrou são prompts e helpers
autocontidos, reescritos em português e para os seis tipos fechados da Fase 6, sem a
camada de persona. As chamadas ao modelo passaram a entrar pelo `AgentRuntime` do projeto,
por uma porta, e não pelo `CleanContextRunner` do original.

#### `packages/knowledge/src/sanitize.ts`

`escapeXmlTags` veio para cá na Fase 6, antes do destino do manifesto, porque o Distiller
já persistia texto escrito por modelo. Na Fase 7 ela mudou para
`packages/context/src/sanitize.ts`, que é o destino do manifesto, e este arquivo passou a
importar de lá: só `sanitizeLlmText`, que é nosso, continua aqui. A entrada da cópia está
na seção da Fase 7, abaixo.

#### `packages/knowledge/src/l0-noise-filter.ts`

- Origem: TencentDB Agent Memory — `MemoryProxy/src/common/user-query-extractor.ts@3efcd31`
- Copyright: (c) 2026 Tencent. Licensed under the MIT License.
- Modo: adaptar
- Fase: 6
- Testes: `packages/knowledge/src/l0-noise-filter.test.ts` (o original não tem teste ao lado)
- Changes: `extractUserQueryText` virou `filterHarnessNoise`, aplicado ao texto que um Run
  gravou em `run_event` antes de entrar no prompt do Distiller, e não à mensagem do
  usuário de um proxy de chat. As três camadas ficaram (descarte da mensagem inteira quando
  é prompt interno da CLI; remoção dos wrappers XML injetados; filtro linha a linha dos
  ecos de ferramenta e do frontmatter de MEMORY.md), com a lista de wrappers ampliada com
  `local-command-stdout`, `command-name`, `command-message` e `function_results`. O bloco
  `<user_query>` do CodeBuddy e o marcador de sessão do DSH não vieram.

#### `packages/knowledge/src/prompts/extract-candidates.ts`

- Origem: TencentDB Agent Memory — `MemoryCore/src/core/prompts/l1-extraction.ts@3efcd31`
- Copyright: (c) 2026 Tencent. Licensed under the MIT License.
- Modo: adaptar
- Fase: 6
- Testes: `packages/knowledge/src/prompts/prompts.test.ts`
- Changes: a estrutura do prompt (princípios gerais, um bloco por tipo com definição e "o
  que não extrair", saída como JSON estrito com referência às fontes) é do original. A
  segmentação de situação e a camada de persona saíram; os tipos `persona`/`episodic`/
  `instruction` e os de trabalho viraram `FACT`, `DECISION`, `DISCOVERY`, `CONSTRAINT`,
  `PROCEDURE`; a entrada deixou de ser uma conversa e virou os candidatos que os agentes já
  escreveram, mais o L0 do Run como contexto; o julgamento de duplicata entra no mesmo
  prompt, porque aqui é uma chamada por lote. Prompt reescrito em português.

#### `packages/knowledge/src/prompts/dedup-judge.ts` e `packages/knowledge/src/dedup.ts`

- Origem: TencentDB Agent Memory — `MemoryCore/src/core/prompts/l1-dedup.ts@3efcd31` e
  `MemoryCore/src/core/record/l1-dedup.ts@3efcd31`
- Copyright: (c) 2026 Tencent. Licensed under the MIT License.
- Modo: adaptar
- Fase: 6
- Testes: `packages/knowledge/src/dedup.test.ts` e `prompts/prompts.test.ts` (os originais
  não têm teste ao lado)
- Changes: o pool unificado, o julgamento em lote e o funil em duas fases com fail-open ("na
  dúvida, store") são do original. As quatro ações (`store`/`skip`/`update`/`merge`) viraram
  três (`PROMOTE`/`REJECT`/`MERGE`): um item já revisado por um humano não é reescrito por
  modelo, e a mescla só liga o candidato ao item. `record_id` virou chaves curtas (`C1`,
  `K1`), `merged_priority` e `merged_timestamps` saíram. O recall vetorial e o FTS5 do
  SQLite saíram; o recall é uma porta implementada com o FTS do PostgreSQL em
  `packages/database/src/knowledge-distiller.ts`. A chamada ao modelo saiu do arquivo e
  mora no Distiller; a normalização fail-open passou a traduzir chaves, sanitizar todo texto
  e inferir o tipo pelo `kind` quando o modelo não disse.

#### `packages/knowledge/src/prompts/project-summary.ts`

- Origem: TencentDB Agent Memory — `MemoryCore/src/core/prompts/scene-extraction.ts@3efcd31`
  e `MemoryCore/src/offload_server/prompts/l2-prompt.ts@3efcd31` (guardrails, linhas 9–18)
- Copyright: (c) 2026 Tencent. Licensed under the MIT License.
- Modo: adaptar
- Fase: 6
- Testes: `packages/knowledge/src/prompts/prompts.test.ts`
- Changes: o papel do "arquiteto de consolidação" (narrativa em vez de lista, integrar em
  vez de anexar, reescrever) e os guardrails do L2 (agregar, lápide para o que não deu
  certo, conclusão em vez de cronologia, só o que aconteceu, tudo com fonte) são do
  original. Os arquivos de cena e as ferramentas `read`/`write`/`edit` saíram — o modelo não
  toca disco e devolve um documento como JSON; os "scene blocks" viraram os itens ativos do
  Grimório e o `persona.md` virou o Project Summary corrente; o limite de cenas virou o teto
  de tamanho. Prompt reescrito em português.

#### `packages/knowledge/src/summary-trigger.ts`

- Origem: TencentDB Agent Memory — `MemoryCore/src/core/persona/persona-trigger.ts@3efcd31`
- Copyright: (c) 2026 Tencent. Licensed under the MIT License.
- Modo: adaptar
- Fase: 6
- Testes: `packages/knowledge/src/summary-trigger.test.ts` (o original não tem teste ao lado)
- Changes: a classe que lia o checkpoint do disco virou uma função pura sobre fatos que a
  porta entrega; as cinco condições da persona viraram as cinco condições de regeneração
  do Project Summary — pedido explícito, partida a frio, recuperação de um resumo sem
  corpo, itens cobertos que mudaram na revisão, limiar de itens novos. Sem
  `CheckpointManager` nem `StorageAdapter`.

#### `packages/knowledge/src/distiller-scheduler.ts`

- Origem: TencentDB Agent Memory — `MemoryCore/src/utils/pipeline-manager.ts@3efcd31`
  (gatilhos de L1 e L2) e `MemoryCore/src/utils/managed-timer.ts@3efcd31` (`tryAdvanceTo`)
- Copyright: (c) 2026 Tencent. Licensed under the MIT License.
- Modo: ler (extrair só a lógica)
- Fase: 6
- Testes: `packages/knowledge/src/distiller-scheduler.test.ts`
- Changes: só a lógica de lote, ociosidade reiniciável e timer que só anda para baixo veio;
  o `setTimeout`, o `ManagedTimer`, as filas seriais e o checkpoint não. A sessão de chat
  virou o Project; o scheduler não tem relógio próprio — o laço do Worker pergunta
  `due(now)` a cada tique, e é isso que o torna testável sem esperar.

### TencentDB Agent Memory — packages/context (Fase 7)

Manifesto: planejamento v0.4, seção 13.3, as três linhas da Fase 7. Todos os arquivos
estão no commit fixado `3efcd31`. Nenhum dos três tem teste ao lado na origem; os testes
são nossos e rodam na matriz de CI. O `graph-search.ts` do manifesto (modo "ler", etapa 5
do retrieval) não veio: o Grimório ainda não tem wikilinks.

#### `packages/context/src/sanitize.ts`

- Origem: TencentDB Agent Memory — `MemoryCore/src/utils/sanitize.ts@3efcd31`
  (`escapeXmlTags`) e `MemoryCore/src/core/scene/scene-navigation.ts@3efcd31`
  (`stripSceneNavigation`)
- Copyright: (c) 2026 Tencent. Licensed under the MIT License.
- Modo: copiar função (as duas)
- Fase: 7 (`escapeXmlTags` tinha vindo antes, na Fase 6, para `packages/knowledge`; agora
  mora aqui e o knowledge importa daqui — uma fonte só)
- Testes: `packages/context/src/sanitize.test.ts` (os originais não têm teste ao lado)
- Changes: a lista de tags escapadas deixou de ser a das seções de memória pessoal
  (`user-persona`, `relevant-memories`, ...) e passou a ser a das fronteiras que este
  projeto usa em prompt — as clássicas `system`, `assistant` e `user`, as do resultado e
  dos candidatos, e as seções do bloco de contexto (`context`, `project-summary`,
  `decisions`, `knowledge`, `related-tasks`, `artifacts`, `skills` e os itens delas).
  `stripSceneNavigation` virou `stripInjectedContext`: o marcador deixou de ser o
  cabeçalho da navegação de cenas do `persona.md` e passou a ser o cabeçalho fixo do nosso
  bloco de contexto — o que ela evita é o mesmo laço de realimentação, um texto escrito
  por modelo que ecoou o bloco que recebeu e o devolveria ao prompt seguinte. O algoritmo
  (primeira ocorrência do cabeçalho, corte dali até o fim, `trimEnd`) é o do original. O
  resto dos dois arquivos de origem (limpeza de metadados de gateway, filtros L0/L1,
  detecção de injeção, JSON; a geração da navegação com emojis de calor e caminhos de
  arquivo) não veio. `sanitizeForContext` é nosso, por cima das duas.

#### `packages/context/src/token-estimate.ts`

- Origem: TencentDB Agent Memory — `MemoryCore/src/offload/fast-token-estimate.ts@3efcd31`
- Copyright: (c) 2026 Tencent. Licensed under the MIT License.
- Modo: copiar
- Fase: 7
- Testes: `packages/context/src/token-estimate.test.ts` (o original não tem teste ao lado)
- Changes: a tabela binária de custo por caractere CJK (`cjk_token_table.bin`, lida do
  disco por `readFileSync`) não veio — o pacote é puro e não toca arquivo —, então todo
  Han usa a constante de 1,3 token que o original já usava quando a tabela não estava
  disponível; os imports de `fs`, `path` e `url` saíram com ela. `fastEstimateMessages`
  deixou de aceitar `any[]` e passou a receber `readonly unknown[]`. Comentários
  traduzidos; o algoritmo de classificação por codepoint e os coeficientes por categoria
  são os do original. É o estimador do orçamento de contexto.

## Licença deste projeto

Dungeon Master é distribuído sob a licença MIT. Veja [`LICENSE`](./LICENSE).
