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

**Fase 0 — esqueleto do monorepo.** Web, API, Worker e PostgreSQL sobem localmente. Ainda
não há execução de agentes, fila, SSE, glossário nem Conquistas.

## Pré-requisitos

| Ferramenta | Versão                  | Observação                                          |
| ---------- | ----------------------- | --------------------------------------------------- |
| Node.js    | 24 (LTS)                | fixado em `.nvmrc` e em `engines`; use `nvm use`    |
| pnpm       | 10.18.0                 | fixado em `packageManager`; `corepack enable` basta |
| Docker     | qualquer com Compose v2 | só para o PostgreSQL de desenvolvimento             |
| Git        | 2.40+                   | `db:check` e `gen:check` usam `git diff`            |

Windows 11 e macOS são plataformas de primeira classe. Linux não é excluído, mas não é
alvo de teste. A aplicação **não** roda em Docker: web, API e Worker são processos Node.

## Como subir

### 1. Dependências

```bash
corepack enable
pnpm install
```

### 2. Banco de desenvolvimento

O PostgreSQL 17 sobe em container; é a única peça em Docker.

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

### 3. Build dos pacotes

API, Worker e Web consomem os pacotes compilados, então o primeiro build é obrigatório.

```bash
pnpm build
```

### 4. Processos

Cada um em um terminal:

```bash
pnpm dev:api      # http://127.0.0.1:3333
pnpm dev:worker
pnpm dev:web      # http://127.0.0.1:5173
```

A API escuta somente em `127.0.0.1`. O Vite faz proxy de `/api` para ela, então a web
fala com o backend por caminho relativo e não há CORS em desenvolvimento.

Endpoints da API:

| Caminho                            | O que faz                                             |
| ---------------------------------- | ----------------------------------------------------- |
| `GET /api/v1/health`               | estado do processo e resultado de `SELECT 1` no banco |
| `GET /api/v1/openapi.json`         | a spec, gerada dos schemas Zod                        |
| `GET /api/v1/docs`                 | Swagger UI sobre a spec                               |
| `GET /api/v1/achievements/catalog` | o catálogo de Conquistas, sem estado                  |

## Comandos

### Verificação

| Comando          | O que faz                                                        |
| ---------------- | ---------------------------------------------------------------- |
| `pnpm lint`      | ESLint em todo o workspace, incluindo as regras de fronteira     |
| `pnpm typecheck` | `tsc --noEmit` em cada pacote                                    |
| `pnpm test`      | Vitest; os testes de banco sobem `embedded-postgres`, sem Docker |
| `pnpm e2e`       | Playwright na web; sobe API, Vite e um PostgreSQL só dele        |
| `pnpm build`     | compila todos os pacotes na ordem do grafo                       |
| `pnpm gen`       | regenera `openapi.json` e o cliente tipado                       |
| `pnpm gen:check` | regenera e falha se houver diff                                  |
| `pnpm db:check`  | falha se o schema Drizzle e as migrações divergirem              |

O CI roda exatamente esta sequência em `windows-latest` e `macos-latest`. O `pnpm e2e`
precisa do navegador instalado uma vez: `pnpm --filter web exec playwright install chromium`.

### Banco

| Comando               | O que faz                                       |
| --------------------- | ----------------------------------------------- |
| `pnpm db:generate`    | gera uma migração a partir da mudança no schema |
| `pnpm db:migrate`     | aplica as migrações pendentes                   |
| `pnpm db:seed`        | garante o usuário local; idempotente            |
| `pnpm db:seed --demo` | acrescenta a massa de demonstração; idempotente |
| `pnpm db:check`       | verifica que schema e migrações estão em dia    |

## Variáveis de ambiente

Todas têm padrão sensato para desenvolvimento local. Os arquivos `.env.example` de
`apps/api` e `apps/worker` listam o conjunto completo; copie para um `.env` na raiz se
quiser mudar algo.

| Variável                     | Padrão                                                       | Onde                   |
| ---------------------------- | ------------------------------------------------------------ | ---------------------- |
| `DATABASE_URL`               | `postgresql://dungeon:dungeon@127.0.0.1:5433/dungeon_master` | API, Worker, migrações |
| `API_HOST`                   | `127.0.0.1`                                                  | API                    |
| `API_PORT`                   | `3333`                                                       | API                    |
| `API_REQUEST_TIMEOUT_MS`     | `0` (sem limite, por causa do SSE)                           | API                    |
| `API_HEADERS_TIMEOUT_MS`     | `65000`                                                      | API                    |
| `API_KEEP_ALIVE_TIMEOUT_MS`  | `61000`                                                      | API                    |
| `WORKER_TICK_INTERVAL_MS`    | `15000`                                                      | Worker                 |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | `10000`                                                      | Worker                 |
| `VITE_API_PROXY_TARGET`      | `http://127.0.0.1:3333`                                      | Web (dev)              |
| `LOG_LEVEL`                  | `info`                                                       | API, Worker            |
| `NODE_ENV`                   | `development`                                                | tudo                   |

Portas: **3333** API, **5173** Web, **5433** PostgreSQL de desenvolvimento.

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
  domain/       entidades e regras; sem infraestrutura (esqueleto)
  platform/     processo, caminho e shell por SO (esqueleto)
  events/       ExecutionEvent, writers e cursor (esqueleto)
  glossary/     canônico → tema; labels da UI (esqueleto)
  achievements/ catálogo, templates e vocabulário de condições de Conquistas
docs/         planejamento, fundamentos e as análises das referências
```

### Fronteiras aplicadas por lint

- `apps/web` importa somente `@dungeon-master/api-client` e **tipos** de
  `@dungeon-master/contracts`. Nenhum pacote interno de backend.
- `packages/domain` não importa banco, ORM, HTTP, logger, runtime nem builtins do Node.

Quebrar qualquer uma das duas falha em `pnpm lint`.

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
