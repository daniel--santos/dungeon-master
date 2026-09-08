# ADR 0001 — Autenticação dos harnesses no modo de execução DOCKER

- **Status**: aceito
- **Data**: 08/09/2026
- **Contexto**: Fase 2C do planejamento v0.4; seção 31 do documento de fundamentos
  ("não devemos resolver isso montando indiscriminadamente o home do usuário").
- **Decide**: se o modo `DOCKER` nasce **suportado**, **experimental** ou **bloqueado**,
  por harness.

## Resumo do veredito

| Harness         | Veredito         | Entrega da credencial                                | `dockerExecution` |
| --------------- | ---------------- | ---------------------------------------------------- | ----------------- |
| **Claude Code** | **suportado**    | `CLAUDE_CODE_OAUTH_TOKEN` (padrão) ou arquivo montado | `true`            |
| **Pi**          | **suportado**    | `GEMINI_API_KEY` (chave do provedor), variável        | `true`            |
| **Codex**       | **experimental** | só o arquivo `~/.codex/auth.json` montado             | `false`           |

Pelo menos um harness é suportado, então a Parte B da 2C foi implementada e o perfil
"Masmorra selada" nasce **habilitado**. O Codex fica de fora do modo `DOCKER` até o
caminho por variável ser provado; a razão está em `execution_profile.disabled_reason`
quando o perfil for desligado, e na matriz de capabilities de cada harness.

## O ambiente do experimento

Windows 11, Docker Desktop 29.7.2 (WSL2, containers Linux), imagem
`dungeon-master-agent:0.1.0` construída por `docker/agent.Dockerfile`, com
`claude` 2.1.263, `codex-cli` 0.147.0 e `pi` 0.85.1 — as mesmas versões do host. O
usuário do host tem **assinatura** (login OAuth), não chave de API:

```console
$ claude auth status
{ "loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty",
  "subscriptionType": "max", ... }
$ codex login status
Logged in using ChatGPT
$ pi auth check --provider google --json
{"status":"ready","provider":"google","authType":"api_key"}
```

Nenhum experimento leu o conteúdo de um arquivo de credencial. O que foi observado é
sempre o **comportamento** da CLI, nunca o segredo.

## 1. Claude Code

### Existe token de longa duração?

Existe. `claude setup-token` — "Set up a long-lived authentication token (requires
Claude subscription)" — emite um token OAuth de longa duração, e a CLI o lê da
variável `CLAUDE_CODE_OAUTH_TOKEN`. **É o mecanismo desenhado exatamente para este
caso**, e é também o que o Sandcastle recomenda no `.sandcastle/.env` gerado pelo
`init`.

Que a variável é consumida **dentro do container** está provado por diferença de erro.
Sem credencial nenhuma a CLI nem chega à rede:

```console
$ docker run --rm dungeon-master-agent:0.1.0 claude --print --output-format stream-json ...
"apiKeySource":"none"
"text":"Not logged in · Please run /login"
"error":"authentication_failed"
```

Com um `CLAUDE_CODE_OAUTH_TOKEN` sintético a CLI chega à API e é rejeitada por ela:

```console
$ docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN='sk-ant-oat01-FAKE…' dungeon-master-agent:0.1.0 …
"text":"Failed to authenticate. API Error: 401 OAuth access token is invalid."
```

"Not logged in" e "401 OAuth access token is invalid" são estados diferentes: o segundo
só existe se a variável tiver virado uma tentativa de autenticação. O token real não foi
emitido no spike, porque `claude setup-token` é um fluxo interativo de navegador e
emitir uma credencial de longa duração na conta de alguém não é decisão de um agente.

### Qual é o mínimo a entregar ao container?

Um arquivo, e não o home. Montar **somente** `~/.claude/.credentials.json` em
`/home/agent/.claude/.credentials.json`, read-only, basta para a assinatura funcionar
lá dentro — provado com chamada real à API:

```console
$ docker run --rm \
    -v "C:/Users/<user>/.claude/.credentials.json:/home/agent/.claude/.credentials.json:ro" \
    dungeon-master-agent:0.1.0 claude --print … "responda apenas: PONG"
"text":"PONG"
"subtype":"success"
```

Nada mais de `~/.claude` é necessário: nem `settings.json`, nem `.claude.json`, nem
`projects/`. A resposta à pergunta da seção 31 ("quais arquivos/token são realmente
necessários?") é, portanto: **um arquivo de 509 bytes, ou uma variável.**

### Como expira e como se renova

- **`CLAUDE_CODE_OAUTH_TOKEN`**: token de longa duração, sem renovação dentro do
  container. Vence, o Run falha com `401 OAuth access token is invalid`, e a correção é
  rodar `claude setup-token` de novo no host. Revogação: nas configurações da conta.
- **`.credentials.json`**: é a sessão OAuth viva do host, com prazo curto. Montado
  read-only, o container **não consegue** gravar um token renovado. Um Run que comece
  com a sessão perto de vencer falha no meio. Montar read-write resolveria a renovação e
  criaria dois problemas piores: o container passaria a poder corromper o login do host,
  e uma rotação de refresh token feita de dentro do container poderia deslogar o usuário.
  Por isso o arquivo é montado **sempre read-only**, e a documentação diz que a forma
  recomendada é o token de longa duração.

## 2. Codex

O caminho por arquivo funciona e está provado de ponta a ponta:

```console
$ docker run --rm -v "C:/Users/<user>/.codex/auth.json:/home/agent/.codex/auth.json:ro" …
$ codex login status
Logged in using ChatGPT           # exit 0
$ codex exec --json … "responda apenas: PONG"
{"type":"agent_message"} … PONG … {"type":"turn.completed"}
```

`codex login status` é, de quebra, um preflight de autenticação barato e não
interativo: sai `0` autenticado e `1` com "Not logged in".

O caminho por variável **não** foi provado. `codex login --with-access-token` lê um
token do stdin, e existe a variável correspondente: com um valor sintético a CLI
responde `Error checking login status: invalid agent identity JWT format`, o que mostra
que ela é consumida e parseada como JWT. Um access token, porém, é curto e não se
renova sozinho dentro do container; e não havia como testá-lo com um valor real sem ler
o arquivo de credencial do usuário, coisa que este spike se recusou a fazer.

Sem caminho por variável provado, o Codex fica **experimental**: veja a seção 4, que é
onde essa distinção deixa de ser burocrática.

Um detalhe operacional registrado: sem credencial, `codex exec` **não falha rápido**.
Ele repete `failed to connect to websocket: HTTP error: 401 Unauthorized` em laço até o
timeout. É por isso que o preflight por `codex login status` importa: sem ele, um Run
mal autenticado queima o teto de ociosidade inteiro antes de morrer.

## 3. Pi

Chave de API do provedor, por variável, provado de ponta a ponta:

```console
$ docker run --rm dungeon-master-agent:0.1.0 pi auth check --provider google --json
{"status":"not_ready","provider":"google","reason":"credentials_not_configured"}   # exit 1

$ docker run --rm -e GEMINI_API_KEY=… dungeon-master-agent:0.1.0 pi auth check --provider google --json
{"status":"ready","provider":"google","authType":"api_key"}                        # exit 0
```

Montar `~/.pi/agent/auth.json` sozinho **não** autentica o provedor `google`: a
credencial vem mesmo da variável. `pi auth check --json` é o preflight não interativo.

## 4. Vazamento: o token chega ao stream?

**Chega, e isso não é hipótese.** Com um segredo entregue por variável e um agente
autorizado a rodar `printenv`, o valor aparece quatro vezes no stream de um único Run —
no `tool_result`, no texto do assistente e no `result` final:

```console
$ docker run --rm -e GH_TOKEN='ghp_SPIKEFAKE…' -v "…/.credentials.json:…:ro" \
    dungeon-master-agent:0.1.0 claude --print … --allowedTools "Bash(printenv:*)" \
    "Execute printenv GH_TOKEN e me responda com o valor exato"
…"type":"tool_result","content":"ghp_SPIKEFAKE…"
…"type":"text","text":"O comando imprimiu:\n\n```\nghp_SPIKEFAKE…"
…"result":"O comando imprimiu:\n\n```\nghp_SPIKEFAKE…"
```

Isso é inerente e não tem conserto por design de entrega: o agente **é** a árvore de
processos da CLI, logo tudo que a CLI consegue ler, o agente consegue ler. Arquivo com
permissão restrita não ajuda — no Windows o bind mount do Docker Desktop apresenta o
arquivo como `-rwxrwxrwx root root` dentro do container, independentemente da permissão
no host. Secret de `docker run` também não existe: `--secret` é do `docker build`.

O que **tem** conserto é o log. `sanitizeJson` de `@dungeon-master/events` roda em todo
payload antes de virar `run_event`, e apaga o **valor** das variáveis sensíveis. Rodado
contra o stream capturado acima:

```text
ocorrências antes  : 4
ocorrências depois : 0
```

O spike encontrou um buraco real e ele foi fechado: `SENSITIVE_ENV_VARS` não continha
nenhuma das variáveis de autenticação dos harnesses de agente — só as de git e as três
chaves de API. `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`, `CODEX_ACCESS_TOKEN` e
`CODEX_API_KEY` entraram na lista.

**A consequência que decide o desenho da entrega.** O sanitizador procura o **valor** da
variável no ambiente do worker. Um segredo entregue por variável é, portanto, redigível;
um segredo que só existe dentro de um arquivo montado **não é** — o worker nunca viu
aquela string, e se o agente der `cat` no arquivo, o token entra no log append-only e
fica. Isto inverte a intuição: a variável de ambiente, que parece mais exposta, é a
única forma que o log sabe defender.

Daí a ordem de preferência do backend, e daí o Codex ser experimental: ele é o único dos
três cujo único caminho provado é o arquivo.

## Decisão

1. **A entrega padrão é por variável de ambiente**, montada pela allow-list do
   `buildExecutionEnv` e injetada com `-e` no `docker run`. É a única forma que o
   sanitizador de credenciais consegue redigir.
2. **A entrega por arquivo montado read-only é o segundo caminho**, oferecida ao Claude
   Code e ao Codex, sempre um arquivo específico e nunca um diretório de home. Ela
   carrega o risco residual de log documentado acima e a interface diz isso.
3. **Nenhuma credencial entra na imagem.** `docker/agent.Dockerfile` é construível e
   publicável sem segredo nenhum.
4. **O container é a fronteira.** Como o agente lá dentro alcança tudo que estiver
   montado, o modo `DOCKER` monta **só** o worktree do Run e, quando for o caso, o
   arquivo de credencial — nunca o home, nunca o repositório inteiro.
5. **Preflight de autenticação por harness**, com o comando local não interativo de cada
   um (`claude auth status`, `codex login status`, `pi auth check --json`), para que um
   Run sem credencial falhe na partida em vez de queimar o timeout.

## Consequências

- O usuário de assinatura precisa rodar `claude setup-token` uma vez para ter o caminho
  recomendado. Sem isso, sobra o arquivo montado, que funciona e vem com o aviso.
- O Codex não aparece como opção no modo `DOCKER` (`dockerExecution: false`). Sair de
  experimental depende de provar `CODEX_ACCESS_TOKEN` com um token real e resolver a
  renovação dentro do container.
- O Antigravity (Fase 3D) herda este ADR: o gate dele é o mesmo, e a pergunta que decide
  continua sendo "existe token não interativo que o sanitizador saiba redigir?".
