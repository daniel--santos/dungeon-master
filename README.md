# Dungeon Master

Plataforma pessoal de trabalho com agentes de IA, com um toque de RPG de mesa.

O produto captura, organiza, executa, acompanha e aprende com trabalho realizado por
agentes de IA. A interface web é o **Control Plane** de todo o sistema. O núcleo não é
chat: é `Project → Task → Run → Result`.

O tema de RPG é um _skin_ opcional. Código, contratos, tabelas, eventos e logs usam
sempre os nomes canônicos (Project, Task, Run, Agent). O vocabulário temático mora só em
`packages/glossary` e alcança apenas labels da interface.

O planejamento completo está em [`docs/planejamento_dungeon_master_v0.4.md`](./docs/planejamento_dungeon_master_v0.4.md)
e os fundamentos técnicos em [`docs/documentacao_ideia_e_fundamentos_tecnicos.md`](./docs/documentacao_ideia_e_fundamentos_tecnicos.md).

## Estado atual

**Fases 0 a 7 concluídas** (08/09/2026). Estão de pé: o esqueleto do monorepo, o modelo e
o CRUD de Project e Task, a execução de agentes com os harnesses de host e o modo
container, o Worker com fila e cancelamento confirmado, o stream SSE, o glossário, as
Conquistas, o motor de Workflow, o Grimório com o Distiller e o Context Engine com o
servidor MCP.

A **Fase 8** (Loadouts avançados, Skills e Tools) aguarda decisão. O bloco de fechamento
de cada fase, com o que ficou pendente, está no fim de
[`docs/planejamento_dungeon_master_v0.4.md`](./docs/planejamento_dungeon_master_v0.4.md).

## Pré-requisitos

| Ferramenta | Versão                  | Observação                                                    |
| ---------- | ----------------------- | ------------------------------------------------------------- |
| Node.js    | 22.22+ ou 24            | `engines` aceita as duas linhas; o CI roda a do `.nvmrc` (24) |
| pnpm       | 10.18.0                 | fixado em `packageManager`; `corepack enable` basta           |
| Docker     | qualquer com Compose v2 | PostgreSQL de desenvolvimento **e** a imagem do agente        |
| Git        | 2.40+                   | `db:check` e `gen:check` usam `git diff`                      |

No **Windows, prefira o 22**: com o Node 24.15 processos node (Vite, fork do vitest, API)
morrem em silêncio sob carga com exit `0xC0000409`. A seção 8 do
[`CLAUDE.md`](./CLAUDE.md) registra o incidente. O piso é 22.22 porque o `jsdom` exige.

Windows 11 e macOS são plataformas de primeira classe. Linux não é excluído, mas não é
alvo de teste. Web, API e Worker **não** rodam em Docker: são processos Node. O Docker
entra em dois lugares — o PostgreSQL de desenvolvimento e, no modo de execução
container ("Masmorra selada"), a imagem `dungeon-master-agent` que roda o agente
isolado. Quem for usar esse modo constrói a imagem com `pnpm docker:build`; o contrato
dela está em [`docker/README.md`](./docker/README.md) e a decisão de credencial nos ADRs
[0001](./docs/adr/0001-autenticacao-em-docker.md) e
[0002](./docs/adr/0002-antigravity-em-docker.md).

## Como subir

### 1. Dependências

```bash
corepack enable
pnpm install
```

### 2. Build dos pacotes

```bash
pnpm build
```

API, Worker e Web consomem os pacotes compilados. Os scripts de banco do passo
seguinte também: `db:migrate` e `db:seed` importam `@dungeon-master/contracts` e
`@dungeon-master/achievements`, que resolvem para `dist/`, e `dist/` não é versionado.
Num clone novo, sem este passo, o primeiro comando de banco morre com
`ERR_MODULE_NOT_FOUND`. O primeiro build é obrigatório, e vem antes de tudo.

### 3. Banco de desenvolvimento

O PostgreSQL 17 sobe em container. É a única peça da aplicação em Docker — o outro uso do
Docker, a imagem do agente, é opcional e só entra no modo de execução container.

```bash
docker compose up -d db
pnpm db:migrate
pnpm db:seed
```

O banco escuta em `127.0.0.1:5433` e os dados ficam no volume nomeado
`dungeon-master-db-data`. `docker compose down` para o container e preserva o volume;
`docker compose down -v` apaga os dados.

`pnpm db:seed` cria o único usuário local, com o id fixo
`01996d00-0000-7000-8000-000000000001`. Não há login: toda tabela com `user_id` aponta
para ele.

#### Massa de demonstração

```bash
pnpm db:seed --demo
```

Acrescenta dois Projects — "Forja de Widgets" e "Expedição ao Legado" —, catorze Tasks
variadas em tipo, prioridade e estado, com duas subtarefas, duas dependências e três
capturas por triar na Inbox. Serve para abrir as telas com conteúdo em vez de decidir se
o sistema está quebrado ou só vazio.

Tudo é criado pelas **mesmas funções que a API usa**, nunca por `INSERT` direto: a massa
respeita a máquina de estados e as regras de subtarefa e de dependência, e gera as linhas
de `activity` e de `dashboard_event` na mesma transação de cada mudança. Nenhuma Task fica
em `QUEUED` ou `RUNNING`, que só passam a significar algo com o runtime da Fase 2.

O comando é idempotente: a chave estável é o título, então rodar duas vezes não duplica
nada e o que já existe é reaproveitado, sem reaplicar transições. Ele também não remove
nada — para começar do zero, `docker compose down -v` apaga o volume.

### 4. Processos

Cada um em um terminal:

```bash
pnpm dev:api      # http://127.0.0.1:3333
pnpm dev:worker
pnpm dev:web      # http://127.0.0.1:5173
```

A API escuta somente em `127.0.0.1`. O Vite faz proxy de `/api` para ela, então a web
fala com o backend por caminho relativo e não há CORS em desenvolvimento.

Endpoints de serviço, os únicos que não dependem do banco:

| Caminho                            | O que faz                                             |
| ---------------------------------- | ----------------------------------------------------- |
| `GET /api/v1/health`               | estado do processo e resultado de `SELECT 1` no banco |
| `GET /api/v1/openapi.json`         | a spec, gerada dos schemas Zod                        |
| `GET /api/v1/docs`                 | Swagger UI sobre a spec                               |
| `GET /api/v1/achievements/catalog` | o catálogo de Conquistas, sem estado                  |

Esses quatro **não** são a API. A superfície completa tem **80 caminhos** — o CRUD de
`projects`, `tasks`, `runs`, `agents`, `loadouts`, `skills`, `tools`, `mcp-servers`,
`providers`, `workflows`, `knowledge-items` e `approval-gates`, mais os dois streams SSE. Ela não é repetida aqui de propósito: a lista
que vale é a gerada, em `GET /api/v1/docs` (Swagger UI, com o corpo de cada rota) e em
[`packages/api-client/openapi.json`](./packages/api-client/openapi.json). Uma tabela
escrita à mão sairia do ar no primeiro endpoint novo.

## Comandos

### Verificação

| Comando             | O que faz                                                         |
| ------------------- | ----------------------------------------------------------------- |
| `pnpm lint`         | ESLint em todo o workspace, incluindo as regras de fronteira      |
| `pnpm typecheck`    | `tsc --noEmit` em cada pacote                                     |
| `pnpm test`         | Vitest; os testes de banco sobem `embedded-postgres`, sem Docker  |
| `pnpm e2e`          | Playwright na web; sobe API, Vite e um PostgreSQL só dele         |
| `pnpm build`        | compila todos os pacotes na ordem do grafo                        |
| `pnpm gen`          | regenera `openapi.json` e o cliente tipado                        |
| `pnpm gen:check`    | regenera e falha se houver diff                                   |
| `pnpm db:check`     | falha se o schema Drizzle e as migrações divergirem               |
| `pnpm format`       | Prettier sobre a árvore, com a configuração de `.prettierrc.json` |
| `pnpm format:check` | Prettier em modo conferência; não escreve nada                    |

O CI roda `lint`, `typecheck`, `test`, `build`, `e2e`, `gen:check` e `db:check`, nesta
ordem, em `windows-latest` e `macos-latest`. O `pnpm e2e` precisa do navegador instalado
uma vez: `pnpm --filter web exec playwright install chromium`.

O `format:check` **não** está no CI, e o passo "árvore de trabalho limpa" não pega
formatação de arquivo já commitado. Rode `pnpm format` antes de commitar, em vez de
confiar no Prettier do editor, que pode estar com outra configuração.

### Imagem do agente

| Comando             | O que faz                                                               |
| ------------------- | ----------------------------------------------------------------------- |
| `pnpm docker:build` | constrói `dungeon-master-agent`, a imagem do modo de execução container |

Só é necessário para o perfil "Masmorra selada". O contrato de UID/GID e as CLIs
instaladas estão em [`docker/README.md`](./docker/README.md).

### Banco

| Comando               | O que faz                                       |
| --------------------- | ----------------------------------------------- |
| `pnpm db:generate`    | gera uma migração a partir da mudança no schema |
| `pnpm db:migrate`     | aplica as migrações pendentes                   |
| `pnpm db:seed`        | garante o usuário local; idempotente            |
| `pnpm db:seed --demo` | acrescenta a massa de demonstração; idempotente |
| `pnpm db:check`       | verifica que schema e migrações estão em dia    |

Para abrir o banco de desenvolvimento numa interface, o `drizzle-kit studio` não tem
atalho na raiz: `pnpm --filter @dungeon-master/database db:studio`.

### Operação (`pnpm dm`)

| Comando                                                  | O que faz                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm dm achievements rebuild`                           | zera a projeção de Conquistas e reprojeta tudo do início                                   |
| `pnpm dm knowledge distill [--project <id>] [--summary]` | roda um lote do Distiller agora, com o mesmo Escriba do Worker; `--summary` força o resumo |
| `pnpm dm knowledge status`                               | candidatos pendentes por Project, itens por estado, últimos lotes e forjadas em revisão    |

O Distiller do Worker roda sozinho por ociosidade, timer (`knowledge.distillEveryMinutes` em
Settings) e `NOTIFY`; a linha de comando existe para o operador não esperar. O `db:seed`
semeia o Loadout "Escriba do Grimório" com o primeiro harness ligado que produz resultado
estruturado; `knowledge.loadoutId` em Settings escolhe outro.

## Variáveis de ambiente

Todas têm padrão sensato para desenvolvimento local. Os arquivos `.env.example` de
`apps/api` e `apps/worker` listam o que cada processo lê; há um terceiro em `apps/web`,
com a única variável do proxy de desenvolvimento do Vite. Copie para um `.env` na raiz se
quiser mudar algo.

Cada ponto de entrada (API, Worker, `pnpm dm`, `db:migrate` e `db:seed`) lê **dois**
arquivos: o `.env` do próprio pacote e o `.env` da raiz do monorepo, nessa ordem de
precedência — quem define a variável primeiro vence, então o do pacote sobrepõe o da
raiz. Na prática, ponha tudo na raiz e use o `.env` do pacote só para exceções.

| Variável                                     | Padrão                                                       | Onde                   |
| -------------------------------------------- | ------------------------------------------------------------ | ---------------------- |
| `DATABASE_URL`                               | `postgresql://dungeon:dungeon@127.0.0.1:5433/dungeon_master` | API, Worker, migrações |
| `API_HOST`                                   | `127.0.0.1`                                                  | API                    |
| `API_PORT`                                   | `3333`                                                       | API                    |
| `API_REQUEST_TIMEOUT_MS`                     | `0` (sem limite, por causa do SSE)                           | API                    |
| `API_HEADERS_TIMEOUT_MS`                     | `65000`                                                      | API                    |
| `API_KEEP_ALIVE_TIMEOUT_MS`                  | `61000`                                                      | API                    |
| `API_SSE_HEARTBEAT_MS`                       | `15000` (`0` desliga o heartbeat)                            | API                    |
| `API_SSE_FALLBACK_INTERVAL_MS`               | `5000`                                                       | API                    |
| `WORKER_TICK_INTERVAL_MS`                    | `1000`                                                       | Worker                 |
| `WORKER_SHUTDOWN_TIMEOUT_MS`                 | `30000`                                                      | Worker                 |
| `WORKER_MAX_CONCURRENT_RUNS`                 | `2`                                                          | Worker                 |
| `WORKER_RUN_IDLE_TIMEOUT_MS`                 | `600000`                                                     | Worker                 |
| `WORKER_RUN_COMPLETION_TIMEOUT_MS`           | `3600000`                                                    | Worker                 |
| `WORKER_WORKTREES_ROOT`                      | `<pai do repositório>/.dm-worktrees/<nome do repositório>`   | Worker                 |
| `WORKER_DISTILLER_ENABLED`                   | `true`                                                       | Worker                 |
| `WORKER_DISTILLER_IDLE_MS`                   | `60000`                                                      | Worker                 |
| `WORKER_DISTILLER_TICK_INTERVAL_MS`          | `1000`                                                       | Worker                 |
| `WORKER_DISTILLER_SWEEP_INTERVAL_MS`         | `30000`                                                      | Worker                 |
| `WORKER_DISTILLER_LLM_IDLE_TIMEOUT_MS`       | `180000`                                                     | Worker                 |
| `WORKER_DISTILLER_LLM_COMPLETION_TIMEOUT_MS` | `600000`                                                     | Worker                 |
| `WORKER_DISTILLER_BATCH_SIZE`                | `20`                                                         | Worker                 |
| `VITE_API_PROXY_TARGET`                      | `http://127.0.0.1:3333`                                      | Web (dev)              |
| `LOG_LEVEL`                                  | `info`                                                       | API, Worker            |
| `NODE_ENV`                                   | `development`                                                | tudo                   |

Portas: **3333** API, **5173** Web, **5433** PostgreSQL de desenvolvimento. O e2e usa
**3399** e **5273**, sobrescritíveis por `E2E_API_PORT` e `E2E_WEB_PORT`.

`API_SSE_HEARTBEAT_MS` é o ajuste de quem está atrás de um proxy que corta conexão
ociosa: ele precisa ficar bem abaixo do timeout desse proxy, senão uma Expedição sem
eventos por alguns minutos é derrubada e o browser reconecta à toa.

Nenhuma outra variável é lida em produção. As demais que aparecem no código
(`DM_E2E_CLAUDE_CODE`, `DM_HARNESS_CONTRACT`, `CI`) só ligam ou desligam suítes de teste.

## Estrutura

```text
apps/
  api/        Hono 4 + @hono/zod-openapi; rotas /api/v1; erros RFC 9457
  worker/     processo Node; boot, laço ocioso e shutdown gracioso
  web/        React 19 + Vite + Tailwind v4 + shadcn/ui + TanStack Router e Query
packages/
  contracts/    schemas Zod: fonte única de tipos e da spec OpenAPI
  api-client/   gerado da spec; único import de backend permitido na web
  database/     Drizzle, schema, migrações versionadas
  domain/       entidades, máquinas de estado e regras; sem infraestrutura
  platform/     kill de árvore, normalização de caminho e spawn sem shell
  events/       transporte SSE, drain por cursor e ponte de NOTIFY
  glossary/     canônico → tema; fonte única dos labels da UI (dnd e plain)
  achievements/ catálogo, templates e vocabulário de condições de Conquistas
  runs/         teto de concorrência e ordenação por chave de recurso
  runtime/      AgentRuntime, HarnessAdapter, capabilities, preflight e workspace
  runtime-sandcastle/  adapters de Claude Code, Codex e Pi para execução no host
  runtime-antigravity/ adapter do Antigravity CLI (agy) para execução no host
  workflow/     motor de Workflows: runner determinístico e um executor por step
  knowledge/    Distiller do Grimório: prompts, dedup, resumo e forja, por portas
  knowledge-mcp/  servidor MCP somente leitura do Grimório, por stdio
  context/      Context Engine: o bloco de contexto estável por Run, com orçamento, por portas
docs/         planejamento, fundamentos, ADRs e as análises das referências
docker/       o Dockerfile do agente e o contrato da imagem
```

São dezesseis pacotes. Código novo de execução de agente vai em `packages/runtime` ou num
adapter; tipo de step novo, em `packages/workflow`. Nada disso mora em `apps/worker`, que
só faz a fiação — a fronteira de lint da seção 3 do [`CLAUDE.md`](./CLAUDE.md) recusa o
contrário.

### Fronteiras aplicadas por lint

- `apps/web` importa somente `@dungeon-master/api-client`, `@dungeon-master/glossary` e
  **tipos** de `@dungeon-master/contracts`. Nenhum outro pacote interno de backend. O
  glossário é a única exceção, e é declarada: é um pacote puro de labels da interface, e
  a web precisa consumi-lo direto para que nenhum componente escreva "Campanha" ou
  "Projeto" no JSX.
- `packages/domain` não importa banco, ORM, HTTP, logger, runtime nem builtins do Node.
- `packages/runtime` e `packages/workflow` não importam `packages/database`; o store e a
  persistência entram por contrato.
- `packages/knowledge` e `packages/context` são puros: banco, runtime e relógio entram
  pelas portas de `ports.ts`, e o Worker faz a fiação.

Quebrar qualquer uma delas falha em `pnpm lint`.

### Artefatos gerados e commitados

`packages/api-client/openapi.json` e `packages/api-client/src/schema.d.ts` são gerados
da spec, e `packages/database/drizzle/` guarda as migrações. Os três são commitados e o
CI falha se estiverem desatualizados. Nunca edite os gerados à mão: mude os schemas em
`packages/contracts` ou as rotas em `apps/api` e rode `pnpm gen`.

## Testes

Vitest em todos os pacotes. Os testes que precisam de banco usam
[`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres) em um
`globalSetup` que sobe a instância, aplica as migrações e semeia o usuário local. Nada de
Docker: os runners de Windows e macOS não oferecem Docker Linux.

## Licença

MIT. Veja [`LICENSE`](./LICENSE) e [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
