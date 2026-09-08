# Instruções para agentes que trabalham neste repositório

Leia este arquivo antes de escrever qualquer linha. Ele descreve as regras que o
projeto aplica por ferramenta e as que dependem de disciplina.

Contexto obrigatório em qualquer tarefa não trivial:

- [`docs/planejamento_dungeon_master_v0.4.md`](./docs/planejamento_dungeon_master_v0.4.md) — roadmap, fases e decisões.
- [`docs/documentacao_ideia_e_fundamentos_tecnicos.md`](./docs/documentacao_ideia_e_fundamentos_tecnicos.md) — o porquê de cada escolha.
- [`README.md`](./README.md) — como subir e quais comandos existem.

---

## 1. Nomes canônicos

O sistema tem um tema de RPG de mesa. **O tema é um skin e nunca entra no código.**

Em código, contratos, tabelas, colunas, eventos, logs, rotas e URLs use sempre o nome
canônico, em inglês:

```text
Project · Task · Run · RunEvent · Agent · Harness · Model · Loadout · Workflow
WorkflowVersion · WorkflowStep · RunStep · ApprovalGate · Artifact · KnowledgeItem
KnowledgeCandidate · Decision · ExecutionProfile · UserSetting · Achievement
```

Nunca escreva `campanha`, `missao`, `expedicao`, `heroi`, `guilda`, `grimorio`,
`espolio` ou `monstro` em nome de tipo, tabela, coluna, evento, rota ou chave de JSON.
Esse vocabulário existe apenas como **label da interface**, vindo de
`packages/glossary`, e nos nomes e textos de Conquistas.

Convenções por camada:

| Camada                    | Convenção                     | Exemplo                                 |
| ------------------------- | ----------------------------- | --------------------------------------- |
| Tipos e schemas Zod       | `PascalCase` singular         | `RunEvent`, `TaskKind`                  |
| Campos de contrato e JSON | `camelCase`                   | `harnessSessionId`, `executionMode`     |
| Tabelas e colunas         | `snake_case` singular         | `run_event`, `harness_session_id`       |
| Enums de domínio          | `SCREAMING_SNAKE_CASE`        | `RUNNING`, `WAITING_APPROVAL`, `BUG`    |
| Nomes de evento           | `PascalCase`                  | `RunSucceeded`, `ProcessTreeTerminated` |
| Rotas                     | `/api/v1/<recurso-no-plural>` | `/api/v1/tasks`                         |

O idioma da interface é português; os identificadores de código são em inglês. Comentários
e mensagens de erro voltadas ao usuário podem ser em português.

## 2. Tema: só pelo glossário

- Todo label de entidade renderizado pela web vem de `packages/glossary`, pelo hook
  único da web. Nenhum componente escreve "Campanha" ou "Projeto" direto no JSX.
- Os dois glossários, `dnd` e `plain`, têm exatamente o mesmo conjunto de chaves. A
  paridade é garantida em tempo de tipo: faltar uma chave é erro de compilação.
- O interruptor de tema troca **só texto**. Rotas, URLs, ícones, layout e payloads são
  idênticos nos dois modos.
- **Segurança nunca é tematizada a ponto de sumir.** "Campo aberto" aparece sempre
  acompanhado de "sem isolamento", e o badge de ambiente mantém o texto canônico ao lado.

## 3. Fronteiras entre pacotes

Aplicadas pelo ESLint em `eslint.config.mjs`. Quebrar qualquer uma falha em `pnpm lint`.

- **`apps/web`** importa somente `@dungeon-master/api-client`, `@dungeon-master/glossary`
  e **tipos** de `@dungeon-master/contracts`. Nenhum pacote interno de backend, nenhum
  import relativo para fora do app. O glossário é a única exceção, e é declarada: é um
  pacote puro de labels da interface, e a seção 2 aqui só existe porque a web o consome
  direto. Código de teste (`**/*.test.*`, `test/`, `e2e/`) está fora da regra.
- **`packages/domain`** não importa banco, ORM, HTTP, logger, runtime de agente nem
  builtins do Node. O domínio computa; a infraestrutura entra por injeção de contrato.
- **`packages/runtime`** (quando existir) não importa `packages/database`; recebe o store
  por contrato.
- **`packages/workflow`** segue a mesma linha do runtime: não importa `packages/database`
  nem `packages/events`; persistência, runtime de agente, executor de processo e relógio
  entram pelas portas de `ports.ts`, e o Worker faz a fiação com os repositórios reais.
- **`packages/knowledge` e `packages/context`** seguem a mesma linha do workflow, e ainda
  não importam os pacotes de runtime; o `context` também não importa `knowledge` nem
  builtins do Node: a sanitização copiada do TencentDB mora no `context` e é o `knowledge`
  que importa dela — o sentido inverso seria um ciclo.
- **`packages/glossary` e `packages/achievements`** são puros: só `zod` e `node:*`.
- **`packages/platform`** importa somente builtins do Node e módulos do próprio pacote.
- **`packages/events`** não depende de Hono nem de `pg`: writer, fonte e notificador entram
  por injeção.

Ao escrever uma regra nova, use `@typescript-eslint/no-restricted-imports` com `regex`, e
não `group` com glob: na sintaxe do gitignore, `*` e `**` casam o caminho relativo inteiro e
as negações não o devolvem. Prove que a regra dispara com um arquivo de sondagem e apague a
sondagem antes de commitar.

Antes de adicionar uma dependência entre pacotes, verifique se ela não atravessa uma
dessas linhas. Se atravessar, o certo é inverter a dependência, não relaxar a regra.

## 4. Disciplina de migrações

Toda mudança de schema gera uma migração versionada. Sem exceção.

```bash
# 1. edite packages/database/src/schema/
# 2. gere a migração com um nome descritivo
pnpm db:generate            # cria drizzle/NNNN_<nome>.sql e atualiza o journal
# 3. aplique e confira
pnpm db:migrate
pnpm db:check               # falha se schema e migrações divergirem
```

Regras:

- **Migração aplicada e commitada nunca é editada.** Corrija com uma migração nova.
- **Nunca aplique a migração da sua branch no banco de desenvolvimento compartilhado** antes
  do merge: o migrador do Drizzle só aplica entradas com carimbo maior que o último
  registrado, e uma linha de branch deixada para trás faz a migração de outra branch ser
  pulada para sempre. Verifique num banco separado (`createdb` no mesmo servidor) ou no
  embutido dos testes.
- **Migração de dados escrita à mão** (o gerador só emite diff de schema) recebe o próximo
  número do journal e um `when` maior que o da última entrada; ao mesclar a `main`, renumere
  se outra chegou antes.
- Os arquivos em `packages/database/drizzle/`, inclusive `meta/`, são commitados.
- `pnpm db:check` roda no CI. Ele gera uma migração de sondagem e falha se o gerador
  produzir qualquer arquivo, o que significa schema sem migração correspondente.
- Todo timestamp é `timestamptz` e é lido e escrito em UTC. Nunca `timestamp` sem fuso.
- Identificadores são UUIDv7 gerados na aplicação com `newId()`, nunca pelo banco.
- Toda tabela nasce escopada por `user_id`, mesmo o sistema sendo single-user.

## 5. Artefatos gerados

Estes arquivos são gerados e **commitados**, e o CI falha se estiverem desatualizados:

| Arquivo                               | Gerado por                          | Verificado por   |
| ------------------------------------- | ----------------------------------- | ---------------- |
| `packages/api-client/openapi.json`    | `apps/api` a partir dos schemas Zod | `pnpm gen:check` |
| `packages/api-client/src/schema.d.ts` | `openapi-typescript`                | `pnpm gen:check` |
| `packages/database/drizzle/**`        | `drizzle-kit generate`              | `pnpm db:check`  |
| `apps/web/src/routeTree.gen.ts`       | plugin do TanStack Router           | build da web     |

Nunca edite um deles à mão. Mude a origem e rode `pnpm gen`.

A cadeia é sempre a mesma:

```text
packages/contracts (Zod) → apps/api (zod-openapi) → openapi.json
                                                  → packages/api-client → apps/web
```

**Exceção à regra "schema em contracts": pacotes puros com schemas próprios registram
os seus.** `packages/achievements` e `packages/glossary` são dados validados por schemas
que moram dentro deles, e esses schemas são a fonte única daquele domínio. Quando a API
expõe esse dado, ela **importa e registra** o schema do pacote com `.meta({ id })` — veja
`apps/api/src/routes/achievements.ts` — em vez de redeclarar a mesma forma em
`packages/contracts`. Duas declarações da mesma forma criam duas verdades, e a que o
carregador usa venceria em silêncio. O envelope da resposta, que é assunto de API e não
do pacote, continua sendo declarado junto da rota.

## 6. Verificação antes de entregar

Rode e deixe verde, nesta ordem:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm gen:check
pnpm db:check
```

Além disso, quando a mudança tocar cada área:

- **API**: suba com `pnpm dev:api` e confirme `200` em `GET /api/v1/health`.
- **Banco**: `docker compose up -d db && pnpm db:migrate && pnpm db:seed`.
- **Worker**: `pnpm dev:worker`, veja o log de boot e confirme o shutdown com Ctrl+C.
- **Web**: `pnpm dev:web` e confira a tela afetada.

Não rode `pnpm dev:web` e `pnpm --filter web e2e` ao mesmo tempo: os dois Vite disputam
`node_modules/.vite` e o e2e quebra. Scripts e testes nunca importam o próprio pacote pelo
nome (`@dungeon-master/<pacote>`): no CI o `typecheck` roda sem o `dist` do próprio pacote.

Nunca declare algo pronto sem ter rodado o comando. Se um passo falhou, relate a falha
com a saída, em vez de descrevê-lo como pendente.

**Derrube somente os processos que você mesmo subiu, pelo PID guardado ao iniciá-los** (ou
pela árvore desse PID). Nunca mate por nome de imagem nem por padrão de linha de comando
(`taskkill /IM node.exe`, filtros por `tsx watch`, `pkill -f`): outras sessões rodam API,
Worker, Vite e e2e nesta mesma máquina ao mesmo tempo, e um kill por padrão já derrubou a
API de outra pessoa. Os e2e usam portas fixas (`3399` e `5273`) e só uma suíte pode rodar por
vez na máquina: se outra sessão estiver rodando o e2e, espere.

## 7. Dependências

- **Versões exatas.** Nada de `^` ou `~` em `package.json`. Fixe a versão estável atual.
- Dependências entre pacotes do workspace usam `workspace:*`.
- Scripts de instalação são bloqueados por padrão pelo pnpm 10. Para liberar um pacote,
  adicione-o a `onlyBuiltDependencies` em `pnpm-workspace.yaml`, com um comentário
  dizendo por quê.
- Antes de adicionar uma biblioteca, verifique se ela funciona em Windows **e** macOS.
- **TypeScript 6 não inclui `@types/node` sozinho.** Todo pacote que usa builtins ou globais
  do Node (`process`, `setTimeout`, `Buffer`) precisa de `"types": ["node"]` no seu
  `tsconfig.json`, mesmo com `@types/node` em `devDependencies`. Sem isso o erro só aparece
  quando outra dependência deixa de trazer a referência por acaso.

## 8. Plataformas

Windows 11 e macOS são de primeira classe; o CI roda nos dois em todo commit.

- Código de processo, caminho e shell mora só em `packages/platform`.
- Nunca use `spawn` com `shell: true` nem monte comando por concatenação de string.
- Caminhos: `node:path`; nunca concatene com `/` ou `\`.
- Trate `SIGBREAK` junto com `SIGINT` e `SIGTERM` em qualquer processo de longa duração.
- No Windows, o código de saída de um kill não é prova de término: confirme por polling.
- Testes e CI usam `embedded-postgres`, nunca Docker: os runners não têm Docker Linux.
  O servidor é iniciado e parado por `pg_ctl`, via `@dungeon-master/database/testing`
  (`startTestPostgres`), porque `postgres.exe` recusa rodar como administrador no Windows
  e o runner do GitHub é administrador. **Nunca importe `embedded-postgres` em runtime**: o
  pacote instala um `async-exit-hook` global que intercepta `process.exit` e devolve código 0
  mesmo com teste falhando, o que deixou o CI verde com suíte vermelha. Ele fica em
  devDependencies só para instalar os binários; o helper chama `initdb` e `pg_ctl` direto.
- **Segredo nunca vai no argv.** `docker run -e NOME` sem `=valor`, com o valor no ambiente do
  cliente; qualquer processo da máquina lê a linha de comando dos outros.
- **Prove que o vermelho é vermelho.** Ao mexer em infraestrutura de teste, crie um teste que
  falha de propósito, rode o pacote e confira `exit 1`; depois apague o teste.

## 9. Erros, eventos e logs

- Todo erro da API sai em `application/problem+json` (RFC 9457) com `type`, `title`,
  `status`, `detail` e `instance`. Erro de validação vira `400` com `errors[]`.
- Nenhuma mensagem interna vaza no corpo de um `500`; o `requestId` liga a resposta ao log.
- Log é estruturado, com pino. Nunca `console.log` em código de produção; o ESLint
  bloqueia. `console.warn` e `console.error` são permitidos.
- Eventos de execução são append-only e têm dois contratos de escrita: `appendEvent`
  nunca lança, `persistEvent` propaga. Escolha conscientemente qual usar.
- Nada fire-and-forget no caminho de escrita de resultado ou de conhecimento.
- **Post-mortem em comentário.** O código que corrige um incidente real leva, no ponto da
  correção, um comentário `// post-mortem #<n> (<data>): <o que aconteceu e o que mudou>`,
  numerado em sequência no repositório (o próximo é o maior `#<n>` existente mais um). O
  comentário fica: é o que impede a "simplificação" que reintroduz o bug. Convenção adotada
  do TencentDB Agent Memory (documento técnico, seção 20.1). O `#1` está em
  `packages/database/src/user-setting.ts`.

## 10. Código de terceiros

Copiar ou adaptar código das referências (Sandcastle, Archon, TencentDB Agent Memory)
exige, sem exceção:

1. o cabeçalho de atribuição com `caminho@commit`, copyright e "Changes:";
2. uma entrada em [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md);
3. os testes que acompanham o arquivo de origem, rodando na nossa matriz de CI;
4. remoção de imports de `bun:` / `Bun.` e de `effect`.

O manifesto do que pode ser reaproveitado está na seção 13 do planejamento. Nada é
vendorizado como subsistema: só utilitários autocontidos, prompts e trechos de SQL.

## 11. Commits

Formato convencional, mensagem em português, no imperativo, primeira linha com até 72
caracteres:

```text
<tipo>(<escopo opcional>): <resumo em português>

<corpo opcional, explicando o porquê>
```

Tipos: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`, `perf`, `build`.
Escopos usuais: `api`, `web`, `worker`, `database`, `contracts`, `api-client`, `domain`,
`platform`, `glossary`, `achievements`, `events`.

Commits pequenos, um assunto cada. Nunca misture artefato gerado com mudança de lógica
sem explicar no corpo.

Toda mensagem termina com estas duas linhas:

```text
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: <url da sessão>
```

## 12. Fora de escopo por padrão

Não implemente sem pedido explícito: multi-user, RBAC, Kubernetes, microserviços, Redis,
banco vetorial separado, editor visual de Workflow, execução remota, swarms autônomos,
ranking entre usuários, recompensas que destravam funcionalidade, economia de itens, e
geração de texto por LLM no caminho quente da UI.

Conquistas são **projeção**: calculadas a partir de eventos já persistidos, idempotentes,
reconstruíveis do zero, e incapazes de afetar a execução de um Run.
