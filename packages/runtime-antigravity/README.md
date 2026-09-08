# `@dungeon-master/runtime-antigravity`

O adapter do **Antigravity CLI** (`agy`) implementando `HarnessAdapter`.

Pacote separado de `runtime-sandcastle` porque o Antigravity não é um provider
do Sandcastle: é uma CLI que o projeto fala direto, com `node:child_process`
(planejamento v0.4, **Fase 3B**). O que os dois pacotes compartilham é a base de
adapter de CLI — achar o executável sem shell, cachear o preflight, montar o
comando —, e é por isso que este importa daquele em vez de copiar.

```text
HarnessAdapter
├── runtime-sandcastle   Claude Code · Codex · Pi
└── runtime-antigravity  Antigravity          ← aqui
```

---

## Contrato da CLI 1.1.27

Tudo abaixo foi **medido** contra `agy` 1.1.27 no Windows 11, em 07/09/2026, com
prompts mínimos. Onde há saída, ela é a saída real, encurtada só nos lugares
marcados com `…`. Este é o material da **Fase 3A**.

### Versão

```console
$ agy --version
1.1.27
```

### O que existe no argv

`agy --help` lista, entre outras: `--print`/`-p`, `--prompt`, `--output-format`
(`text`, `json`, `stream-json`), `--input-format` (`text`, `stream-json`),
`--json-schema`, `--conversation`, `--continue`/`-c`, `--model`, `--agent`,
`--effort` (`low|medium|high`), `--mode` (`accept-edits`, `plan`), `--add-dir`,
`--sandbox`, `--print-timeout` (padrão `5m0s`), `--disable-slash-commands`,
`--dangerously-skip-permissions`, `--log-file`, `--project`, `--new-project`.

O que **não** existe: nenhuma flag de permissão além de
`--dangerously-skip-permissions`. Confirmado por tentativa — o parser de flags é
o do Go e recusa o que não conhece:

```console
$ agy --permission-mode=strict -p="oi"
flags provided but not defined: -permission-mode
```

O mesmo para `--tool-permission`, `--allowed-tools`, `--settings` e
`--config-dir`.

### `-p` toma o prompt como valor da flag, e o stdin de texto não funciona

Esta é a diferença mais consequente em relação às outras três CLIs:

```console
$ echo "responda só OK" | agy -p --output-format stream-json
Error: -p took "--output-format" as its prompt, so the intended prompt was left
as an argument and ignored.
Attach the prompt to the flag (-p='your prompt') and move --output-format
elsewhere on the command line.
```

```console
$ echo "responda só OK" | agy --output-format stream-json -p=
{"event":"result","result":{"conversation_id":"","status":"ERROR","response":"",
"error":"Error: empty prompt. Usage: agy --print \"your prompt here\"",…}}
```

Mandar o prompt pelo argv esbarraria no teto de 32767 caracteres da linha de
comando do Windows. A saída é `--input-format stream-json`, que **lê o prompt do
stdin** como NDJSON. O formato foi descoberto por eliminação, guiado pelas
mensagens de erro da própria CLI:

```console
$ printf '{"event":"user_input","user_input":{"text":"…"}}\n' | agy -p= --input-format stream-json --output-format stream-json
warning: ignoring unsupported stream input message event "user_input"

$ printf '{"event":"user","user":{"text":"…"}}\n' | …
…"error":"stream input \"user\" message is missing the \"message\" field"…

$ printf '{"event":"user","message":{"text":"…"}}\n' | …
…"error":"stream input \"user\" message has no content"…

$ printf '{"event":"user","message":{"role":"user","content":[{"type":"text","text":"Responda apenas OK"}]}}\n' \
    | agy -p= --input-format stream-json --output-format stream-json
{"event":"result","result":{…,"status":"SUCCESS","response":"OK\n",…}}
```

**É esse o formato que o adapter usa.** Uma linha é um turno; a sessão contínua
(várias linhas, vários turnos no mesmo processo) fica para depois, e é por isso
que `multiTurnProcess` está `false` na matriz.

### `--add-dir` não é opcional

Sem ele o agente **não trata o diretório de trabalho como workspace** e escreve
os arquivos em `~/.gemini/antigravity-cli/scratch`, mesmo com o `init` relatando
o `cwd` certo:

```console
$ cd /repo && agy --output-format stream-json -p="Crie um arquivo OLA.md…"
…"tool_name":"write_to_file","tool_info":{"parameters":{"TargetFile":
  "C:\\Users\\…\\.gemini\\antigravity-cli\\scratch\\OLA.md"}}…
```

Com `--add-dir <cwd>` o arquivo aparece no repositório. O adapter sempre o passa.

### Os eventos NDJSON

O dialeto tem **três** eventos. Uma execução completa, com prompt mínimo:

```console
$ agy --output-format stream-json -p="Responda apenas: OK"
{"event":"init","conversation_id":"68daf2ab-0953-4a78-bb33-72520efee0e7","init":{"cwd":"…","tools":["ask_permission",…,"write_to_file"],"permission_mode":"request-review"}}
{"event":"step_update","step_update":{"conversation_id":"68daf2ab…","step_index":0,"state":"DONE","step_type":"user_input"}}
{"event":"step_update","step_update":{"conversation_id":"68daf2ab…","step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"OK\n","duration_seconds":1.407,"usage":{"input_tokens":9344,"output_tokens":34,"thinking_tokens":33,"cache_read_tokens":8143,"total_tokens":9378}}}
{"event":"result","result":{"conversation_id":"68daf2ab…","status":"SUCCESS","response":"OK\n","duration_seconds":1.655,"num_turns":1,"usage":{…}}}
```

| Evento        | Quando                     | O que carrega                                                                                                       |
| ------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `init`        | uma vez, antes de tudo     | **`conversation_id`**, `cwd`, lista de `tools`, `permission_mode`                                                   |
| `step_update` | uma por transição de passo | `step_index`, `state` (`ACTIVE`/`DONE`/`ERROR`), `step_type`, e o que o tipo trouxer                                |
| `result`      | uma, no fim                | `status`, `response`, `usage` somado, e opcionalmente `error`, `structured_output`, `json_schema`, `denied_actions` |

`step_type` observados: `user_input` (eco da entrada), `agent_response` (texto,
em `text_delta`, também presente no passo `DONE`), `tool` (chamada e retorno de
ferramenta) e `finish`.

**Onde está o id de conversa:** no `conversation_id` do `init`, repetido em todo
`step_update` e no `result`. O adapter o lê do `init`, que é a primeira linha —
o que permite retomar um Run cancelado no meio.

Um passo de ferramenta bem-sucedido, ida e volta:

```console
{"event":"step_update","step_update":{…,"step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"git --version"}}}}
{"event":"step_update","step_update":{…,"step_index":2,"state":"DONE","step_type":"tool","tool_name":"run_command","duration_seconds":0.277,"tool_info":{"name":"run_command","parameters":{"CommandLine":"git --version"},"output":"git version 2.45.1.windows.1\n"}}}
```

Não há id de chamada de ferramenta no stream. O adapter usa `step-<step_index>`
como id de correlação; o índice é único dentro de uma conversa, que é o escopo de
um Run.

`usage` aparece **por passo** e somado no `result`. `thinking_tokens` não tem
campo no nosso `UsageSummary` e é somado aos tokens de saída, porque é cobrado
como saída.

### Permissões: o achado que decide o desenho

A CLI **tem** allow-list. Ela mora em `~/.gemini/antigravity-cli/settings.json`,
na chave `permissions`, com regras no formato `ação(alvo)`:

```json
{
  "permissions": {
    "allow": ["command(git)", "write_file(*)", "read_file(*)"],
    "deny": ["command(rm)"],
    "ask": []
  }
}
```

Que ela é lida, o log da própria CLI confirma:

```console
$ agy --log-file p.log -p="oi" ; grep "settings initialized" p.log
… cli_setting_manager.go:92] CLI settings initialized:
  permissions=&{Allow:[command(git)] Deny:[] Ask:[]}, toolPermission=request-review
```

**E mesmo assim, em modo headless, nenhum comando passa.** Com as três regras
acima carregadas, `write_to_file` é autorizado e `run_command` é negado:

```console
$ agy --add-dir "$PWD" --output-format stream-json -p="Crie OLA.md … e rode 'git --version'…"
…"tool_name":"write_to_file","state":"DONE"…              ← autorizado
…"tool_name":"run_command","state":"ERROR","tool_info":{…,"error":{"type":"TOOL_ERROR",
  "message":"permission check failed for command \"git --version\": user denied
  permission to run command:\ngit --version"}}…
{"event":"result","result":{…,"status":"SUCCESS","response":"",…,
  "denied_actions":[{"action":"command","display_name":"RunCommand"}]}}
```

e no stderr:

```text
jetski: no output produced — a tool required the "command" permission that
headless mode cannot prompt for, so it was auto-denied. Add an allow-rule under
permissions.allow in settings.json (e.g. command(<target>)). Alternatively,
re-run with --dangerously-skip-permissions to auto-approve all tools.
```

A sugestão do stderr **não funciona para comando**: foi exatamente ela que o
teste acima seguiu. O changelog embutido no binário explica por quê — a versão
que passou a respeitar allow-list em modo padrão o fez só para `write_file`, e
outra versão corrigiu "comandos sendo auto-aprovados enquanto a sessão estava em
`request-review` ou `strict`".

Os quatro valores de `toolPermission` foram testados:

| `toolPermission`                   | Comando com `command(git)` na allow-list | Deny-list respeitada                               |
| ---------------------------------- | ---------------------------------------- | -------------------------------------------------- |
| `request-review` (padrão)          | negado                                   | —                                                  |
| `strict`                           | negado                                   | —                                                  |
| `proceed-in-sandbox` / `--sandbox` | negado                                   | —                                                  |
| `always-proceed`                   | **executa qualquer comando**             | **não** (`command(npm)` no deny rodou assim mesmo) |

Grants em `~/.gemini/config/config.json`
(`userSettings.globalPermissionGrants.allow`) e no arquivo de projeto
(`permissionGrants.permissionGrants.allow`) também são carregados — o log diz
`stored shared config permissions: allow=3` e `ApplyProjectPermissionGrants:
stored 3 allow` — e não mudam o resultado.

**Conclusão, e é ela que o adapter implementa:** o `agy` 1.1.27 tem exatamente
dois estados utilizáveis sem interface — _nenhum comando_ e _todos os comandos_.
Não há degrau de allow-list para traduzir.

| `PermissionMode` do domínio | O que vai no argv                | Efeito real                                      |
| --------------------------- | -------------------------------- | ------------------------------------------------ |
| `DEFAULT`                   | nada                             | padrão da CLI: todo comando negado               |
| `CONFIGURED`                | **nada**                         | idem — mais restritivo que o pedido, nunca menos |
| `BYPASS`                    | `--dangerously-skip-permissions` | todas as checagens desligadas                    |

`BYPASS` só chega ao adapter com isolamento imposto ou com `allowUnsafeBypass`
no `ExecutionProfile` (`resolvePermission`, em `@dungeon-master/runtime`); é a
mesma trava dos outros três. `nativePermissions` fica `false` na matriz, e o
Worker escreve no log do Run um aviso com texto próprio para este harness:
acrescentar prefixos em `allowedCommands` aqui não tem efeito nenhum.

### Structured output nativo

`--json-schema` funciona de ponta a ponta:

```console
$ agy --json-schema '{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"]}' \
      --output-format stream-json -p='Responda com o campo answer valendo exatamente "ok".'
{"event":"result","result":{…,"status":"SUCCESS",
  "response":"{\"answer\":\"ok\",\"toolAction\":\"Finishing task\",…}\n",
  "structured_output":{"answer":"ok"},
  "json_schema":{"type":"object",…},"usage":{…}}}
```

O adapter reembala `structured_output` no bloco `<result>…</result>`, que é onde
o runtime valida com o Standard Schema. As duas validações somam: a CLI garante
o formato na primeira tentativa, e o Zod continua sendo quem diz sim ou não.

O JSON Schema chega ao adapter por `outputSchema.jsonSchema` no
`ExecutionRequest` — campo opcional, porque não há como derivar JSON Schema de
um Standard Schema qualquer. Sem ele, o adapter cai no caminho comum a todos: a
instrução do bloco no prompt.

### Resume

```console
$ agy --output-format stream-json -p="Memorize a palavra secreta: JABUTICABA. Responda OK."
{"event":"init","conversation_id":"0e2a39e2-9ae1-46ab-8db9-54baa3238932",…}

$ agy --conversation 0e2a39e2-9ae1-46ab-8db9-54baa3238932 --output-format stream-json \
      -p="Qual era a palavra secreta? Responda só a palavra."
{"event":"init","conversation_id":"0e2a39e2-9ae1-46ab-8db9-54baa3238932",…}
{"event":"result","result":{…,"status":"SUCCESS","response":"JABUTICABA\n","num_turns":2,…}}
```

Mesmo id, contexto retomado, `num_turns` acumulando. Não existe `--fork-session`:
`--conversation` continua a conversa em vez de criar uma nova, e por isso
`forkSession` é `false`.

As conversas ficam em `~/.gemini/antigravity-cli/conversations/<id>.db`. O
adapter declara `HOME`/`USERPROFILE` nas chaves de ambiente por causa disso: sem
a home, não há histórico, e sem histórico não há resume.

### Códigos de saída e falhas

| Situação                        | Código        | `result.status`                                       |
| ------------------------------- | ------------- | ----------------------------------------------------- |
| sucesso                         | 0             | `SUCCESS`                                             |
| prompt vazio                    | 1             | `ERROR`                                               |
| modelo inexistente              | 1             | `ERROR`, com `error` explicando e listando os modelos |
| ferramenta negada por permissão | **0**         | `SUCCESS` ou `CANCELED`, com `denied_actions`         |
| flag desconhecida               | 0, sem NDJSON | —                                                     |

```console
$ agy --model modelo-inexistente-dm-teste --output-format stream-json -p="Responda OK" ; echo $?
{"event":"result","result":{"conversation_id":"","status":"ERROR","response":"",
 "error":"invalid model selection (--model \"modelo-inexistente-dm-teste\" --effort \"\"):
 model modelo-inexistente-dm-teste is not recognized as a known model or custom
 model in settings\nAvailable models:\n  Gemini 3.8 Flash (High)\n…",…}}
1
```

A linha **negada por permissão sair com código 0 e status `SUCCESS`** é a
armadilha do contrato: um Run que não fez nada pareceria bem-sucedido. É por
isso que o parser transforma `denied_actions` em `Diagnostic` com código
`PERMISSION_DENIED` e **não** emite resultado nesse caso, e que `CANCELED` vira
erro em vez de sucesso vazio.

### Cancelamento e timeout

`agy` sobe uma árvore de processos. Cancelamento e timeout continuam sendo do
`AgentRuntime`: kill de árvore com confirmação por polling, nos dois relógios
(`idleMs` e `completionMs`). Os três casos correspondentes da suíte de contrato
(`canCancel`, `supportsTimeout`) passam com a CLI real, com
`processTreeTerminated: true`.

`--print-timeout` (padrão `5m0s`) é o teto da própria CLI e **não** é usado: o
teto que vale é o do perfil, porque a garantia de término é do domínio e não da
biblioteca externa (documento técnico, seção 13).

### Autenticação

A credencial **não** está em `~/.gemini`. Uma home vazia continua autenticada:

```console
$ HOME=/tmp/vazio USERPROFILE=/tmp/vazio agy --output-format stream-json -p="Responda apenas OK"
{"event":"result","result":{…,"status":"SUCCESS","response":"OK\n",…}}
```

O token vem do cofre do sistema operacional (`keyringAuth`, nas strings do
binário; Gerenciador de Credenciais no Windows). Isso é ótimo no host — não há
nada a montar — e é exatamente o que fez o modo `DOCKER` precisar de gate
próprio. O veredito veio no
[ADR 0002](../../docs/adr/0002-antigravity-em-docker.md): **experimental**. Não
existe arquivo de credencial para montar somente-leitura, como no Claude Code,
nem variável de ambiente consumida, como no Pi — o ADR mediu que o `agy` 1.1.27
**não** usa `GEMINI_API_KEY` nem `GOOGLE_API_KEY` —, e não há `agy login`,
`agy auth` nem equivalente de `setup-token`. O único caminho não interativo é
`AGY_ADC_AUTH=1` com Application Default Credentials por arquivo montado, e ele
não foi provado com credencial real. `dockerExecution` fica `false`.

**`AGY_ADC_AUTH` não entra na allow-list de ambiente deste adapter.** Ligá-lo
faz a CLI parar de usar o token do cofre e passar a exigir o arquivo de ADC, que
no host não existe: uma variável deixada no ambiente para um experimento de
container derrubaria todo Run de host, sem nada no log ligando as duas coisas.
Há teste para isso em `args.test.ts`.

Não há checagem barata de autenticação: o preflight roda `--version`, que
responde sem falar com a rede, e deixa `authenticated` indefinido — um `false`
sem prova travaria execuções que funcionariam. `agy models` **detecta**
credencial, e é o que o ADR 0002 usa como preflight dentro do container, mas não
serve aqui: ele fala com a rede e, sem credencial, gasta 60 s fixos que
`--print-timeout` não controla. Sessenta segundos por Run é caro demais para
saber o que a primeira chamada diria de graça.

### O que existe e não foi usado

- `--input-format stream-json` com **várias** linhas: um turno por linha, no
  mesmo processo. É o caminho da sessão contínua (documento técnico, seção 29).
  O adapter manda uma linha só. `multiTurnProcess: false`.
- `--mode accept-edits` / `--mode plan`: o binário contém a mensagem
  `Print mode: --mode %s is not supported headless, continuing in the default
mode`, e o changelog registra idas e vindas nesse comportamento. Não entra.
- `--agent`: a flag existe, mas `agy agents` não lista agente nenhum nesta
  instalação, então não houve como exercitá-la. `agentSelection: false`.
- `--project` / `--new-project`: projetos da CLI. O nosso escopo de conversa é o
  Run, e `--add-dir` já resolve o workspace.

---

## Matriz de capabilities

| Capability          | Valor   | Por quê                                         |
| ------------------- | ------- | ----------------------------------------------- |
| `streaming`         | `true`  | `text_delta` chega em pedaços                   |
| `structuredOutput`  | `true`  | `--json-schema` validado de ponta a ponta       |
| `resume`            | `true`  | `--conversation <id>`, com contexto             |
| `forkSession`       | `false` | não há `--fork-session`                         |
| `multiTurnProcess`  | `false` | possível, não implementado                      |
| `toolEvents`        | `true`  | `step_type: "tool"`                             |
| `tokenUsage`        | `true`  | `usage` por passo e no `result`                 |
| `modelSelection`    | `true`  | `--model`, validado pela CLI                    |
| `agentSelection`    | `false` | flag existe, sem agente para exercitar          |
| `nativePermissions` | `false` | allow-list de comando não é consultada headless |
| `hostExecution`     | `true`  | onze casos da suíte com a CLI real              |
| `dockerExecution`   | `false` | gate da Fase 3D                                 |
| `mcpServers`        | `false` | só configuração global do usuário (abaixo)      |

---

## Servidores MCP (Fase 7)

`mcpServers` fica **`false`**, e o motivo foi medido em 08/09/2026 contra a
1.1.27. O `agy` sabe falar MCP — o `init` lista a ferramenta genérica
`call_mcp_tool` e `agy mcp add|remove|list|enable|disable` existem —, mas o
único lugar de onde ele lê servidores é a **configuração global do usuário**,
`~/.gemini/config/mcp_config.json`, a mesma da IDE:

- não há flag de linha de comando (`agy --help` não lista nada de MCP além do
  subcomando `mcp`; o parser de flags do Go recusa `--mcp-config`);
- não há variável de ambiente (as `AGY_*` do binário são de interface, de
  atualização e de ADC; nenhuma aponta para configuração de MCP);
- um `.mcp.json` no diretório de trabalho, no formato do Claude Code, **não é
  lido**: com o arquivo em `--add-dir` e um prompt pedindo a ferramenta, o
  processo do servidor nunca subiu e o agente respondeu `NO_TOOL`.

Escopar um servidor por Run exigiria `agy mcp add` antes e `agy mcp remove`
depois, reescrevendo a configuração que o usuário mantém à mão e que a IDE
também lê; dois Runs em paralelo se sobrescreveriam. O runtime avisa no diário
(`Diagnostic`, "não sobe servidores MCP em modo headless") e o Run segue sem as
ferramentas do Grimório.

---

## Testes

```bash
pnpm --filter @dungeon-master/runtime-antigravity test         # parser, argv e contrato falso
DM_HARNESS_CONTRACT=1 pnpm --filter @dungeon-master/runtime-antigravity test   # + a CLI real
```

- `parsers.test.ts` roda sobre **linhas capturadas da CLI real**, anonimizadas
  só nos caminhos absolutos e nos ids de conversa.
- `contract-fake.test.ts` roda os onze casos no CI, sem CLI e sem rede, com um
  `agy` falso que emite o NDJSON documentado acima — então o parser de produção
  é exercitado pela suíte inteira, e não só pelos testes de unidade.
- `contract.test.ts` roda os mesmos onze casos com o `agy` de verdade, mais o
  caso do `--json-schema` nativo, que a suíte comum não cobre.
