# Análise técnica do projeto Archon

> Documento produzido por leitura direta do código-fonte em `D:\Dev\Claude\Estudo\Archon`
> (branch `dev`, versão `0.10.1`, commit `0773b97`). Todos os caminhos citados são
> relativos à raiz do repositório. Onde algo não pôde ser confirmado lendo o código,
> isso é dito explicitamente.

---

## Índice

1. [Visão geral e objetivo da aplicação](#1-visão-geral-e-objetivo-da-aplicação)
2. [Stack e dependências principais](#2-stack-e-dependências-principais)
3. [Arquitetura e estrutura do repositório](#3-arquitetura-e-estrutura-do-repositório)
4. [Fluxos principais da aplicação](#4-fluxos-principais-da-aplicação)
5. [Detalhes de implementação interessantes](#5-detalhes-de-implementação-interessantes)
6. [Modelo de dados](#6-modelo-de-dados)
7. [Configuração, deploy e operação](#7-configuração-deploy-e-operação)
8. [Testes e qualidade](#8-testes-e-qualidade)
9. [Pontos fortes, riscos e oportunidades](#9-pontos-fortes-riscos-e-oportunidades)
10. [Referências rápidas](#10-referências-rápidas)

---

## 1. Visão geral e objetivo da aplicação

### 1.1 O problema

Quando se pede a um agente de IA "conserte esse bug", o que acontece depende do humor do
modelo. Ele pode pular o planejamento, esquecer de rodar os testes, ou escrever uma
descrição de PR que ignora o template do time. Cada execução é diferente. Não há como
auditar, repetir ou governar o processo.

O `README.md` resume a proposta em uma frase: *"Like what Dockerfiles did for
infrastructure and GitHub Actions did for CI/CD — Archon does for AI coding workflows.
Think n8n, but for software development."*

### 1.2 A proposta de valor

Archon é um **motor de workflows governados para agentes de IA**. O usuário codifica seu
processo de desenvolvimento como um DAG declarativo em YAML (`.archon/workflows/*.yaml`).
O workflow define as fases, os portões de validação, os gates de aprovação humana e os
artefatos produzidos. A IA preenche a inteligência em cada passo, mas a **estrutura é
determinística e pertence ao operador**.

As cinco promessas do README, verificáveis no código:

| Promessa | Onde está implementada |
|---|---|
| **Repetível** — mesma sequência sempre | `packages/workflows/src/dag-executor.ts`, ordenação topológica de Kahn |
| **Isolado** — cada run em seu próprio git worktree | `packages/isolation/src/providers/worktree.ts` |
| **Fire-and-forget** — dispara e volta depois | `--detach` em `packages/cli/src/commands/workflow.ts`, com IPC por socket |
| **Composável** — mistura nós determinísticos e nós de IA | 9 variantes de nó em `packages/workflows/src/schemas/dag-node.ts` |
| **Portável** — mesmo workflow de CLI, Web, Slack, Telegram, GitHub | `IPlatformAdapter` em `packages/core/src/types/index.ts` |

### 1.3 Escopo declarado pelo próprio projeto

O `AGENTS.md` é mais preciso que o README sobre o escopo: *"Archon is a self-hostable,
governed agentic automation engine. Coding automation is its most mature surface, but the
engine is intended for general business operations too."*

O documento de direção (`.archon/direction.md`) fixa as fronteiras de produto que servem
de critério de triagem de PRs. As mais importantes:

- **Single-tenant por instalação.** Um install serve um operador ou cliente. Isolamento
  entre clientes é responsabilidade da camada de deploy, não do código. Múltiplos
  *usuários* dentro de um install são suportados e não são multi-tenancy.
- **Não é substituto do agente de codificação.** Archon orquestra Claude Code, Codex e Pi;
  não os reimplementa.
- **Auto-hospedável.** Bun + TypeScript. SQLite por padrão, PostgreSQL opcional. Nenhuma
  dependência de serviço externo para a operação central.
- **A YAML não é linguagem de programação.** Ver `.archon/workflow-language-constitution.md`.

### 1.4 Para quem

Times de engenharia que já usam agentes de codificação (Claude Code, Codex, Copilot) e
querem transformar processos ad-hoc em pipelines auditáveis. O produto ataca três dores
distintas:

1. **Determinismo** — o mesmo processo roda igual todas as vezes.
2. **Paralelismo seguro** — 5 correções simultâneas em 5 worktrees isolados, sem conflito.
3. **Operação remota** — disparar e acompanhar runs de Slack, Telegram, GitHub ou do celular.

---

## 2. Stack e dependências principais

### 2.1 Runtime e linguagem

| Item | Escolha | Evidência |
|---|---|---|
| Runtime | **Bun 1.4.0** (pinado em `engines.bun`) | `package.json` |
| Linguagem | **TypeScript 5.3+**, strict, sem build step no backend | `tsconfig.json`, `"build": "echo 'No build needed'"` |
| Módulos | ESM (`"type": "module"`) em todos os pacotes | `packages/*/package.json` |
| Gerenciador | Bun workspaces (`bun.lock`, 427 KB) | `package.json` `workspaces: ["packages/*"]` |

Bun não é uma escolha cosmética. O projeto explora três capacidades específicas:
execução direta de TypeScript sem transpilação (nenhum pacote do backend tem etapa de
build), `bun build --compile` para produzir binários únicos de ~50 MB, e `bun:sqlite`
como driver embutido.

### 2.2 Backend

| Camada | Tecnologia |
|---|---|
| HTTP | **Hono 4** via `OpenAPIHono` de `@hono/zod-openapi` |
| Servidor | `Bun.serve({ idleTimeout: 255 })` — o máximo, para não matar conexões SSE |
| Validação/schemas | **Zod 4** (importado de `@hono/zod-openapi`, convenção do repositório) |
| Banco | **SQLite** (`bun:sqlite`, default) ou **PostgreSQL** (`pg 8`) |
| Auth web | **better-auth 1.6** (opt-in, apenas Postgres) |
| Logging | **pino 9** + `pino-pretty` como *destination stream* |
| Telemetria | **posthog-node 5** (import dinâmico, opt-out por 4 vias) |

### 2.3 Integração com IA

Todos os SDKs de provider ficam concentrados em `packages/providers` — é uma regra de
arquitetura declarada no `AGENTS.md`.

| Provider | SDK | Status |
|---|---|---|
| `claude` | `@anthropic-ai/claude-agent-sdk ^0.3.251` | built-in |
| `codex` | `@openai/codex-sdk ^0.151.0` | built-in |
| `pi` | `@earendil-works/pi-ai` + `pi-coding-agent ^0.84.4` | community |
| `copilot` | `@github/copilot-sdk ~1.0.1` | community |
| `opencode` | `@opencode-ai/sdk ^1.17.3` | community |

Auxiliares: **Ajv 8** (validação de saída estruturada cross-provider), **jsonrepair**
(reparo de JSON malformado), **TypeBox** (schemas de tool do Pi).

### 2.4 Frontend

| Item | Versão |
|---|---|
| React | **19** (`createRoot` + `StrictMode`) |
| Build | **Vite 6** + `@vitejs/plugin-react` |
| Roteamento | **React Router 7** (BrowserRouter, não data-router) |
| Estado de servidor | **TanStack Query 5** (só na UI legacy) |
| CSS | **Tailwind 4** via `@tailwindcss/vite`, tokens `oklch` |
| Componentes | **Radix / shadcn** (`style: new-york`, ícones lucide) |
| Grafos | **@xyflow/react 12** + **@dagrejs/dagre 2** |
| Estado local | **Zustand 5** — usado em exatamente um arquivo (`src/stores/workflow-store.ts`) |

### 2.5 Plataformas e integrações

| Plataforma | Biblioteca |
|---|---|
| Slack | `@slack/bolt ^4.6` (Socket Mode) |
| Telegram | `grammy ^1.36` + `telegramify-markdown` |
| Discord | `discord.js ^14.16` |
| GitHub | `@octokit/rest ^22` + `@octokit/auth-app ^8` |
| Gitea / GitLab | HTTP direto (adapters community) |

### 2.6 Ferramentas de qualidade

`eslint 9` (flat config, `strictTypeChecked` + `stylisticTypeChecked`), `prettier 3.7`,
`husky 9` + `lint-staged`, `renovate` (não Dependabot — ver §7.6), `astro 6` +
`@astrojs/starlight` para o site de documentação.

---

## 3. Arquitetura e estrutura do repositório

### 3.1 O monorepo

Onze pacotes em `packages/*`, mais um serviço isolado na raiz. Tamanhos aproximados
(linhas de `.ts`/`.tsx`, excluindo `node_modules`):

| Pacote | Linhas | Papel |
|---|---:|---|
| `packages/workflows` | 108.620 | **O motor.** Schemas YAML, loader, executor de DAG, validador, dry-run |
| `packages/core` | 62.686 | **O cérebro.** Orquestrador, banco, handlers, config, credenciais |
| `packages/web` | 52.596 | Frontend React (duas UIs coexistindo — ver §3.4) |
| `packages/cli` | 32.219 | CLI `archon` — o entrypoint mais usado |
| `packages/providers` | 31.256 | Integração com SDKs de IA |
| `packages/server` | 22.424 | HTTP (Hono), rotas, SSE, boot |
| `packages/adapters` | 13.491 | Slack, Telegram, Discord, GitHub, Gitea, GitLab |
| `packages/isolation` | 11.663 | Worktrees, containers, backends |
| `packages/paths` | 6.577 | Fundação: paths, logger, env, telemetria |
| `packages/git` | 5.312 | Wrapper sobre o binário `git` |
| `packages/docs-web` | 786 | Site de documentação (Astro/Starlight) |

Fora de `packages/`:

- `auth-service/` — sidecar Node puro (224 linhas) para `forward_auth` do Caddy
- `migrations/` — 24 arquivos SQL, mais o `000_combined.sql` idempotente
- `scripts/` — geradores, checkers e scripts de build
- `deploy/` — cloud-init e compose para VPS
- `homebrew/archon.rb` — fórmula que baixa binários pré-compilados
- `.archon/` — a configuração e os workflows do **próprio Archon** (dogfooding)

### 3.2 O grafo de dependências

```
                     ┌──────────────┐
                     │ @archon/cli  │ ← binário `archon`
                     └──────┬───────┘
                            │
     ┌──────────────────────┼──────────────────────┐
     ▼                      ▼                      ▼
┌──────────┐        ┌──────────────┐       ┌──────────────┐
│  server  │───────▶│   adapters   │──────▶│     core     │
└──────────┘        └──────────────┘       └──────┬───────┘
                                                  │
                            ┌─────────────────────┼──────────────┐
                            ▼                     ▼              ▼
                    ┌──────────────┐     ┌──────────────┐  ┌──────────┐
                    │  workflows   │────▶│  providers   │  │isolation │
                    └──────┬───────┘     └──────┬───────┘  └────┬─────┘
                           │                    │               │
                           └────────────┬───────┴───────────────┘
                                        ▼
                              ┌──────────────────┐
                              │  git   │  paths  │  ← folhas
                              └──────────────────┘

@archon/web  →  (nenhum pacote @archon/*; só tipos gerados do OpenAPI)
```

Duas propriedades desse grafo são deliberadas e verificáveis:

**`@archon/workflows` não depende de `@archon/core` nem de banco.** Suas únicas
dependências de runtime são `@archon/git`, `@archon/paths`, `@archon/providers`,
`@hono/zod-openapi` e `zod`. O motor recebe tudo por **injeção de contratos**
(`packages/workflows/src/deps.ts`, `store.ts`, `child-isolation.ts`,
`container-context.ts`). O comentário em `deps.ts` diz literalmente: *"Callers in
@archon/core satisfy these structurally — no adapter wrappers needed."*

**`@archon/web` não importa nenhum pacote `@archon/*`.** Consome apenas os tipos gerados
do OpenAPI (`packages/web/src/lib/api.generated.d.ts`). Onde precisa de uma gramática do
engine (o parser de `when:`, a regex de `$node.output`), mantém uma cópia deliberada,
provada por um teste de paridade que executa os dois lados
(`scripts/node-ref-parity.test.ts`).

### 3.3 Os dois eixos de isolamento

Este é um ponto de arquitetura que costuma confundir. Existem **dois contratos, não um**,
e a decisão está documentada em comentário em `packages/isolation/src/types.ts`:

| Eixo | Interface | Aplica-se a | Implementações |
|---|---|---|---|
| **Provider** | `IIsolationProvider` | projetos `kind = 'repo'` | `WorktreeProvider` (única) |
| **Backend** | `IIsolationBackend` | projetos `kind = 'folder'` | `InPlaceBackend`, `ContainerBackend` |

O comentário é explícito: *"Worktrees are deliberately NOT a backend — the two lifecycles
don't share an interface."* Não existe uma abstração unificada "worktree | in-place |
container". A coluna `provider` da tabela `isolation_environments` prevê `'vm'` e
`'remote'`, mas são vocabulário, não implementação.

### 3.4 Duas UIs coexistindo

`packages/web/src/App.tsx` revela um fato estrutural relevante:

- `/` redireciona para `/console` — o **console é a UI default**
- `/console/*` → `packages/web/src/experiments/console/ConsoleApp.tsx`
- `/legacy/*` → a UI clássica (`src/routes/`, `src/components/`), numa janela de depreciação

O `README.md` do console ainda diz *"Not part of the shipped product"*, mas o roteamento já
o promoveu. O `.archon/direction.md` confirma a intenção: *"The console replaces the legacy
UI… The legacy UI and its duplicate components are removed rather than maintained as a
second product."*

O console tem regras de isolamento **enforçadas por ESLint** (`eslint.config.mjs`,
bloco `packages/web/src/experiments/console/**`): não pode importar de `@/components`,
`@/contexts`, `@/hooks`, `@/routes`, `@/stores`, `@/lib/api` (funções) nem
`@tanstack/react-query`. Só `import type` de `@/lib/api.generated` é permitido. Isso
explica as duplicações deliberadas (`lib/http.ts`, `flow/layout.ts`, `when-grammar.ts`) —
cada uma carrega um teste de paridade ou um comentário de dívida.

---

## 4. Fluxos principais da aplicação

### 4.1 Visão de conjunto

```
┌──────────────────────────────────────────────────────────────────────┐
│  Superfícies de entrada                                              │
│  CLI · Web UI · Slack · Telegram · Discord · GitHub/Gitea/GitLab      │
└───────────────────────────────┬──────────────────────────────────────┘
                                │  normalização (IPlatformAdapter)
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  handleMessage()  —  packages/core/src/orchestrator/                  │
│                                                                       │
│   ┌── slash command? ──▶ command-handler.ts (determinístico, sem IA)  │
│   │                                                                   │
│   └── senão ──────────▶ turno de agente completo (sendQuery)          │
│                          ├─ tool nativa `manage_run` (se suportada)   │
│                          └─ protocolo textual `/invoke-workflow`      │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  executeWorkflow()  —  packages/workflows/src/executor.ts             │
│    · captura congelada da fonte (workflow-source.ts)                  │
│    · resolução de isolamento (worktree | container | in-place)        │
│    · criação da linha em workflow_runs                                │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  executeDagWorkflow()  —  packages/workflows/src/dag-executor.ts      │
│    camadas topológicas → nós → provider.sendQuery() / bash / script   │
│    eventos: store.createWorkflowEvent (durável) + emitter (ao vivo)   │
└───────────────────────────────┬──────────────────────────────────────┘
                                ▼
       ┌────────────────────────┴───────────────────────┐
       ▼                                                ▼
┌──────────────┐                              ┌───────────────────┐
│ SQLite / PG  │  ← NOTIFY / poll             │  SSE → browser    │
└──────────────┘                              └───────────────────┘
```

### 4.2 Fluxo A — mensagem de chat até execução

Entrada única para todas as plataformas: `handleMessage(platform, conversationId, message,
context?)` em `packages/core/src/orchestrator/orchestrator-agent.ts:1935`.

**Passo 1 — conversa e herança de thread.** `getOrCreateConversation(...)` com regra
*first-user-wins*: `user_id` só é gravado na criação; a atribuição por mensagem vive em
`remote_agent_messages` e `remote_agent_workflow_runs`. Se a conversa é nova e há
`parentConversationId`, herda `codebase_id`, `cwd` e `ai_assistant_type` do pai.

**Passo 2 — comandos determinísticos.** Se a mensagem começa com `/`, uma lista fechada
decide: `help`, `status`, `reset`, `workflow`, `register-project`, `update-project`,
`remove-project`, `setproject`, `commands`, `init`, `worktree`. **Retorna sem tocar na
IA.** Essa decisão não é do modelo — é `message.trim().startsWith('/')` mais uma lista.

**Passo 3 — guardas de diretório.** Dois guardas disjuntos, antes de qualquer
persistência: worktree removido por baixo da conversa (sugere `/worktree remove` ou
`/setproject`), e projeto registrado cuja pasta sumiu (sugere `/update-project`).
Deliberadamente **não** cai para `codebase.default_cwd` — isso ampliaria o escopo de
escrita sem consentimento.

**Passo 4-5 — persistência e descoberta.** A mensagem do usuário é persistida
fire-and-forget (só para adapters não-web). Workflows são descobertos em três escopos
(bundled < global < project), lendo o `.archon` do **checkout canônico**, não o da
worktree (`packages/core/src/utils/workflow-source-root.ts`).

**Passo 6 — contexto do turno.** Aqui está uma decisão de design notável (#2565): um
**gate de aprovação aberto é CONTEXTO, não um ramo do roteador**. Antes, qualquer mensagem
não-slash era registrada como aprovação. Agora `formatPausedGateSection()` injeta o estado
do gate no prompt e o agente decide via verbos explícitos.

**Passo 7-10 — sessão, modelo, credenciais, ferramentas.** A resolução de modelo tem
precedência documentada em `orchestrator-agent.ts:198`:

1. `default_model` do usuário — só se `defaultProvider` bate com o provider configurado
2. tier `large` configurado (usuário > repo > global)
3. `assistants.<provider>.model` da instalação
4. default built-in do tier

**Passo 11 — a chamada de IA.** `platform.getStreamingMode()` decide entre
`handleStreamMode` e `handleBatchMode`. Ambos consomem
`aiClient.sendQuery(fullPrompt, cwd, sessionId, requestOptions)`.

**Passo 12 — o protocolo de saída.** `parseOrchestratorCommands()` procura, com regex
line-anchored, por `^/invoke-workflow <name> --project <p> [--prompt "..."]` e
`^/register-project <name> <path>`.

### 4.3 O orquestrador é ele próprio um agente

Vale sublinhar: `handleMessage` **não** é um roteador determinístico com fallback de IA.
É o inverso — os slash commands são o caminho determinístico e **todo o resto é um turno
de agente completo**, rodando no `cwd` do projeto, com as ferramentas nativas do provider
(preset `claude_code`) e sessão persistida.

O orquestrador recebe **uma** ferramenta nativa injetada pelo core: `manage_run`
(`packages/core/src/orchestrator/manage-run-tool.ts`), e apenas quando há `codebase_id` **e**
o provider declara `nativeTools` (hoje Claude e Pi). Características:

- Schema discriminado por `action`: `help | list | get | start | resume | cancel | abandon
  | approve | reject | respond`
- **Progressive disclosure**: `action='help'` devolve visão geral; `help subtool=<ação>`
  devolve o detalhe
- **Ações destrutivas exigem `confirm: true`** — sem ele a tool devolve um preview
  ("⚠️ This will …. Confirm with the user, then call again with confirm: true")
- **Escopo por projeto**: `findWorkflowRunsByIdPrefix(prefix, codebaseId)` filtra por
  `codebase_id` na própria query. Um agente no projeto A não lê nem muta runs do projeto B.

Para providers sem `nativeTools` (Codex, OpenCode, Copilot), a mesma capacidade chega como
**prosa** no system prompt (`buildRunManagementSection()`), apontando para o CLI.

> **Tensão real, não invenção.** O `AGENTS.md` diz *"Natural language is not a wire
> format… do not reconstruct intent with regexes"*. O caminho `/invoke-workflow` é
> exatamente isso: um protocolo textual reconstruído por regex, com um
> `normalizeCommandText()` que remove `**` de linhas em negrito porque modelos Pi às vezes
> emitem markdown. O `manage_run` é a versão tipada e correta dessa capacidade, mas só
> cobre providers com `nativeTools` **e** chats com projeto escopado.

### 4.4 Fluxo B — execução de um DAG

`executeDagWorkflow(options)` em `packages/workflows/src/dag-executor.ts:11417` é o núcleo
(554 KB, ~11.500 linhas — de longe o maior arquivo do projeto).

**Ordenação e paralelismo.** `buildTopologicalLayers(nodes)` implementa Kahn puro. Cada
camada roda com `Promise.allSettled` **não-limitado**. A exceção é precisa: se qualquer nó
da camada declara `mutates_checkout: false`, a camada inteira roda **estritamente
sequencial** (`settleSequentially`), porque a assertion tira snapshot antes e verifica
depois, e uma escrita de irmão concorrente cairia na janela do nó guardado.

**Sequência por nó** (ordem literal em `runLayers`):

1. Guard "include node reached the executor unexpanded" → lança
2. `checkComposedBlockBoundaries` + cache de resume
3. `checkTriggerRule` (`all_success`, `one_success`, `none_failed_min_one_success`, `all_done`)
4. Avaliação de `when:`
5. Dispatch por `kind` (switch com `never` exaustivo)
6. `resolveNodeProviderAndModel`
7. Resolução de sessão
8. `runNodeRetryLoop`, com snapshot/assert de checkout **fora** do laço de retry

**As nove variantes de nó** (`packages/workflows/src/schemas/dag-node.ts:886`):

| `kind` | Origem no YAML | O que faz |
|---|---|---|
| `agent` | `command:` ou `prompt:` | Chama o provider de IA |
| `exec` | `bash:` ou `script:` | Subprocesso (`runtime: sh \| bun \| uv`) |
| `loop` | `loop:` | Itera até um sinal de conclusão |
| `loop_group` | `loop_group:` | Sub-DAG recursivo iterado |
| `gate` | `approval:` | Pausa esperando decisão humana |
| `halt` | `cancel:` | Encerra o run com uma razão |
| `wait` | `wait:` | Espera durável (duração, timestamp ou evento) |
| `workflow` | `workflow:` | Sub-run governado (linha própria em `workflow_runs`) |
| `compose_fan_out` | `include:` + `fan_out:` | Expansão por item, mesmo run |

`include:` é uma **diretiva de construção de grafo**, não um `kind` de nó — é consumida em
load time por `expandWorkflowIncludes`, e o executor tem um guard que lança se uma chegar.

**Loops.** `loopControlSchema` (`packages/workflows/src/schemas/loop.ts`) exige
`max_iterations` e pelo menos um canal de conclusão entre `until` (prosa),
`until_bash` (exit 0) e `until_field` (campo booleano do `output_format`). A regra é
implementada em duas checagens separadas de propósito — pelo menos um canal declarado
**e** cada canal declarado com valor usável. O comentário explica o risco concreto:
`bash -c "   "` sai 0, então um `until_bash` em branco completaria na iteração 1.

**Gates de aprovação.** `executeApprovalNode` (`dag-executor.ts:7247`) persiste
`approval_requested`, chama `pauseGateRespectingExternalTransition` e retorna
`{state:'completed', output:''}` — a checagem entre camadas verá `paused` e para. Na
retomada, o endpoint de approve escreve o `node_completed` real com a resposta humana.

Um detalhe fino: quando há `on_reject` (mecanismo legado), o prompt de rework roda como um
`AgentNode` sintético com id `${node.id}:on_reject` — id distinto **de propósito**, porque
usar `node.id` faria um run retomado achar o evento e tratar o gate como completo,
**pulando o gate humano por inteiro**.

### 4.5 Fluxo C — propagação de valores entre nós

`packages/workflows/src/output-ref.ts` é a casa única de toda gramática de referência:

```
$nodeId.output          → texto inteiro do nó
$nodeId.output.field    → campo do JSON de saída
$INPUTS.name            → input declarado
$LOOP_PREV.node.output  → snapshot da iteração anterior (só em loop_group)
```

A tabela de resolução de `$node.output.field` (`resolveNodeOutputField`) é o exemplo mais
claro da filosofia de erro do projeto:

| Situação | Resultado |
|---|---|
| Produtor com `state: 'failed'` | **THROW**, antes de qualquer outro ramo |
| Tem `declaredFields`, campo declarado e presente | valor |
| Tem `declaredFields`, campo declarado e ausente/null | `''` |
| Tem `declaredFields`, campo **não** declarado | **THROW** |
| Tem `declaredFields`, saída não é objeto JSON | **THROW** |
| Tem `structuredOutput` sem `declaredFields` (legado) | leniente: presente → valor, ausente → `''` |
| Schemaless (bash/script/prosa), não-JSON | **THROW** |
| Schemaless, chave ausente | **THROW** |

A regra de topo: *"um schema declarado nunca é mais silencioso que nenhum schema"*.

O `when:` tem dois modos de erro **deliberadamente diferentes**
(`packages/workflows/src/condition-evaluator.ts`):

- **Expressão malformada** → fail-closed, resultado `false`, nó pulado, aviso ao usuário
- **Referência irresolúvel** → **THROW**, propaga e **falha** o nó

### 4.6 Fluxo D — persistência e streaming até o browser

Existem **dois caminhos** para um evento de workflow chegar ao browser, e a razão é que
runs disparados pelo CLI nunca tocam o emitter in-process do servidor.

**Caminho A — run dentro do servidor:**

```
executeWorkflow → WorkflowEventEmitter.emit
                → WorkflowEventBridge (subscribe)
                → mapWorkflowEvent()
                → SSETransport.emitWorkflowEvent(conversationId) e ('__dashboard__')
                → stream.writeSSE → EventSource no browser
```

**Caminho B — run fora do processo (`archon workflow run --detach`):**

```
run escreve em remote_agent_workflow_events
   → (Postgres) NOTIFY archon_dashboard_event → PgNotifyListener.drainNow()
   → (SQLite)   tick de 1.500 ms
   → DashboardEventPoller.drainOnce()
   → listWorkflowEventsSince(cursor, 500, DASHBOARD_SOURCE_EVENT_TYPES)
   → mapWorkflowEventRow() → SSETransport → browser
```

Detalhe interessante do `PgNotifyListener`: **a notificação não carrega payload
emissível** — só chama `poller.drainNow()`. A justificativa está no comentário: mantém
cursor, mapeamento e dedup em **um só lugar**, então um NOTIFY perdido ou coalescido nunca
dessincroniza estado.

O `SSETransport` (`packages/server/src/adapters/web/transport.ts`) tem um invariante
fail-fast em tempo de módulo: `if (EVENT_BUFFER_TTL_MS < RECONNECT_GRACE_MS) throw`. O
motivo documentado: um `tool_result` caindo na janela de reconexão produz "tool cards"
girando eternamente na UI.

### 4.7 Fluxo E — webhook do GitHub até workflow

`POST /webhooks/github` (`packages/server/src/routes/webhooks.ts`) lê o corpo **cru**
(`c.req.text()` — comentado como *"CRITICAL: … for signature verification"*), despacha
fire-and-forget e retorna `200` imediatamente.

`GitHubAdapter.handleWebhook` (`packages/adapters/src/forge/github/adapter.ts:977`), na
ordem real:

1. `verifySignature` — HMAC-SHA256 com `timingSafeEqual`
2. `JSON.parse`
3. Autorização por allowlist → rejeição **silenciosa** com login mascarado (`abc***`).
   O comentário justifica: *"Posting a denial would tell unauthorized users a bot exists."*
4. `parseEvent` — trata `issues.closed`, `pull_request.closed`, `issue_comment`.
   **Retorna `null` para `.opened`** (issue #96: descrições contêm exemplos de comandos)
5. Anti-self-trigger: ignora corpo contendo `<!-- archon-bot-response -->` ou autor `botLogin`
6. `hasMention` — regex `@${botMention}[\s,:;]`
7. **Idempotência**: `dedupKey = comment:<owner>/<repo>#<n>:<id>:<updated_at>`, reivindicada
   **antes** do trabalho downstream (assinaturas duplas repo+App entregam o mesmo comentário
   sob GUIDs diferentes)
8. Resolve identidade, conversa, codebase, branch default
9. Monta `isolationHints` (`prBranch`, `prSha`, `linkedIssues`, `isForkPR`)
10. `lockManager.acquireLock(conversationId, () => handleMessage(...))`

A partir daí quem decide se vira workflow é o orquestrador — o adapter entrega intenção
normalizada, identidade e hints de isolamento.

### 4.8 Fluxo F — o run detached (`--detach`)

Este é um dos mecanismos mais bem construídos do projeto.

**No pai** (`packages/cli/src/commands/workflow.ts:1971`): pré-flight completo antes do
fork (recusa de classe interativa, resolução de codebase, adoção), e **então cria a linha
do run** — o "Started" só é impresso quando existe um run consultável. Monta os argumentos
extras, sela o `runConfig` cifrado em `--internal-detached-run-config`, e faz spawn com
`child_process.spawn` do **Node** (não `Bun.spawn`), porque o comentário registra que
`Bun.spawn + unref()` não desanexa no Windows — o filho morria ~1 s depois.

`waitForDetachedStartup` observa uma janela de 500 ms: exit 0 = completou; exit **90**
(`DETACHED_RUN_FAILED_EXIT_CODE`) = o filho reportou falha do próprio run; qualquer outro
código = falha de lançamento, com o *tail* do log anexado ao erro.

**IPC com o run em andamento** (`packages/cli/src/utils/detached-run-control.ts`, 572
linhas): endpoint por run, user-scoped, em Unix socket `/tmp/archon-<uid>/<token>.sock`
(POSIX) ou named pipe `\\.\pipe\archon-workflow-<token>` (Windows). O diretório é criado com
modo `0700` e **validado** — precisa ser diretório (não symlink), pertencer ao uid corrente
e ter `(mode & 0o077) === 0`.

Protocolo de duas fases:

```
cliente → "stop\n"       │ owner → {"pid": N}\n   → fase lease
cliente → "terminate\n"  │ owner → "ready\n"      → estende timeout (lease aberto
                         │                           impede que o PID seja reciclado
                         │                           enquanto os sinais estão em voo)
```

A terminação em si distingue plataformas: POSIX faz `kill(-pid, SIGTERM)` → grace de 5 s →
`SIGKILL` → confirmação. Windows usa `taskkill /PID <pid> /T /F`, mas **o exit code do
taskkill não é a prova** — a confirmação é `waitUntilGone(processExists)`.

---

## 5. Detalhes de implementação interessantes

### 5.1 A constituição da linguagem de workflow

`.archon/workflow-language-constitution.md` merece leitura integral. Ele abre com uma
observação histórica precisa: *"Jenkins pipelines grew Groovy. GitHub Actions grew an
expression language. Helm grew Turing-complete templating. Airflow grew so much
Python-in-config that it eventually surrendered."*

A regra é:

> **YAML coordinates. Code computes. Agents judge.**

E o teste de admissibilidade tem três perguntas que toda feature nova de YAML precisa
passar:

1. O engine **precisa ver isso** para governar o run?
2. É **dado declarativo** ou é **avaliação**?
3. Um nó de script + a wiring existente já expressaria isso hoje?

Há uma **regra de independência** separada, sobre paralelismo:

> **Filhos paralelos são independentes por padrão. Qualquer coisa que acople seus destinos
> é opt-in, e precisa vir da declaração do autor em vez de ser inferida.**

Essa regra tem consequência de código verificável: `join: 'first_success'` é **rejeitado,
não adiado** no schema de fan-out. O valor do enum é mantido só para dar uma mensagem
explicando a rejeição. O raciocínio: um vencedor cancelando os perdedores acopla os
destinos dos filhos.

### 5.2 Captura congelada da fonte (`workflow-source.ts`)

Provavelmente o mecanismo mais subestimado do projeto. O problema, do próprio cabeçalho:
Archon sempre teve dois diretórios escondidos atrás de um `cwd` — a **fonte** de onde
workflow/commands/scripts são lidos, e o **alvo** onde o run age.

A solução antiga era copiar a árvore `.archon` inteira para o worktree — o que sujava o
`git status`, alimentava validadores com pacotes estranhos e carregava `.archon/.env`
junto.

A solução atual: `captureWorkflowSource` congela os diretórios de fonte **uma vez, antes
mesmo do workflow ser selecionado**, num diretório que o run possui. O manifesto grava
`version`, `engine_version`, `origin`, `captured_at`, `digest`, `file_count`,
`byte_count`, `scopes`. **O digest é recomputado na carga** — existência do diretório não
prova nada. Falha → `WorkflowSourceIntegrityError`, e o run **falha** em vez de degradar
para fonte live.

Num binário compilado, a captura **materializa as constantes embutidas em arquivos**. É
isso que permite um run pausado retomar através de um upgrade do Archon.

### 5.3 Derivação em vez de sincronização manual

O `AGENTS.md` tem uma regra que gera código real:

> *"Duas declarações que precisam concordar para permanecerem corretas, mantidas em acordo
> por disciplina em vez de por um mecanismo, são um defeito presente e não um risco
> futuro."*

A implementação é sistemática. Constantes derivadas de schemas:

```ts
// packages/workflows/src/schemas/workflow.ts
KNOWN_WORKFLOW_KEYS = Object.keys(workflowDefinitionSchema.shape)
KNOWN_DAG_NODE_KEYS = Object.keys(dagNodeFlatSchema.shape)
```

Provas de cobertura por tipo (`packages/providers/src/shared/effort.ts`):

```ts
export type ClaudeEffortsAreComplete =
  AssertNever<Exclude<NonNullable<Options['effort']>, (typeof CLAUDE_EFFORTS)[number]>>;
```

O comentário explica por que isso é necessário: `satisfies` prova *containment*, não
*coverage* — e foi exatamente assim que `max` sumiu da lista do Pi sem quebrar o
type-check.

E onde a derivação é impossível por fronteira de pacote, a paridade é provada por teste,
não por comentário — `scripts/node-ref-parity.test.ts` usa **três mecanismos distintos**:

1. Comparação por **texto** para a referência `$node.output` (extrai o `String.raw` dos
   dois lados, com anti-decoy por `stripComments()` + âncora de coluna 0)
2. Comparação por **execução** para o `when:` (`ATOM_PATTERN.source === WHEN_ATOM_PATTERN.source`),
   porque o padrão é composto e ler composição como texto já quebrou
3. Comparação por **veredito** para os canais de término de loop (23 combinações,
   builder vs. `dagNodeSchema.safeParse`)

Duas regressões históricas estão pinadas no arquivo: #2567 (a cópia legacy usava `\w`, que
exclui o hífen, então validava **nenhum** dos ids hifenizados dos workflows bundled) e
#2591 (`$INPUTS.<name>` adicionado ao engine sem a cópia acompanhar).

### 5.4 O padrão "arquivo gerado + script dono + check no CI"

Uniforme em todo o repositório:

1. Existe **uma fonte da verdade** (arquivos em disco, o SDK instalado, o registry, o SQL)
2. Existe **um script dono** em `scripts/`, com dois modos: sem flag **escreve**, com
   `--check` regenera em memória e **compara**, saindo com **exit code 2** em drift
3. Um par de scripts no `package.json`: `generate:<x>` e `check:<x>`
4. O `check:` está no alvo `validate` **e** num passo nomeado do CI
5. Frequentemente há um teste no próprio `scripts/`

| Artefato gerado | Script dono | Check |
|---|---|---|
| `packages/workflows/src/defaults/bundled-defaults.generated.ts` | `scripts/generate-bundled-defaults.ts` | `check:bundled` |
| `packages/cli/src/bundled-skill.ts` | `scripts/check-bundled-skill.ts` | `check:bundled-skill` |
| `packages/core/src/db/bundled-schema.generated.ts` | `scripts/generate-bundled-schema.ts` | `check:bundled-schema` |
| `packages/providers/src/community/pi/pi-vendor-map.generated.ts` | `scripts/generate-pi-vendor-map.ts` | `check:pi-vendor-map` |
| tabela de capacidades nas docs | `scripts/generate-capability-matrix.ts` | `check:capability-matrix` |
| fixtures de vintages SQLite | `scripts/generate-sqlite-vintages.ts` | `check:sqlite-vintages` |
| `packages/web/src/lib/api.generated.d.ts` | `packages/server/src/scripts/generate-api-types.ts` | `check:api-types` |

O `.husky/pre-commit` fecha o loop localmente: se o commit toca
`.archon/(workflows|commands|scripts)/`, roda `generate:bundled` **depois** do lint-staged
e re-adiciona o arquivo — com um comentário registrando que a ordem inversa já embarcou um
bundle stale no CI em 2026-08-22.

O `scripts/generate-pi-vendor-map.ts` é o exemplar mais interessante: extrai o mapa
backend→env-var do **SDK instalado** e faz uma **checagem de totalidade** — um backend
upstream novo falha o check até ser classificado. Nasceu de um drift real (#1955): o Archon
entregava `HUGGINGFACE_API_KEY` enquanto o `pi-ai` lia `HF_TOKEN`.

### 5.5 Fail-loud como política, não como estilo

O `AGENTS.md` diz: *"Fail early on unsupported, ambiguous, or unsafe states. Silent
fallback in an agent runtime can waste money or broaden capabilities."*

Exemplos concretos, todos verificados:

- **Produtor `failed` sempre lança** ao ser referenciado (`output-ref.ts`)
- **Captura de fonte falha o run** em vez de degradar para fonte live
- **Resolver de isolação de filho rejeita** em vez de cair no checkout compartilhado
- **`resolveFolderBackend` com `container: true` sem store lança** — *"never a silent
  in-place downgrade"* (`packages/isolation/src/backend-router.ts`)
- **`ContainerBackend.destroy` sem container nem volume lança alto**, com instruções de
  `docker ps -a --filter label=diy.archon.managed=true`
- **`getDefaultBranch` nunca adivinha** — se `<remote>/HEAD` não é symbolic ref, lança
  pedindo `--base`. O comentário justifica: tratar "origin/main existe" como default está
  errado em repos onde `main` é release e o default é `dev` (#2471)
- **App + PAT do GitHub simultâneos** = `throw` no boot, com mensagem "pick one"
- **Sem credenciais de IA** = `log.fatal` + `exit(1)` antes de abrir socket

E o contra-exemplo instrutivo — `validateStructuredOutput` (`packages/providers/src/shared/
structured-output.ts`) é **fail-SAFE**: se o Ajv não consegue compilar o schema, retorna
`{ valid: true }`, para que um schema inaplicável não transforme uma resposta correta em
falha espúria.

### 5.6 "Vendor output is prose" — classificação de erro

Regra do `AGENTS.md`: *"Classifying git, SDK, or vendor error text with a pattern is a last
resort. Prefer the structured channel (exit code, typed error class, `--json`), then agent
classification into a typed value, then an honest unclassified failure."*

Isso produz um cuidado visível: `AUTH_PATTERNS` e `RATE_LIMIT_PATTERNS` em
`packages/providers/src/codex/provider.ts` **excluem deliberadamente códigos HTTP nus**
(`401`/`403`/`429`), porque dígitos aparecem em portas e durações (#2509). O mesmo em
`packages/core/src/utils/error-formatter.ts`: *"bare digits aren't enough signal"*.

E `UNTYPED_TRANSIENT_PATTERNS` (`packages/providers/src/claude/provider.ts:259`) tem um
**contrato de admissão explícito**: cada entrada deve nomear o erro upstream, linkar a
issue, e ser removida quando o SDK tipar.

> **Onde a regra é violada, honestamente:** `packages/isolation/src/providers/worktree.ts`
> classifica stderr do git por substring em vários pontos (`already exists`,
> `checked out at`, `not found`). É comportamento atual, não recomendação.

### 5.7 A fronteira de capacidade dos nós de IA

Regra do `AGENTS.md`: *"Workflow AI nodes start without ambient skills, skill-like plugins,
or MCP servers. A node receives only the skills, plugins, and MCP servers it explicitly
names. Enforce that boundary without hiding unrelated provider settings."*

Implementação em `packages/providers/src/claude/provider.ts:493` (`applyNodeConfig`), com
o nó de workflow detectado por `nodeConfig.nodeId` não-vazio:

```ts
options.skills = nodeConfig.skills ?? [];   // sem skills ambientes
options.strictMcpConfig = true;             // sem MCP ambiente
```

Mantendo, porém, `settingSources: ['project','user']` — CLAUDE.md e agents continuam
visíveis. Os testes de fronteira precisam provar **as duas metades**: settings nativos
permanecem visíveis, e skills/plugins/MCP não-declarados permanecem indisponíveis.

### 5.8 O isolamento por container: overlayfs

O `ContainerBackend` (`packages/isolation/src/backends/container.ts`) é opt-in e só vale
para projetos `kind = 'folder'`. A topologia:

```
-v <hostRoot>:/mnt/lower:ro          # raiz do projeto, READ-ONLY (= lowerdir)
-v archon-<uuid>-upper:/mnt/upper    # volume nomeado por run (= upperdir + workdir)
-v <sourceMount>:<sourceMount>:ro    # source congelado do run, MESMO path
```

O `entrypoint.sh` monta o merge em `$ARCHON_WORKSPACE_PATH` — **o mesmo path absoluto do
host**. Esse "same-absolute-path invariant" é o que mantém `working_path`,
`$ARTIFACTS_DIR` e toda substituição de path válidos sem camada de tradução.

Dois modos de overlay, tentados em ordem de **menor privilégio primeiro**:

| Modo | Flags docker | Escape remount? |
|---|---|---|
| `fuse` | `--device /dev/fuse` (sem CAP_SYS_ADMIN) | **fechado** |
| `native` | `--cap-add SYS_ADMIN --security-opt apparmor=unconfined` | **aberto** |

O `packages/isolation/docker/SECURITY.md` é notavelmente franco: em modo `native`, root
dentro do container pode `mount -o remount,rw /mnt/lower` e escrever direto na raiz viva.
Portanto o backend container é **"isolation hardening" para runs cooperativos, não sandbox
contra agente hostil ou prompt-injected**. O `PreparedEnv.overlayMode` existe justamente
para o engine avisar alto no início do run.

**Write-back.** A premissa: por construção do overlayfs, a upper layer **É** o diff contra
a lower. Logo o cálculo é um walk de diretório, não comparação de árvores. `finalize()`
roda um container efêmero com `--cap-drop ALL --network none --security-opt
no-new-privileges` para produzir o resumo; `applyChanges()` é **o único momento** em que a
raiz viva é escrita.

Os scripts shell de diff/apply (`packages/isolation/src/container/overlay.ts`) são
endurecidos contra overlay adversarial de forma pouco comum:

- `set -uf` — `-f` desliga globbing, para nome malicioso não expandir
- `valid_name()` — rejeita whiteout vazio / `.` / `..` (um `.wh.` com nome vazio faria
  `rm -rf` no pai)
- `safe_parent()` — todo componente do destino que existe precisa ser diretório **real**,
  nunca symlink
- `has_tab()` — recusa registros com TAB no nome **ou no target**, porque o parse é
  posicional e um TAB no target deslocaria campos, fazendo um symlink escapante chegar ao
  gate de aprovação **renderizado como seguro**
- Cópia por **conteúdo apenas** (`cp`, nunca `cp -a`), seguida de `chmod u-s,g-s,o-t` —
  um setuid plantado aterrissa inerte
- Split de path por expansão de parâmetro (`${rel%/*}`), não `basename`/`$(…)`, porque
  `$(…)` corta newlines finais e um nome terminado em newline agiria no arquivo errado

E as limitações são **declaradas**, não silenciosamente erradas: marcadores de diretório
opaco em overlay nativo usam xattr, então "substituir um diretório inteiro" pode não
aplicar completo; hardlinks viram arquivos independentes.

### 5.9 Identidade content-addressed no fan-out

`packages/workflows/src/fan-out-identity.ts` resolve um problema sutil: step names de uma
instância de fan-out são `<nodeId>__<identity>__<innerNodeId>`, e a hidratação de resume
chaveia em identity. Então identity precisa ser determinística sob reordenação, encolhimento
e crescimento da lista.

```ts
export function composeInstanceIdentity(item: JsonValue, duplicateOrdinal: number): string {
  const hash = createHash('sha256').update(canonicalValueText(item)).digest('hex').slice(0, 16);
  return duplicateOrdinal === 0 ? hash : `${hash}-${String(duplicateOrdinal)}`;
}
```

Reordenar ou encolher nunca muda a identity de um item distinto. Remover uma cópia de um
valor duplicado renumera os ordinais dos sobreviventes — o que não pode mis-hidratar,
porque itens byte-idênticos são observacionalmente intercambiáveis.

### 5.10 Concorrência e locks

Três mecanismos distintos, com escopos diferentes:

**`ConversationLockManager`** (`packages/core/src/utils/conversation-lock.ts`) — ordem
sequencial **por conversa** mais um limite global (`MAX_CONCURRENT_CONVERSATIONS`, default
10). `acquireLock` retorna `{status: 'started'|'queued-conversation'|'queued-capacity'}`
imediatamente; a Promise vai no Map **antes** do await, evitando a race.

**Path lock por run** — `getActiveWorkflowRunByPath(workingPath, self?)` em
`packages/core/src/db/workflows.ts`. Tiebreaker determinístico `(started_at, id)`, com o
detalhe de que `id` e `startedAt` viajam juntos numa struct opcional única, para tornar o
invariante estrutural. Sub-runs compartilham o checkout do pai por design, então
`self.excludeRunIds` exclui a cadeia de ancestrais.

**CAS de gate** — `resolveApprovalGate(id, metadata, events)` faz UPDATE condicional
(`status='paused' AND <resolved> IS NULL`) **mais** inserção dos eventos **na mesma
transação**. `resolved: false` significa que perdeu a corrida. Isso fecha o TOCTOU do
read-then-write (#2113) e o buraco de "gate resolvido sem trilha de auditoria" (#2146).

### 5.11 O workaround de boot (`strip-cwd-env`)

`packages/paths/src/strip-cwd-env.ts` precisa ser o **primeiro import** de todo entry
point, e existe por quatro razões distintas:

1. **Vazamento do `.env` do CWD.** O Bun carrega `.env`, `.env.local`, `.env.development`,
   `.env.production` do CWD **antes de qualquer código de usuário**. Quando `archon` roda
   de dentro de um repo alvo, as vars daquele repo entram no processo Archon. O
   `override: true` do dotenv não resolve — só corrige chaves presentes em ambos.
2. **Marcadores de sessão Claude Code aninhada.** Quando o Archon é lançado de um terminal
   Claude Code, o shell exporta `CLAUDECODE=1` e `CLAUDE_CODE_*`. O Agent SDK vaza
   `process.env` para o filho **independentemente** da opção `env` explícita (#1097).
3. **Vars de debugger** (`NODE_OPTIONS`, `VSCODE_INSPECTOR_OPTIONS`) que crasham
   subprocessos.
4. **Vars de inspector do Bun** (`BUN_INSPECT*`) que fazem todo subprocesso tentar bindar
   o socket de debug do pai → loop de crash EADDRINUSE (#2030).

A contraparte é `env-loader.ts`, com regra declarada: *"Directory ownership (`.archon/`) is
the security boundary, not the filename."* Carrega `~/.archon/.env` e
`<cwd>/.archon/.env`, mas **nunca** `<cwd>/.env`.

### 5.12 Criptografia de credenciais

`packages/core/src/utils/token-crypto.ts` — AES-256-GCM, formato
`base64(iv[12] ‖ authTag[16] ‖ ciphertext)`. A chave vem de três camadas: `TOKEN_ENCRYPTION_KEY`
(hex 64 chars, nunca toca o disco) → `~/.archon/credential-key` existente → **auto-gera e
persiste** com mode `0600` (mais `chmodSync` explícito, porque o umask dilui o mode do
`writeFileSync`).

`readOrCreateLocalKey` **nunca regenera silenciosamente** um arquivo malformado — isso
orfanaria todas as credenciais. Lança com instrução.

A **run config também é cifrada em repouso** (`sealWorkflowRunConfig`):
`{ version: 1, ciphertext, source, keys }`, onde `keys` é a lista legível de paths
configurados, sem valores. Isso permite que a config viaje em `metadata` pública de um run
e num argumento de linha de comando para o filho detached.

Um detalhe de entrega notável em `packages/providers/src/community/pi/request-auth.ts`:
para providers custom, escreve um `models.json` **por chamada** com `${VAR}` já
substituído (modo `0o600`, dir `0o700`), removido em `finally`. Chaves em
`protectedEnvKeys` são substituídas por um placeholder estruturalmente válido mas
**comprovadamente irresolúvel** (`${__ARCHON_BLOCKED_<VAR>__}`).

### 5.13 O `IWorkflowStore` e a documentação de ausência

`packages/workflows/src/store.ts` define ~50 tipos de evento em `WORKFLOW_EVENT_TYPES`, e
cada um tem comentário explicando quando é escrito **e o que sua ausência não significa**.
Exemplo literal:

> `workflow_resumed` — escrito pelo CAS de resume **APENAS** quando limpa um
> `metadata.error` não-vazio… NÃO é um marcador geral de "houve um resume": sua ausência
> nunca significa que o run não foi retomado.

Isso importa concretamente para quem for reconstruir estado de um run a partir do log de
eventos. É um padrão que aparece pouco em bases de código.

Há também uma distinção de política nos três escritores de evento:

| Função | Contrato |
|---|---|
| `createWorkflowEvent` | **"MUST NOT throw"** — observabilidade pura, execução continua |
| `persistWorkflowEvent` | Propaga falha — usar só quando a execução não pode prosseguir sem a linha |
| `persistWorkflowEventIfRunning` | Atômico, com `options.allowPaused` |

### 5.14 `TerminalStatusWriteError`

`packages/workflows/src/terminal-status-write.ts` contém apenas duas coisas, e a razão é
precisa: quando a escrita de status terminal falha, o processo terminou mas a linha ainda
diz `running`. Portanto **nenhum resultado comum pode ser reportado e nenhuma escrita
compensatória deve ser tentada pelo mesmo canal**.

Esse tipo é re-lançado em todos os catches por-nó do `dag-executor.ts` — nunca vira "nó
falhou". E é tratado à parte em `workflow-resume-service.ts`, em
`dispatchBackgroundWorkflowOwned`, e em `error-formatter.ts` (com mensagem própria porque
`/reset` não conserta nada e esconderia um run travado).

### 5.15 Testes de workflow como código (fixtures)

`packages/workflows/src/fixture-runner.ts` (#2772). Uma fixture é `<name>.stubs.yaml` num
diretório `fixtures/` ao lado do YAML do workflow:

```yaml
fixture:
  expect: completed          # ou failed / paused / cancelled
  fail-node: gate-ready      # obrigatório sse expect: failed
  reached: [review__docs]    # nós que devem completar ou ser stubados
  inputs:
    branch: "task-123"
  resolved-text-contains:
    implement: "task-123"
exec-code: false             # executa nós script/bash em vez de stubar
# toda chave restante é node-id → stub-output
```

Duas propriedades importantes:

- **SOURCE** — scripts nomeados e arquivos de comando resolvem por **uma**
  `captureWorkflowSource` congelada por invocação, o mesmo mecanismo do `workflow run`.
  Uma fixture não pode passar num workflow cuja captura quebraria o run real.
- **TARGET** — nós `exec-code: true` executam contra um worktree scratch do HEAD do repo
  caller, nunca a árvore do operador.

O único caminho de execução é `dryRunWorkflow`, então uma fixture nunca dispara um run real
nem uma chamada de provider. O pack `sdlc/deliver` tem **19 fixtures** cobrindo cenários
como `red-inherited`, `red-introduced`, `late-red-unconverged`, `correction-honest-decline`,
`replan`, `converge`.

### 5.16 Telemetria com invariantes de privacidade

`packages/paths/src/telemetry.ts` (937 linhas) merece nota por três decisões:

**Regra de nome de workflow.** `classifyWorkflowForTelemetry` — workflows `bundled`
reportam o nome real; `global`/`project` reportam literalmente `"custom"`, para que nomes
privados tipo "deploy-acme-prod" nunca saiam da máquina.

**Invariantes espalhados por evento.** `PRIVACY_INVARIANTS = { $process_person_profile:
false, $ip: '' }` são anexados a **cada evento individualmente**, deliberadamente **não**
registrados como super-property. O comentário: assim uma regressão em `register()` não pode
silenciosamente vazar IP ou criar person profile.

**Consentimento versionado.** O stamp de primeiro aviso é
`~/.archon/telemetry-notice-shown-v4`. O sufixo é versionado de propósito: quando o
conjunto de propriedades capturadas se amplia, o nome é bumped e o aviso **re-aparece**,
para usuários existentes re-consentirem em vez de receberem captura mais ampla em silêncio.

Opt-out por quatro vias: `ARCHON_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1`, `CI=true`,
`POSTHOG_API_KEY` ∈ `{'', 'off', '0', 'false', 'disabled'}`.

---

## 6. Modelo de dados

### 6.1 Filosofia de evolução do schema

O `AGENTS.md` fixa uma regra incomum e consequente:

> *"Database schema evolution is additive-only. There is no migration ledger or version
> gate, and older binaries may open the same database. Never rename, retype, or drop a
> shipped table or column."*

Consequências verificáveis:

- **Não existe ledger de migrations.** `migrations/000_combined.sql` é totalmente
  idempotente (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) e é aplicado no
  boot.
- `remote_agent_schema_version` (id=1) é **puramente diagnóstico** — lido por
  `archon doctor` e `/api/health`, nada faz gate nesses valores.
- Sentinelas em vez de migrações: `NO_BRANCH_SENTINEL = '' as unknown as BranchName` no
  backend de container, porque `branch_name` é `NOT NULL` nos dois dialetos e é conceito de
  worktree.
- O layout do arquivo é **load-bearing**: todo `CREATE INDEX` e `COMMENT ON COLUMN` vai na
  seção final, abaixo de todo `ADD COLUMN` — porque um `CREATE INDEX` sobre coluna
  inexistente abortaria o bloco inteiro.

### 6.2 As 14 tabelas centrais

Todas com prefixo `remote_agent_` (herança do nome original do projeto).

```
                         ┌──────────────────┐
                         │  users           │
                         │  id, display_name│
                         │  email, role     │
                         └────────┬─────────┘
                                  │ 1:N
            ┌─────────────────────┼──────────────────────┬────────────────┐
            ▼                     ▼                      ▼                ▼
  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────┐
  │ user_identities  │  │user_github_tokens│  │user_provider_keys│  │user_ai_  │
  │ platform,        │  │ encrypted        │  │ encrypted        │  │  prefs   │
  │ platform_user_id │  │ (1 por user)     │  │ (1 por provider) │  │(tiers/   │
  └──────────────────┘  └──────────────────┘  └──────────────────┘  │ aliases) │
                                                                     └──────────┘

  ┌──────────────────────────┐         ┌───────────────────────────┐
  │ codebases                │◀────────│ codebase_env_vars         │
  │ id, name, repository_url │  1:N    │ codebase_id, key, value   │
  │ default_cwd, default_    │         └───────────────────────────┘
  │ branch, kind('repo'|     │
  │ 'folder'), allow_env_keys│
  └────┬─────────────────────┘
       │ 1:N
       ├──────────────────────────────────────────┐
       ▼                                          ▼
  ┌──────────────────────────┐        ┌───────────────────────────────┐
  │ conversations            │◀──────▶│ isolation_environments        │
  │ platform_type,           │        │ workflow_type, workflow_id,   │
  │ platform_conversation_id │        │ provider, working_path,       │
  │ cwd, isolation_env_id,   │        │ branch_name, status, metadata │
  │ title, hidden, deleted_at│        └───────────────────────────────┘
  └────┬────────────┬────────┘
       │ 1:N        │ 1:N
       ▼            ▼
  ┌──────────┐  ┌───────────────────────────────────────────┐
  │ messages │  │ workflow_runs                             │
  │ role,    │  │ workflow_name, status, outcome,           │
  │ content, │  │ user_message, metadata (JSONB),           │
  │ metadata │  │ working_path, output_root,                │
  └──────────┘  │ parent_run_id ──┐ (self-FK)               │
                │ adopted_from_run_id ──┘                   │
                └────┬──────────────────────────────┬───────┘
                     │ 1:N                          │ 1:N
                     ▼                              ▼
       ┌─────────────────────────┐   ┌────────────────────────────────┐
       │ workflow_events         │   │ workflow_run_node_sessions     │
       │ event_order, event_type,│   │ (PK: run_id + node_id)         │
       │ step_name, data (JSONB) │   │ privado ao run, cascade         │
       └─────────────────────────┘   └────────────────────────────────┘

  ┌────────────────────────────────────────────────────────────────┐
  │ workflow_node_sessions  (PK: workflow_name+node_id+scope+prov) │
  │ sessões de provider persistidas ENTRE runs (persist_session)   │
  └────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────┐
  │ sessions  (conversation_id, assistant_       │
  │ session_id, active, parent_session_id,       │
  │ transition_reason, ended_reason)             │
  └──────────────────────────────────────────────┘

  + remote_agent_auth_{user,session,account,verification}  (Better Auth, só Postgres)
  + remote_agent_schema_version                             (diagnóstico)
```

### 6.3 Entidades e o que cada uma significa

**`codebases`** — um projeto registrado. O discriminador `kind` é central: `'repo'` (git,
usa worktrees) ou `'folder'` (workspace não-git, roda in-place ou em container). O
`default_cwd` é comparado por **igualdade exata de string**, o que motivou a
canonicalização única em `canonicalizeProjectPath` (ver §9.2).

**`conversations`** — uma thread em qualquer plataforma. `UNIQUE(platform_type,
platform_conversation_id)`. O `isolation_env_id` é uma FK adiada (declarada depois da
tabela de ambientes, para evitar dependência circular). Soft delete via `deleted_at`;
`hidden` marca conversas worker de runs em background.

**`sessions`** — o handle de sessão do provider de IA para uma conversa. É uma cadeia
(`parent_session_id` auto-referencial) com `transition_reason` e `ended_reason`, o que
permite reconstruir por que uma sessão foi trocada.

**`isolation_environments`** — worktrees e containers, com ciclo de vida independente da
conversa. O par `(workflow_type, workflow_id)` é o que permite **reuso**: dois eventos
sobre a issue #42 resolvem para o mesmo worktree.

**`workflow_runs`** — a linha central de auditoria. Três campos merecem destaque:

| Campo | Semântica |
|---|---|
| `status` | ciclo de vida: `pending`, `running`, `completed`, `failed`, `cancelled`, `paused` |
| `outcome` | **veredito autoral** (`succeeded`/`failed`), independente do status. `NULL` nunca significa falha |
| `output_root` | write-once (#2200). Reescrever na retomada re-derivaria o caminho de um codebase renomeado e orfanaria os artefatos |

Duas FKs auto-referenciais, ambas write-once e `ON DELETE SET NULL`:
`parent_run_id` (sub-run) e `adopted_from_run_id` (continuação entre runs, #2747). Deletar
um pai orfana os filhos em vez de cascade-deletar a trilha de auditoria deles.

**`workflow_events`** — a timeline durável. A coluna `event_order` é o exemplo mais
didático da disciplina de schema do projeto. O comentário no SQL explica: é **deliberadamente
uma coluna simples com DEFAULT de sequence, NÃO `GENERATED ... AS IDENTITY`**, porque
adicionar uma identity column **reescreve a tabela inteira sob ACCESS EXCLUSIVE**
(verificado no postgres:18: o relfilenode muda) — e essa é a maior tabela do schema, que
auto-aplica no startup. Além disso, mantém os dois bancos honestos: linhas existentes ficam
`NULL` em Postgres **e** SQLite, então o fallback `COALESCE(event_order, 0)` se comporta
igual.

**As duas tabelas de sessão de nó** têm escopos deliberadamente diferentes:

| Tabela | Chave | Escopo | Cascade |
|---|---|---|---|
| `workflow_run_node_sessions` | `(run_id, node_id)` | privado a **um** run | sim, com o run |
| `workflow_node_sessions` | `(workflow_name, node_id, scope_key, provider)` | **entre** runs (`persist_session`) | não (documentado: soft delete + UUID nunca reusado = órfãos inofensivos) |

### 6.4 O padrão dual-dialect

O contrato está em `packages/core/src/db/adapters/types.ts`:

```ts
interface IDatabase {
  query<T>(sql, params): Promise<{rows: T[], rowCount: number}>;
  withTransaction<T>(fn): Promise<T>;
  close(): Promise<void>;
  dialect: SqlDialect;
}

interface SqlDialect {
  generateUuid(); now(); jsonMerge(col, i);
  jsonArrayContains(col, path, i); nowMinusDays(i); daysSince(col);
}
```

O SQL é escrito no dialeto Postgres e traduzido. `packages/core/src/db/adapters/sqlite.ts`
converte placeholders `$N` → `?` reordenando os params pela ordem de aparição, e remove
`::jsonb` / `::INTERVAL`. **`RETURNING` em UPDATE/DELETE lança erro explícito** com hint —
restrição que molda o design de várias funções em `db/workflows.ts`.

Uma diferença semântica **não** é abstraída, e o código lida com ela explicitamente:
`||` do Postgres faz merge **shallow**, `json_patch` do SQLite **recursa**. Por isso
`writeApprovalMetadata` deliberadamente **não** usa `dialect.jsonMerge` — substitui o
objeto `approval` inteiro nos dois dialetos, porque a divergência fazia chaves internas de
um gate anterior sobreviverem (#2673).

Aplicação do schema:

- **Postgres**: `BEGIN` → `pg_advisory_xact_lock(1796)` (serializa boots concorrentes) →
  probe → aplica o SQL idempotente → `recordSchemaVersion` **dentro de SAVEPOINT** (uma
  falha de metadata não pode "brickar" o adapter) → `COMMIT`. Depois, best-effort:
  `installNotifyTrigger()`.
- **SQLite**: probe → `createSchema()` (um `db.run` com todos os `CREATE TABLE IF NOT
  EXISTS`) → `migrateColumns()` (`PRAGMA table_info` + `ALTER TABLE ADD COLUMN`, **cada
  bloco com try/catch próprio**).

---

## 7. Configuração, deploy e operação

### 7.1 As três camadas de configuração

Documentadas em `.archon/config.example.yaml`:

| Camada | Arquivo | Escopo |
|---|---|---|
| 1 | `~/.archon/config.yaml` | Global, do usuário. Provider default, defaults por provider, tiers |
| 2 | `<repo>/.archon/config.yaml` | Do projeto, **commitado**. Só fatos verdadeiros para todo contribuidor |
| 3 | `<repo>/.archon/config.<name>.yaml` | **Por run**, via `--config`, gitignored |

O arquivo é explícito sobre a camada 2: *"não coloque escolhas pessoais de modelo aqui;
elas seriam enviadas para todos"*.

A camada de run tem semântica própria: **esparsa e estrita** (chave desconhecida é erro
duro, não drop silencioso), vence a config persistente, é **selada no lançamento** (editar
o arquivo durante o run não muda nada), e `--config` é rejeitado junto com `--resume`.

A config real do projeto Archon (`.archon/config.yaml`) tem apenas 21 linhas e três blocos,
cada um com justificativa:

```yaml
worktree:
  baseBranch: dev
  copyFiles: [.env]     # git worktree add só carrega arquivos rastreados
docs:
  path: packages/docs-web/src/content/docs
aliases:
  '@mini': { provider: pi, model: minimax/MiniMax-M3 }
```

### 7.2 Variáveis de ambiente

O `.env.example` da raiz tem 360 linhas organizadas em 12 blocos. As categorias e as
variáveis mais importantes:

| Categoria | Variáveis-chave |
|---|---|
| **Banco** | `DATABASE_URL` (ausente = SQLite em `~/.archon/archon.db`) |
| **Claude** | `CLAUDE_USE_GLOBAL_AUTH`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_API_KEY`, `CLAUDE_BIN_PATH` |
| **Codex** | `CODEX_ID_TOKEN`, `CODEX_ACCESS_TOKEN`, `CODEX_REFRESH_TOKEN`, `CODEX_BIN_PATH` |
| **Pi (~20 backends)** | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN` |
| **Seleção** | `DEFAULT_AI_ASSISTANT`, `TITLE_GENERATION_MODEL` |
| **GitHub PAT** | `GH_TOKEN` / `GITHUB_TOKEN` |
| **GitHub App** | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY[_PATH]`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID` |
| **Criptografia** | `TOKEN_ENCRYPTION_KEY` (64 hex; também é *feature gate*) |
| **Auth web** | `BETTER_AUTH_SECRET` (≥32), `ARCHON_AUTH_ALLOWED_EMAILS`, `ARCHON_WEB_AUTH_HEADER`, `ARCHON_WEB_AUTH_REQUIRED` |
| **Webhooks/forges** | `WEBHOOK_SECRET`, `GITLAB_*`, `GITEA_*`, `*_ALLOWED_USERS` |
| **Chat** | `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`, `*_ALLOWED_USER_IDS`, `*_STREAMING_MODE` |
| **Servidor** | `PORT` (3090 dev / 3000 Docker), `HOST`, `DOMAIN`, `CADDY_BASIC_AUTH` |
| **Operação** | `LOG_LEVEL`, `MAX_CONCURRENT_CONVERSATIONS` (10), `SESSION_RETENTION_DAYS` (30) |
| **Telemetria** | `ARCHON_TELEMETRY_DISABLED`, `DO_NOT_TRACK`, `POSTHOG_API_KEY`, `POSTHOG_HOST` |

Fail-fast notável: o arquivo diz explicitamente que **o Archon se recusa a iniciar se
`GITHUB_TOKEN` e `GITHUB_APP_ID` estiverem ambos setados**.

A configuração de **isolamento por container** (image, network, memoryMb, pidsLimit)
**não** está no `.env` — vive no YAML de config.

### 7.3 Rodando localmente

```bash
git clone https://github.com/coleam00/Archon && cd Archon
bun install
claude                    # e então: "Set up Archon"
```

Ou, sem o wizard:

```bash
bun run dev               # todos os pacotes em watch
bun run dev:server        # só o servidor
bun run dev:web           # só o frontend (Vite na 5173, proxy /api → 3090)
bun run cli -- --help     # o CLI a partir do fonte
```

Instalação de binário (não requer o repo):

```bash
curl -fsSL https://archon.diy/install | bash    # macOS/Linux
irm https://archon.diy/install.ps1 | iex        # Windows
brew install coleam00/archon/archon             # Homebrew
```

Binários compilados **não empacotam o Claude Code** — exigem `CLAUDE_BIN_PATH` ou
`assistants.claude.claudeBinaryPath`.

### 7.4 Deploy

**Docker (compose da raiz).** Quatro serviços, três atrás de profiles:

| Serviço | Profile | Imagem |
|---|---|---|
| `app` | (sempre) | `build: .` |
| `postgres` | `with-db` | `postgres:17-alpine` |
| `caddy` | `cloud` | `caddy:2-alpine` (portas 80, 443/tcp e **443/udp** para HTTP/3) |
| `auth-service` | `auth` | `build: ./auth-service` (só `expose`, sem porta no host) |

O `Dockerfile` é multi-stage em três estágios sobre `oven/bun:1.4.0-slim`. Instala
`gh`, `ripgrep`, `jq` (esperados por Claude Code/Codex), `chromium` + `agent-browser`
(E2E), `gosu` e `postgresql-client`. Cria `appuser` UID 1001 porque *"Claude Code recusa
rodar com `--dangerously-skip-permissions` como root"*.

Dois detalhes de performance documentados: `bun install --linker=hoisted` (o linker
"isolated" default coloca pacotes em `node_modules/.bun/` com symlinks que Vite/Rollup não
resolvem), e a ausência de `RUN chown -R /app` final, que duplicaria todo inode numa nova
camada (#1970).

**VPS.** `deploy/cloud-init.yml` é um `#cloud-config` para colar no campo "User Data" do
provedor. Faz swapfile de 2 GB (VPS com <2 GB sofre OOM no `docker build`), Docker, UFW
(22/80/443 tcp + 443/udp), clone, e `docker compose build`. Escolha de segurança explícita:
o usuário `archon` está no grupo `docker` mas **não tem sudo**.

`deploy/docker-compose.yml` é a versão "end user", com imagem pré-construída
(`ghcr.io/coleam00/archon:latest`), sem build, sem Caddy.

**Reverse proxy.** `Caddyfile.example` — TLS automático, `/webhooks/*` e `/api/health`
sempre públicos, duas opções de auth (form via `auth-service` ou basic auth), e SSE tratado
explicitamente: `@sse path /api/stream/*` com `flush_interval -1`.

### 7.5 Onde ficam os dados

```
~/.archon/                                  # ARCHON_HOME (ou /.archon no Docker)
├── workspaces/<project>/                   # <project> ∈ {owner/repo, _local/<base>,
│   │                                       #              _folder/<slug>, _cwd/<base>}
│   ├── source/                             # clone ou symlink → path local
│   ├── worktrees/                          # git worktrees do projeto
│   ├── artifacts/runs/{run-id}/            # artefatos (NUNCA no git)
│   ├── logs/{run-id}.jsonl
│   └── state/                              # $STATE_DIR — estado entre runs
├── temp/                                   # scratch efêmero (dry-run)
├── archon.db                               # SQLite default
├── credential-key                          # chave AES (0600)
├── telemetry-id
├── config.yaml
├── .env
└── web-dist/<version>/                     # UI baixada por `archon serve`
```

Vale registrar um bug histórico interessante consertado aqui (#2200): antes, o caso `'cwd'`
escrevia em `<cwd>/.archon/`, dentro do repo do usuário — onde o teardown do worktree
destruía os artefatos e o `git status` os mostrava.

### 7.6 Observabilidade

**Logs.** pino, com `pino-pretty` como *destination stream* (não worker-thread transport,
porque o transport faz `require.resolve('pino-pretty')`, que crasha no filesystem virtual
`/$bunfs/` de binários Bun). Pretty só quando `stdout.isTTY && NODE_ENV !== 'production'`.
Nível `'silent'` é usado pelo CLI em `--json`.

**Health.** `GET /api/health`, `/health`, `/health/db`, `/health/concurrency`.

**Eventos.** Timeline durável em `remote_agent_workflow_events`; SSE ao vivo em
`/api/stream/:conversationId` e `/api/stream/__dashboard__`.

**Diagnóstico.** `archon doctor` roda 13 checks em `Promise.allSettled` (uma rejeição não
pula os demais): binários dos providers, `gh auth`, banco, folder project, credenciais
conectadas, workspace gravável, defaults embutidos, telemetria, Slack, Telegram. Cada check
usa o **mesmo resolver do runtime** (`resolveClaudeBinaryWithSource`) e reporta o *tier*
de resolução (env / config / autodetect).

**Analítica de workflow.** `scripts/lens-yield.ts` agrega os `review/findings.json` que o
workflow `archon-review` escreve, tabulando por "lens" quantos achados contribuiu e quantos
foram **exclusivamente** seus (`sole`) — a métrica que, segundo o script, aposentou a lens
de comentários.

---

## 8. Testes e qualidade

### 8.1 A estratégia de testes

Não há framework externo — é `bun test`. Mas a organização é incomum e vale entender:
**cada pacote lista seus arquivos de teste explicitamente no script `test`**, em grupos
separados por `&&`. Exemplo (abreviado) de `packages/core/package.json`:

```json
"test": "bun test src/handlers/command-handler.test.ts && bun test src/handlers/clone.test.ts && ..."
```

A razão está no `AGENTS.md`: *"Bun's module mocks pollute the process cache. Use the package
test scripts that preserve isolation; do not run `bun test` from the repository root."*
Cada grupo é um processo separado, isolando os mocks.

Regras de teste declaradas e enforçadas:

- Remover árvores temporárias com `removeTempTree` / `trackTempRoots` de
  `@archon/paths/test-utils` — **verificado por AST** em `scripts/check-test-cleanup-drift.ts`,
  que roda como primeira etapa de `bun run lint`
- Spawnar subprocesso só quando o subprocesso é o sujeito do teste
- Para suprimir uma env key herdada num filho Bun, passar `''` — deletar permite que o
  `.env` a restaure

### 8.2 Tipos de teste presentes

| Tipo | Exemplo |
|---|---|
| Unitário | a maioria dos `*.test.ts` |
| Integração com DB | `packages/core/src/db/*.integration.test.ts` |
| Integração de processo | `packages/cli/src/utils/detached-run-control.integration.spec.ts` |
| **Conformidade cross-package** | `scripts/node-ref-parity.test.ts` |
| **Trava de costura (seam lock)** | `packages/cli/src/default-cwd-canonicalization.test.ts` |
| **Fixtures declarativas de workflow** | `.archon/workflows/*/fixtures/*.stubs.yaml` |
| Adversarial de shell | `packages/isolation/src/container/overlay-scripts.test.ts` (roda os scripts reais sob `bash -c` contra um tmpdir adversarial) |
| Guarda de rede | `packages/adapters/src/test/no-network.ts` |

O **seam lock** merece explicação porque é um padrão pouco comum. `default-cwd-canonicalization.test.ts`
lê **quatro arquivos-produto como texto** e exige que cada um (a) contenha
`canonicalizeProjectPath` importado de `@archon/paths` e (b) **não** contenha nenhum
`realpath` próprio. O motivo (#2927): `default_cwd` é comparado por igualdade exata de
string, e havia dois canonicalizadores — `fs/promises.realpath` e `fs.realpathSync`. No
Windows eles discordam sobre nomes 8.3 (`RUNNER~1` vs `runneradmin`), então todo folder
project registrado pela CLI virava invisível. Um teste comportamental não pega isso em
macOS/Linux, onde as variantes concordam. Daí a trava textual.

### 8.3 O alvo `validate`

```bash
bun run validate
```

Expande para, em ordem:

```
check:bundled → check:bundled-skill → check:bundled-schema → check:pi-vendor-map
→ check:capability-matrix → check:api-types → type-check → lint --max-warnings 0
→ format:check → test:install → test
```

O `AGENTS.md` exige rodá-lo antes de abrir PR.

### 8.4 CI — `.github/workflows/`

| Arquivo | Propósito |
|---|---|
| `test.yml` | Suíte principal: gate de mudanças, matriz OS, checks de gerados, lint/types/format, upgrade de schema PG, paridade PG, build+smoke Docker |
| `release.yml` | Empacota a Web UI, compila 5 binários, smoke-tests, cria a Release, atualiza a fórmula Homebrew |
| `publish.yml` | Build e push multi-arch para GHCR, com provenance e SBOM |
| `deploy-docs.yml` | Build Astro + GitHub Pages |
| `docs-build.yml` | Mesmo build em PR, para a quebra aparecer antes do release |
| `e2e-smoke.yml` | Smokes end-to-end em tiers (determinístico, container, Claude, Codex, mixed) |
| `marketplace-lint.yml` | Valida entradas do marketplace |
| `marketplace-auto-review.yml` | Roda o **próprio Archon** para revisar e mergear PRs de marketplace |

Seis jobs em `test.yml`, com decisões documentadas:

**`changes`** — `scripts/should-run-test-suite.ts` decide se a suíte roda. Diferencia
`BUILD_INPUTS` (`.archon/commands/`, `.claude/skills/` — parecem docs mas são entradas de
build) de `INERT_PATHS` (`.gitignore`, `LICENSE`, `assets/`). Há um comentário sobre
atribuir antes de ecoar: `echo "run-tests=$(...)"` não dispara `set -e` se o comando falhar,
e escreveria uma decisão vazia que todo gate downstream leria como "skip".

**`test`** — matriz `[ubuntu-latest, windows-latest]`, `fail-fast: false` com comentário
explícito: com fail-fast, uma falha no ubuntu cancela o windows e uma quebra só-Windows fica
invisível.

**`schema-upgrade`** — aplica `000_combined.sql` sobre bancos criados por **releases
antigas** (baselines = tags reais). O comentário justifica a existência do job: nada mais no
CI aplica o SQL num banco real, e `CREATE TABLE IF NOT EXISTS` é no-op em banco existente —
foi assim que a #2508 passou verde e depois entrou em crash-loop em toda instalação
Postgres pré-existente. O checker é comprovadamente com dentes: com v0.7.0 como baseline, o
schema da v0.8.0 reproduz a #2508 (exit 3, `column "event_order" does not exist`).

**`postgres-parity`** — roda **um único teste** contra Postgres real, porque a suíte
unitária mocka o driver `pg` e o ramo do dialeto Postgres de `getLiveRunOwningEnv` só
executa contra servidor real.

**`docker-build`** — libera ~14 GB no runner antes (`rm -rf /usr/share/dotnet
/usr/local/lib/android ...`), builda, sobe o container e faz `curl --fail --retry 10` em
`/api/health`.

**`test-suite`** — job agregador (`if: always()`) que existe para ser o *required check*.

Um comentário no `test.yml` merece citação como exemplo de rigor: documenta que **não**
existe passo de exclusão do Windows Defender, porque a hipótese sobre os travamentos de
`downloadWebDist` (#2924) foi **testada e refutada** — a imagem do runner já exclui `C:\` e
`D:\`, e `Add-MpPreference` custava 5 s por run sem efeito.

### 8.5 Lint e formatação

`eslint.config.mjs` usa `recommendedTypeChecked` + `strictTypeChecked` +
`stylisticTypeChecked`. Regras endurecidas: `explicit-function-return-type`,
`no-explicit-any`, `no-non-null-assertion`, `naming-convention`. Regras desligadas têm
justificativa por bloco.

`scripts/lint.ts` roda **um processo de ESLint por pacote**, porque, como diz o
`AGENTS.md`, o lint tipado estoura o orçamento de memória se rodado de uma vez.

`.husky/pre-commit` roda `lint-staged` (eslint --fix + prettier) e, condicionalmente,
regenera os bundled defaults.

---

## 9. Pontos fortes, riscos e oportunidades

### 9.1 O que está muito bem feito

**1. A separação source/target.** O mecanismo de `packages/workflows/src/workflow-source.ts`
transforma "de onde vêm os bytes executáveis" numa propriedade **possuída pelo run e
imutável**. É o que permite simultaneamente (a) o worktree ficar limpo, (b) um run pausado
retomar através de um upgrade do binário do Archon, e (c) fixtures provarem coisas sobre a
captura real. É o tipo de invariante que só aparece depois de várias iterações dolorosas.

**2. Injeção de contratos sem adapters.** `IWorkflowStore`, `IWorkflowPlatform`,
`ChildIsolationResolver`, `ContainerWriteBackBackend` são satisfeitos **estruturalmente**
por implementações em `@archon/core` e `@archon/isolation`, sem wrappers. O motor não
importa banco nem adapters. É tipagem estrutural do TypeScript usada da forma certa.

**3. Comentários que documentam evidência, não intenção.** Recorrente e raro. Exemplos:
o bloco em `dag-node.ts:363-394` explicando por que `executeBashNode`/`executeScriptNode`
permanecem separados apesar do colapso de tipo — inclusive nomeando dois bugs reais
encontrados durante a leitura comparativa e *filed separadamente* em vez de servirem de
argumento para o merge. Ou o comentário do `event_order` no SQL, que registra a verificação
empírica ("relfilenode changes no postgres:18").

**4. Documentação de ausência de sinal.** Os ~50 tipos de evento em `WORKFLOW_EVENT_TYPES`
documentam **o que a ausência de cada evento não significa**. Isso é essencial para quem
reconstrói estado a partir de log, e quase nunca é escrito.

**5. Derivação e prova em vez de sincronização manual.** Constantes derivadas de schemas,
provas de cobertura por tipo (`AssertNever`), e testes de paridade que executam ambos os
lados quando a derivação é impossível.

**6. O `SECURITY.md` do container.** É honesto sobre o que o mecanismo **não** garante
(modo `native` permite remount por root) em vez de vender isolamento que não existe. Declara
um "review gate" explícito para mudanças em estratégia de mount, capabilities ou nos scripts
de diff/apply.

**7. A constituição da linguagem.** `.archon/workflow-language-constitution.md` é o
documento mais valioso do repositório. Estabelece um teste de admissibilidade aplicável, e
a "regra de independência" já produziu uma rejeição concreta e correta (`join:
'first_success'`).

**8. Rigor de plataforma cruzada.** Os workarounds de Windows são numerosos e todos
justificados por evidência: `resolveBashPath` (CreateProcess busca System32 antes do PATH,
resolvendo `bash` para o launcher do WSL), `child_process.spawn` em vez de `Bun.spawn` para
detach, `taskkill /T /F` com confirmação por polling, retry manual em `removeTempTree`
porque o Bun **aceita e ignora** `maxRetries` do `rm`.

### 9.2 O que parece frágil

**1. `dag-executor.ts` tem 554 KB (~11.500 linhas).** É onde mora quase toda a semântica de
execução: scheduling, resume, sessões, gates, loops, fan-out, sub-runs, containers. Mesmo
sendo bem comentado, é um arquivo que ninguém consegue segurar inteiro na cabeça. A superfície
de teste é grande (`subrun.test.ts` sozinho tem 223 KB), o que sugere que a equipe sabe disso
— mas o custo de onboarding e de mudança nesse arquivo só cresce.

**2. Duas UIs completas coexistindo.** `packages/web/src/components/workflows/` e
`packages/web/src/experiments/console/builder/` são dois builders independentes: dois
modelos de nó (3 kinds vs 8 variantes), duas rotinas de layout dagre, duas validações. É
duplicação assumida por uma janela de depreciação, mas é a maior fonte de peso do pacote web
hoje, e o console já é a UI default.

**3. Cópias de gramática entre pacotes.** `packages/web/src/lib/node-ref.ts` e
`experiments/console/builder/validation/when-grammar.ts` são cópias deliberadas do engine,
provadas por `scripts/node-ref-parity.test.ts`. O teste é excelente — mas o histórico
registrado no próprio arquivo (#2567, #2570, #2579, #2591) mostra que a cópia **driftou
quatro vezes**, e cada drift produziu um bug de validação silencioso. O teste é a rede, não
a cura.

**4. `packages/server/src/routes/api.ts` tem 5.090 linhas** numa única função exportada
(`registerApiRoutes`), com todas as rotas, helpers e closures dentro dela. Funciona, mas é
o oposto do resto do repositório em termos de granularidade.

**5. Classificação de erro por substring do git.** `packages/isolation/src/providers/
worktree.ts` classifica stderr do git em vários pontos (`already exists`, `checked out at`,
`not found`). O `AGENTS.md` trata isso como último recurso, e aqui não há canal estruturado
alternativo — mas uma mudança de mensagem do git muda comportamento silenciosamente.

**6. O protocolo textual `/invoke-workflow`.** Reconstruir intenção com regex é exatamente
o que o `AGENTS.md` proíbe. O `manage_run` é a versão correta, mas só cobre providers com
`nativeTools` **e** chats com projeto escopado. Para Codex, OpenCode e Copilot, o único
canal de *iniciar* um workflow continua sendo o protocolo textual — com um
`normalizeCommandText()` que precisa remover markdown em negrito porque modelos Pi às vezes
emitem `**/invoke-workflow ...**`.

**7. Pares "hand-synced" reconhecidos.** `AgentCredentialStatus` e
`AgentCredentialMatrixEntry` em `packages/core/src/credentials/catalog.ts` estão anotados
como sincronizados à mão com os schemas de rota do servidor — exatamente o que o próprio
`AGENTS.md` classifica como "defeito presente".

**8. Drift na documentação de superfície de comando.** Verificado em três lugares:
o texto de subcomandos desconhecidos em `packages/cli/src/cli.ts:1080` omite `respond`,
`test` e `reset-sessions`, que existem e funcionam; `--container` é parseado e propagado mas
não aparece no `printUsage()`; e o `/help` do command-handler não lista `respond`.

**9. Colisão de `stateRoot`.** `packages/paths/src/archon-paths.ts` documenta honestamente
que dois repositórios locais chamados `api` compartilham um `state/` sob `_local/api`. Para
`artifacts` e `logs` a colisão é benigna (chaveados por run id); para `stateRoot`, não é.

**10. Escritas não-atômicas em prefs.** `setUserTiers` / `setUserAliases`
(`packages/core/src/db/user-ai-prefs-store.ts`) são read-modify-write não-atômicos,
last-write-wins. Documentado como limitação aceita.

### 9.3 Dívidas técnicas explícitas

O projeto é notavelmente honesto sobre suas dívidas. As que encontrei marcadas no código:

- **Plumbing residual em `IsolationResolver`**: `IsolationResolverDeps.cleanup` e
  `staleThresholdDays` são injetados pelo orchestrator mas **não são consumidos**; o campo
  `ResolutionMethod.created.autoCleanedCount` nunca é preenchido. A lógica migrou para
  `cleanup-service.ts` sem remover a costura.
- **`IIsolationStore.countActiveByCodebase`** está no contrato do pacote isolation mas é
  chamado só pelo `command-handler` do core.
- **Padrões 1+N declarados**: `listDecryptedUserProviderCredentials` (TODO #1891) e
  `listEnvironments`.
- **Teto de fan-out**: `max_parallel` limita concorrência, não a contagem total de filhos.
  Uma lista muito grande (≳ `MAX_CASCADE_RUNS = 500`) pode deixar filhos não-cancelados
  quando o pai é abandonado. Adiado para #1961.
- **`streamingMode: 'stream'` do `CLIAdapter`** é aceito e testado, mas nenhum call site de
  produção o usa.
- **Sem alvo Windows em `scripts/build-binaries.sh`** (embora `release.yml` compile
  `bun-windows-x64` e o código trate Windows extensivamente).
- **`uv` não está na imagem Docker principal**, só na imagem de runner de isolamento e no
  CI. Nós `script:` com `runtime: uv` não teriam `uv` disponível na imagem principal. Não
  encontrei nada que indique se é intencional.

### 9.4 Discrepâncias entre documentação e código

Registro aqui porque afetam quem lê o README primeiro:

| Afirmação | Realidade no código |
|---|---|
| README: *"Archon ships 19 default workflows"* | `BUNDLED_WORKFLOWS` tem **31** entradas (mais 54 comandos, 10 scripts) |
| README: tabela de 19 workflows nomeados | Os 21 flat estão em `.archon/workflows/defaults/legacy/` (só `archon-assist` fora de `legacy/`); os 10 novos são o pack `sdlc/` (`archon-plan`, `archon-implement`, `archon-review`, `archon-deliver`, `archon-ship`, `archon-triage`, `archon-investigate`, `archon-validate`, `archon-pr`, `archon-upkeep`) |
| Console README: *"Not part of the shipped product"* | `App.tsx` redireciona `/` para `/console` |

Nenhuma dessas é grave, mas a primeira significa que a lista de workflows do README está
uma geração atrasada em relação ao que o produto entrega.

### 9.5 Oportunidades de melhoria

Ordenadas pelo que me parece maior retorno sobre esforço:

**1. Fatiar `dag-executor.ts`.** As fronteiras já existem semanticamente e estão nomeadas
nas funções (`executeApprovalNode`, `executeLoopGroupNode`, `executeFanOutWorkflowNode`,
`executeWorkflowNode`, `runLayers`). Extrair cada executor de nó para seu módulo, mantendo
`runLayers` e o contexto compartilhado no arquivo central, reduziria a maior barreira de
entrada do projeto sem mudar comportamento.

**2. Completar a remoção da UI legacy.** O `.archon/direction.md` já decidiu; o custo é
carregado a cada mudança no web. Cerca de metade das 52 mil linhas de `packages/web` são
duplicação em janela de depreciação.

**3. Gerar as cópias de gramática em vez de prová-las.** Um script dono que emitisse
`packages/web/src/lib/node-ref.ts` e `when-grammar.ts` a partir dos módulos do engine,
com `--check` no CI, converteria quatro drifts históricos numa impossibilidade estrutural.
O padrão já existe no repositório (`generate-bundled-schema.ts` faz exatamente isso com o
SQL) e o `AGENTS.md` prefere derivação a verificação.

**4. Estender `manage_run` para providers sem `nativeTools`.** O protocolo textual
`/invoke-workflow` é a única violação estrutural da própria regra "natural language is not a
wire format". Uma alternativa seria exigir saída estruturada (`output_format`) do turno do
orquestrador nesses providers — todos os cinco suportam saída estruturada, mesmo que
`best-effort`.

**5. Fatiar `api.ts`.** 5.090 linhas numa função. As rotas já estão agrupadas por domínio;
extrair `registerWorkflowRoutes`, `registerConversationRoutes`, etc., seria mecânico.

**6. Fechar os pares hand-synced restantes.** `AgentCredentialStatus` /
`AgentCredentialMatrixEntry` são os que o próprio código marca. Derivar o schema de rota do
tipo do core (ou vice-versa) elimina o último caso reconhecido.

**7. Resolver a colisão de `stateRoot`.** Incluir um hash curto do path canônico no slug de
`_local/<basename>` tornaria as chaves distintas sem quebrar as existentes (o layout já é
`_local/`, então uma nova convenção pode coexistir).

**8. Sincronizar o README com o pack `sdlc`.** A tabela de workflows e a contagem estão
desatualizadas.

---

## 10. Referências rápidas

### 10.1 Governança e direção

| Arquivo | Por que importa |
|---|---|
| `AGENTS.md` | Guia canônico do projeto para agentes. Regras de julgamento, fronteiras de produto, taste de engenharia |
| `.archon/direction.md` | Direção de produto. Cláusulas citáveis em triagem de PR (`direction.md §single-tenant-per-install`) |
| `.archon/workflow-language-constitution.md` | A regra "YAML coordinates, code computes, agents judge" e o teste de admissibilidade |
| `.archon/engineering.md` | Valores de craft e revisão |
| `CONTRIBUTING.md` | Fluxo de contribuição (branch de `dev`, PR para `dev`) |

### 10.2 O motor de workflows

| Arquivo | Por que importa |
|---|---|
| `packages/workflows/src/dag-executor.ts` | **O núcleo.** 554 KB. Toda a semântica de execução |
| `packages/workflows/src/executor.ts` | Fronteira externa: resolve paths, captura fonte, cria/retoma o run |
| `packages/workflows/src/schemas/dag-node.ts` | A gramática de nó. 9 variantes, mutuamente exclusivas |
| `packages/workflows/src/schemas/workflow.ts` | Campos de topo do YAML; `KNOWN_WORKFLOW_KEYS` derivado |
| `packages/workflows/src/schemas/loop.ts` | Os três canais de conclusão de loop e por que a regra é dupla |
| `packages/workflows/src/workflow-source.ts` | **Captura congelada da fonte.** O mecanismo mais subestimado |
| `packages/workflows/src/output-ref.ts` | Gramática única de `$node.output`; a tabela de resolução de campo |
| `packages/workflows/src/when-atom.ts` | Parser único de átomo `when:` (loader + evaluator) |
| `packages/workflows/src/condition-evaluator.ts` | Os dois modos de erro: fail-closed vs. throw |
| `packages/workflows/src/deps.ts` | `WorkflowDeps` — o ponto único de injeção |
| `packages/workflows/src/store.ts` | `IWorkflowStore` e os ~50 tipos de evento documentados |
| `packages/workflows/src/include-expander.ts` | Inlining determinístico de `include:`; delimitador `__` |
| `packages/workflows/src/fan-out-identity.ts` | Identidade content-addressed por item |
| `packages/workflows/src/fixture-runner.ts` | Testes declarativos de workflow |
| `packages/workflows/src/terminal-status-write.ts` | Por que uma falha de escrita terminal é uma classe própria |

### 10.3 Orquestração e persistência

| Arquivo | Por que importa |
|---|---|
| `packages/core/src/orchestrator/orchestrator-agent.ts` | `handleMessage` — a entrada única de todas as plataformas |
| `packages/core/src/orchestrator/orchestrator.ts` | Dispatch de workflow, resolução de isolamento |
| `packages/core/src/orchestrator/manage-run-tool.ts` | A ferramenta nativa `manage_run`, com escopo por projeto |
| `packages/core/src/handlers/command-handler.ts` | Slash commands determinísticos |
| `packages/core/src/db/workflows.ts` | CAS de gate, path lock, resume. 2.145 linhas |
| `packages/core/src/db/adapters/sqlite.ts` | Tradução de dialeto, `migrateColumns`, PRAGMAs |
| `packages/core/src/db/adapters/postgres.ts` | Advisory locks no boot, trigger de NOTIFY, `listen()` |
| `packages/core/src/config/config-loader.ts` | Merge defaults → global → repo → env |
| `packages/core/src/config/run-config.ts` | Config por run: esparsa, estrita, selada |
| `packages/core/src/utils/token-crypto.ts` | AES-256-GCM e a política de chave |
| `packages/core/src/credentials/delivery.ts` | Mapa vendor → env vars / arquivos |
| `packages/core/src/operations/workflow-operations.ts` | approve/reject/respond/abandon compartilhados |
| `packages/core/src/services/cleanup-service.ts` | Limpeza de worktrees e containers |
| `packages/core/src/types/index.ts` | `IPlatformAdapter` e `IWebPlatformAdapter` |

### 10.4 Providers de IA

| Arquivo | Por que importa |
|---|---|
| `packages/providers/src/types.ts` | `IAgentProvider` (3 métodos), `MessageChunk`, `ProviderCapabilities` |
| `packages/providers/src/registry.ts` | Registro tipado dos 5 providers |
| `packages/providers/src/claude/provider.ts` | 1.604 linhas. Uso do Claude Agent SDK, retry, timeout do primeiro evento |
| `packages/providers/src/claude/container-spawn.ts` | `docker exec -i` com captura de PID e kill por grupo |
| `packages/providers/src/shared/structured-output.ts` | Ajv, parse em 3 tiers, normalização para OpenAI strict |
| `packages/providers/src/shared/effort.ts` | A escada única de effort; `clampEffort` desce primeiro |
| `packages/providers/src/community/pi/provider.ts` | O provider mais complexo; lazy loading justificado |
| `packages/providers/src/oauth.ts` | Ponte OAuth sobre o Pi, com loader profundo |

### 10.5 Isolamento

| Arquivo | Por que importa |
|---|---|
| `packages/isolation/src/types.ts` | `IIsolationProvider` vs. `IIsolationBackend` — os dois eixos |
| `packages/isolation/src/providers/worktree.ts` | 1.435 linhas. O mecanismo de worktree completo |
| `packages/isolation/src/resolver.ts` | A ordem de resolução: reuso, adoção, criação |
| `packages/isolation/src/backends/container.ts` | Overlayfs, fuse vs. native, write-back |
| `packages/isolation/src/container/overlay.ts` | Os scripts shell endurecidos de diff/apply |
| `packages/isolation/docker/SECURITY.md` | O que o container **não** garante |
| `packages/isolation/src/errors.ts` | `ERROR_PATTERNS`, a fonte única de classificação |

### 10.6 Servidor, adapters e CLI

| Arquivo | Por que importa |
|---|---|
| `packages/server/src/index.ts` | Boot: ordem de init, adapters, guardrails de segurança, shutdown |
| `packages/server/src/routes/api.ts` | Todas as rotas HTTP. 5.090 linhas |
| `packages/server/src/adapters/web/transport.ts` | `SSETransport`: buffer com replay, invariante de TTL |
| `packages/server/src/adapters/web/dashboard-event-poller.ts` | Como runs do CLI chegam ao browser |
| `packages/server/src/services/workflow-resume-service.ts` | Retomada headless e o scheduler de continuação |
| `packages/adapters/src/forge/github/adapter.ts` | Webhook → workflow, com dedup e anti-self-trigger |
| `packages/cli/src/cli.ts` | Parser (`parseArgs` nativo), roteamento, portões pré-dispatch |
| `packages/cli/src/commands/workflow.ts` | 5.302 linhas. O comando central; detach, container, marketplace |
| `packages/cli/src/utils/detached-run-control.ts` | IPC por socket/pipe com um run em andamento |
| `packages/cli/src/utils/stdout.ts` | Por que `console.log` não serve num pipe sob pino |
| `auth-service/server.js` | Sidecar de `forward_auth` (224 linhas, sem framework) |

### 10.7 Frontend

| Arquivo | Por que importa |
|---|---|
| `packages/web/src/App.tsx` | Revela a coexistência console/legacy |
| `packages/web/src/lib/api.ts` | Cliente fetch manual sobre tipos gerados; `SSE_BASE_URL` |
| `packages/web/src/hooks/useSSE.ts` | UI legacy: interpreta cada evento; batching de 50 ms |
| `packages/web/src/experiments/console/lib/sse.ts` | Console: SSE como gatilho de invalidação de cache |
| `packages/web/src/experiments/console/store/cache.ts` | Cache próprio sobre `useSyncExternalStore` |
| `packages/web/src/experiments/console/skills/index.ts` | A única superfície de mutação do console |
| `packages/web/src/experiments/console/builder/README.md` | Arquitetura em camadas do builder novo |
| `packages/web/src/lib/node-ref.ts` | Cópia deliberada da gramática de id de nó |

### 10.8 Build, CI e infraestrutura

| Arquivo | Por que importa |
|---|---|
| `package.json` | O alvo `validate` e todos os pares `generate:`/`check:` |
| `scripts/build-binaries.sh` | Reescreve `bundled-build.ts`, compila, restaura por trap |
| `scripts/node-ref-parity.test.ts` | Três mecanismos de prova de paridade cross-package |
| `scripts/check-schema-upgrades.ts` | Aplica o schema sobre bancos de releases antigas |
| `scripts/check-test-cleanup-drift.ts` | Análise de AST para regras de limpeza de teste |
| `scripts/generate-pi-vendor-map.ts` | Checagem de totalidade contra o SDK instalado |
| `.github/workflows/test.yml` | A suíte principal, com decisões documentadas |
| `.github/workflows/release.yml` | 5 binários, smoke-tests, Homebrew |
| `Dockerfile` | Multi-stage; `--linker=hoisted`; `appuser` UID 1001 |
| `docker-entrypoint.sh` | Ownership seletivo, `safe.directory`, pin de `CLAUDE_BIN_PATH` |
| `docker-compose.yml` | Quatro serviços, três profiles |
| `Caddyfile.example` | TLS, `forward_auth`, `flush_interval -1` para SSE |
| `deploy/cloud-init.yml` | VPS em um passo |
| `eslint.config.mjs` | Regras tipadas e o guard de isolamento do console |

### 10.9 Dados

| Arquivo | Por que importa |
|---|---|
| `migrations/000_combined.sql` | 717 linhas. O schema completo e idempotente, com o raciocínio nos comentários |
| `migrations/001_initial_schema.sql` … `023_*.sql` | A história incremental (nunca aplicados em runtime) |
| `packages/core/src/db/bundled-schema.ts` | Como o SQL chega num binário compilado |
| `packages/paths/src/archon-paths.ts` | O layout de `~/.archon/` e `ProjectStorageKey` |

---

## Notas sobre o alcance desta análise

O que foi lido em profundidade: `AGENTS.md`, `README.md`,
`.archon/{direction,workflow-language-constitution}.md`, todos os `package.json`, o schema
SQL completo, e as seções centrais de cada pacote (contratos, entradas, mecanismos citados
acima).

O que **não** foi lido linha a linha, e portanto pode conter detalhes não refletidos aqui:

- `packages/workflows/src/dag-executor.ts` na íntegra (554 KB) — foram lidos cabeçalhos,
  assinaturas e as seções de scheduling, resume, sessões, gates, loops e fan-out
- `packages/server/src/routes/api.ts` na íntegra (5.090 linhas) — foi lido o índice completo
  de rotas mais ~1.200 linhas de middlewares, auth, SSE e run/resume
- `packages/cli/src/commands/workflow.ts` na íntegra (5.302 linhas)
- Os arquivos `*.test.ts`, exceto onde o teste **é** a especificação
  (`default-cwd-canonicalization.test.ts`, `node-ref-parity.test.ts`)
- `packages/docs-web/` (o site de documentação) e o `CHANGELOG.md` (172 KB)

Os números de issue citados (#2565, #2747, #2200, etc.) são reproduzidos como o código os
escreve; o rastreador não foi consultado.
