# ADR 0002 — Antigravity CLI no modo de execução DOCKER

- **Status**: aceito
- **Data**: 07/09/2026
- **Contexto**: Fase 3D do planejamento v0.4 ("gate técnico, não suposição"); seção 31 do
  documento de fundamentos, que lista as cinco perguntas que o suporte a Docker precisa
  responder. Herda o ADR [`0001`](./0001-autenticacao-em-docker.md), cuja pergunta
  decisiva continua valendo: **existe token não interativo que o sanitizador saiba
  redigir?**
- **Decide**: se o Antigravity entra no modo `DOCKER` como **suportado**, **experimental**
  ou **bloqueado**.

## Resumo do veredito

| Harness         | Veredito         | Entrega da credencial                                    | `dockerExecution` |
| --------------- | ---------------- | -------------------------------------------------------- | ----------------- |
| **Antigravity** | **experimental** | só ADC: um arquivo montado read-only + `AGY_ADC_AUTH=1`   | `false`           |

O motivo, em uma frase: **o único caminho não interativo é por arquivo, e ele não foi
provado de ponta a ponta** — a credencial de ADC é lida, é enviada ao Google e é rejeitada
por lá quando é falsa, mas nenhum Run autenticado rodou dentro do container, porque emitir
uma credencial de longa duração na conta do usuário não é decisão de um agente.

É o mesmo lugar em que o Codex ficou no ADR 0001, por uma razão parecida e uma agravante:
não existe **nenhuma** variável que carregue o segredo, então nem em teoria o sanitizador
de credenciais alcança esse caminho.

## O ambiente do experimento

Windows 11, Docker Desktop 29.7.2 (WSL2, containers Linux), imagem
`dungeon-master-agent:0.2.0` construída por `docker/agent.Dockerfile`, com `agy` 1.1.27 —
a mesma versão do host:

```console
$ agy --version                                                    # host
1.1.27
$ docker run --rm --user 1000:1000 dungeon-master-agent:0.2.0 agy --version
1.1.27
```

O host está autenticado, e é assim que se prova que está:

```console
$ agy --output-format json --print-timeout 100s -p="responda apenas: OK"
{"conversation_id":"cbd26d09-…","status":"SUCCESS","response":"OK\n","duration_seconds":1.75,…}
```

Nenhum experimento leu o conteúdo de um arquivo ou de uma entrada de credencial. O que foi
observado é sempre o **comportamento** da CLI, nunca o segredo.

## 1. Onde o `agy` guarda a credencial, e o que ele aceita sem interação

### Não é arquivo. É o cofre do sistema operacional.

Esta é a diferença que decide o ADR inteiro, e ela separa o Antigravity dos outros três
harnesses. Claude Code, Codex e Pi guardam a credencial num arquivo sob o home; o
Antigravity **não guarda nada no disco**.

A prova é por ausência: com `HOME` e `USERPROFILE` apontando para um diretório vazio, o
`agy` continua autenticado.

```console
$ USERPROFILE=/tmp/vazio HOME=/tmp/vazio agy --output-format json -p="responda apenas: OK"
{"conversation_id":"422beb14-…","status":"SUCCESS","response":"OK\n",…}
```

O diretório vazio ganhou um `~/.gemini/antigravity-cli/` novo — log, cache, banco de
conversas, `installation_id` — e mesmo assim a chamada autenticou. Nada do que o `agy`
escreve no home é credencial.

Onde ela está, então:

```console
$ cmdkey /list | findstr /i antigravity
    Destino: LegacyGeneric:target=gemini:antigravity
    Tipo: Genérico
    Usuário: antigravity
```

É o **Gerenciador de Credenciais do Windows**, protegido por DPAPI e escopado ao usuário
da máquina. O binário confirma o mecanismo por plataforma: `wincred`, `CredReadW`,
`CredWriteW` e `CryptProtectData` no executável do Windows; `org.freedesktop.secret`,
`SecretService`, `kwallet` e `DBUS_SESSION_BUS_ADDRESS` no binário Linux que está dentro da
imagem.

**Um cofre do Windows não se monta num container Linux.** Não é uma dificuldade de
configuração: é uma impossibilidade de categoria. E o container Linux também não tem
Secret Service nem D-Bus para ser o cofre do outro lado.

### Não existe subcomando de login, nem de conferência de sessão

```console
$ agy login
Error: unexpected argument "login".
$ agy auth
Error: unexpected argument "auth".
```

A lista de subcomandos é `agent`, `agents`, `changelog`, `help`, `install`, `mcp`,
`mic-serve`, `models`, `plugin`, `remote-control`, `update`. Não há `login`, `logout`,
`auth`, `whoami` nem equivalente de `claude setup-token`. **A autenticação é a TUI**: rodar
`agy` sem argumentos abre o fluxo OAuth no navegador.

### As variáveis de chave de API não são caminho de autenticação

`GEMINI_API_KEY` e `GOOGLE_API_KEY` existem na tabela de strings do binário, o que
convidaria à suposição. A suposição está errada. Com um valor sintético, o container
produz **exatamente** o mesmo resultado que sem variável nenhuma — o mesmo prompt de OAuth,
o mesmo `result`:

```console
$ docker run --rm --user 1000:1000 -e GEMINI_API_KEY dungeon-master-agent:0.2.0 \
    agy --output-format stream-json --print-timeout 20s -p="responda apenas: OK"
{"event":"result","result":{"status":"ERROR","error":"authentication failed or timed out",…}}
# stderr: Authentication required. Please visit the URL to log in: …
```

Igual para `GOOGLE_API_KEY`. É o contrário do que o ADR 0001 viu no Claude Code, onde um
token sintético mudou o erro de "Not logged in" para "401 OAuth access token is invalid" —
e era essa mudança que provava que a variável tinha virado tentativa de autenticação. Aqui
não há mudança nenhuma, então não há consumo.

### O que **existe**: `AGY_ADC_AUTH` e Application Default Credentials

Este é o achado do spike, e ele veio do log da própria CLI.

`AGY_ADC_AUTH=1` troca o modo de autenticação: em vez de ler o cofre e cair no navegador,
o `agy` usa **Application Default Credentials** do Google. O log de dentro do container,
sem credencial nenhuma:

```text
printmode.go:364] Print mode: not authenticated, trying silent auth
adc_auth.go:39]   adcAuth: failed to load credentials: google: could not find default credentials
printmode.go:370] Print mode: silent auth failed
```

Com um arquivo de ADC sintético (tipo `authorized_user`, `client_id` e `refresh_token`
inventados) montado read-only, o erro **muda de lugar**:

```console
$ docker run --rm --user 1000:1000 \
    -e AGY_ADC_AUTH=1 \
    -v "…/fake_adc.json:/home/agent/.config/gcloud/application_default_credentials.json:ro" \
    dungeon-master-agent:0.2.0 agy --output-format stream-json -p="responda apenas: OK"
```

```text
adc_auth.go:49] adcAuth: failed to get token from token source:
                oauth2: "invalid_client" "The OAuth client was not found."
```

"could not find default credentials" e `invalid_client` são estados diferentes, e a
diferença é a mesma que o ADR 0001 usou como prova: o segundo só existe se o arquivo tiver
sido lido, parseado e **enviado ao Google**, que o rejeitou. O caminho está ligado de
verdade; o que falta é uma credencial verdadeira.

As duas formas de entrega funcionam, e as duas foram medidas:

| Entrega                                                         | Resultado                    |
| --------------------------------------------------------------- | ---------------------------- |
| `$HOME/.config/gcloud/application_default_credentials.json` (mount) | lido; `invalid_client`   |
| `GOOGLE_APPLICATION_CREDENTIALS` apontando para o mount           | lido; `invalid_client`       |

Uma armadilha que custou uma rodada e vale registrar: no Git Bash do Windows, o MSYS
reescreve `GOOGLE_APPLICATION_CREDENTIALS=/home/agent/adc.json` para
`C:/Program Files/Git/home/agent/adc.json` antes de o cliente Docker ver o valor, e o erro
resultante ("no such file") parece ausência de suporte a ADC quando é só o shell. É a
mesma classe de problema que a seção 8 do `CLAUDE.md` já proíbe no argv, agora no ambiente.
No produto isso não acontece, porque o worker monta o argv como array e nunca passa por
shell.

## 2. O mínimo a entregar ao container, e por qual mecanismo

Um arquivo e dois interruptores:

1. **o arquivo de ADC**, montado **read-only** num caminho específico do container — nunca
   o home, nunca `~/.gemini` inteiro (documento técnico, seção 31);
2. **`AGY_ADC_AUTH=1`**, que não é segredo: é o interruptor que escolhe o modo;
3. **`GOOGLE_APPLICATION_CREDENTIALS`** com o **caminho de montagem dentro do container**,
   opcional se o arquivo for para o caminho bem-conhecido do gcloud.

Os itens 2 e 3 são **configuração**, e não credencial: um vale `1`, o outro é um caminho
POSIX de dentro do container. Nenhum dos dois carrega segredo, então escrevê-los no argv
(`-e NOME=VALOR`) não viola a regra da seção 8 do `CLAUDE.md`. O segredo é o **conteúdo do
arquivo**, e ele entra pelo mount.

O `packages/runtime/src/docker.ts` não sabia expressar isso: `envKeys` manda só o **nome**
e deixa o valor no ambiente do cliente, que é o certo para segredo e o errado para
configuração — `GOOGLE_APPLICATION_CREDENTIALS` no ambiente do worker, no Windows, seria um
caminho `C:\…` que dentro do container não existe. Daí o campo `fixedEnv`, adicionado neste
spike, com a regra escrita junto e um erro quando o mesmo nome aparece nos dois lugares.

Montar `~/.gemini` inteiro read-only foi testado, e **não** autentica — o que era de se
esperar, já que a credencial não está em arquivo nenhum. De quebra, o mount read-only quebra
a CLI, que precisa escrever o próprio log e o banco de conversas ali dentro.

## 3. Expiração e renovação

| Credencial                             | Renova dentro do container?                | O que acontece ao vencer                        |
| -------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| Cofre do sistema (host)                | não chega ao container                     | irrelevante para o modo `DOCKER`                |
| ADC de conta de serviço                | sim, em memória, a cada chamada            | não vence; a chave é revogada no console        |
| ADC de usuário (`gcloud auth …`)       | sim, em memória, pelo `refresh_token`      | refresh revogado → `invalid_grant` e Run falha  |

A renovação do ADC acontece **em memória** e não precisa escrever no arquivo, então o mount
read-only não atrapalha — que é uma vantagem real sobre o `.credentials.json` do Claude
Code, cuja sessão curta não consegue se renovar dentro de um container read-only (ADR 0001).

**Isto não foi medido.** É a propriedade documentada da biblioteca de autenticação do
Google que o `agy` usa, e o spike não teve credencial real para observar um refresh
acontecendo. Fica registrado como raciocínio, não como prova, e é parte do que mantém o
veredito em experimental.

## 4. Vazamento: o valor chega ao stream?

**Chega, nas três posições, e está provado.** O Run foi executado no **host**, porque no
container não há credencial para rodá-lo; o que se mede aqui é o formato do stream do
`agy`, que é o mesmo nos dois modos — no modo `DOCKER` só muda o spawn.

```console
$ DM_SPIKE_MARKER='dm-spike-marker-…' agy --output-format stream-json \
    --dangerously-skip-permissions -p="Rode `printenv DM_SPIKE_MARKER` e me diga o texto exato."
```

O marcador aparece três vezes, e são exatamente as três posições que o ADR 0001 nomeou:

| Posição no stream                                     | Evento do `agy`                                        |
| ----------------------------------------------------- | ------------------------------------------------------ |
| resultado de ferramenta                               | `step_update` · `step_type: tool` · `tool_name: run_command` |
| texto do assistente                                   | `step_update` · `step_type: agent_response`            |
| resultado final                                       | `result`                                               |

Rodado o `sanitizeJson` de `@dungeon-master/events`, o mesmo que o worker aplica em todo
payload antes de virar `run_event`:

```text
posicoes           : step_update/tool/run_command, step_update/agent_response/-, result/-/-
ocorrencias antes  : 3
ocorrencias depois : 0
```

```text
…"parameters":{"CommandLine":"printenv DM_SPIKE_MARKER"},"output":"[REDACTED]\n"}}}
…"text_delta":"O comando executado imprimiu:\n\n```text\n[REDACTED]\n```\n"
…"response":"O comando executado imprimiu:\n\n```text\n[REDACTED]\n```\n"
```

**A consequência é a que decide o veredito.** O sanitizador procura o **valor** de uma
variável conhecida no ambiente do worker. O caminho do Antigravity não tem valor nenhum no
ambiente do worker: a credencial é o conteúdo de um arquivo montado, que o worker nunca
leu. Se o agente der `cat` nesse arquivo, o segredo entra no log append-only e **fica**.
É o risco residual do Codex, sem a possibilidade de escapar dele por variável.

Nenhuma variável nova entrou em `SENSITIVE_ENV_VARS`, e isso é deliberado.
`GEMINI_API_KEY` e `GOOGLE_API_KEY` já estavam lá desde a 2C, e as duas variáveis novas do
caminho de ADC — `AGY_ADC_AUTH` e `GOOGLE_APPLICATION_CREDENTIALS` — não são segredo:
redigir um caminho de arquivo do log só atrapalharia o diagnóstico.

Um detalhe do stream sem credencial: a URL de OAuth que o `agy` imprime carrega `state` e
`code_challenge`. São valores públicos do PKCE, e vão para o **stderr**, não para o stdout.

## 5. O que a CLI faz sem credencial: falha clara, mas cara

Falha, e falha limpo — com uma ressalva que muda o desenho do adapter.

```console
$ docker run --rm --user 1000:1000 dungeon-master-agent:0.2.0 \
    agy --output-format stream-json --print-timeout 20s -p="responda apenas: OK" </dev/null
# stdout — NDJSON válido, um evento só:
{"event":"result","result":{"conversation_id":"","status":"ERROR","response":"",
 "error":"authentication failed or timed out","duration_seconds":0,"num_turns":0,…}}
# stderr:
Authentication required. Please visit the URL to log in:
  https://accounts.google.com/o/oauth2/auth?…
Waiting for authentication (timeout 60s)...
Or, paste the authorization code here and press Enter:
Error: authentication timed out.
# exit 1, 62 s
```

Três coisas para registrar:

1. **O stdout continua NDJSON válido.** O prompt humano vai todo para o stderr, e o parser
   não vê lixo no meio do stream. É melhor do que o Codex, que no ADR 0001 repetia erro de
   websocket em laço até o timeout.
2. **Custa 60 segundos fixos, e `--print-timeout` não manda nesse relógio.** A espera pelo
   código de autorização é um timeout interno da CLI; foi medida com `--print-timeout 20s` e
   com `45s`, e nos dois casos o processo durou ~62 s.
3. **`AGY_ADC_AUTH=1` transforma essa espera em falha imediata.** Sem navegador para
   oferecer, a CLI desiste em ~2–3 s com `Error: authentication required. Run 'agy' to log
   in.` Ou seja: o interruptor que liga o único caminho não interativo é **também** o que
   faz o Run mal autenticado morrer rápido em vez de queimar um minuto.

### O preflight, e a armadilha dentro dele

`agy models` serve de preflight não interativo: 1–2 s, sem chamada de modelo, sem gastar
token.

```console
$ agy models                                   # host autenticado
gemini-3.8-flash-high   Gemini 3.8 Flash (High)
…                                              # exit 0

$ docker run --rm --user 1000:1000 dungeon-master-agent:0.2.0 agy models
Error: Please sign in to view available models. Launch the CLI without arguments to sign in.
                                               # exit 1
```

A armadilha: com `AGY_ADC_AUTH=1` no ambiente, o **host autenticado** também responde
"Please sign in". O interruptor não é aditivo — ele **substitui** o cofre pelo ADC. Um
preflight que herdasse `AGY_ADC_AUTH` do ambiente do usuário daria falso negativo no modo
`HOST`, e é por isso que a variável precisa nascer da definição do harness de Docker
(`fixedEnv`) e nunca do ambiente do worker.

## Decisão

1. **Antigravity entra no modo `DOCKER` como `experimental`, com
   `dockerExecution: false`.** O critério de aceite da Fase 3D pede caminho "seguro e
   reproduzível" para marcar suportado. O caminho de ADC é reprodutível, mas não foi
   provado com credencial real e é exclusivamente por arquivo, que é justamente a forma que
   o log não sabe defender.
2. **Quando for ligado, a entrega é: arquivo de ADC montado read-only + `AGY_ADC_AUTH=1` +
   `GOOGLE_APPLICATION_CREDENTIALS` com o caminho do container**, os dois últimos por
   `fixedEnv`, que escreve valor no argv e por isso proíbe segredo por contrato.
3. **Nenhuma credencial entra na imagem.** `dungeon-master-agent:0.2.0` é construível e
   publicável sem segredo, e o `agy` entra por objeto versionado com SHA-512 conferido.
4. **`AGY_ADC_AUTH` nunca é herdado do ambiente do worker.** No modo `HOST` ele quebra a
   autenticação que funciona; ele pertence à definição do harness em Docker.
5. **O preflight do Antigravity é `agy models`**, e não um Run de sondagem.
6. **A definição do harness em Docker fica para a rodada seguinte**, quando o adapter de
   host existir. Este ADR é o gate; ele decide, não fia.

## O que ficou pendente de credencial

Sair de experimental depende de um teste que precisa de uma credencial de ADC de verdade, e
emiti-la é decisão do usuário, não de um agente. O comando é um destes dois:

```bash
# Opção A — credencial de usuário. Abre o navegador e grava
# %APPDATA%\gcloud\application_default_credentials.json
gcloud auth application-default login

# Opção B — conta de serviço de um projeto com a API do Antigravity habilitada,
# baixando a chave JSON pelo console do Google Cloud
```

Com o arquivo em mãos, o teste que fecha o gate é este, e ele precisa responder `OK`:

```bash
docker run --rm --user 1000:1000 \
  -e AGY_ADC_AUTH=1 \
  -v "$HOME/.config/gcloud/application_default_credentials.json:/home/agent/.config/gcloud/application_default_credentials.json:ro" \
  dungeon-master-agent:0.2.0 \
  agy --output-format json --print-timeout 60s -p="responda apenas: OK"
```

Há um risco concreto de ele **não** responder `OK` mesmo com credencial válida, e ele está
à vista na URL de OAuth que a CLI imprime: os escopos que o Antigravity pede incluem
`.../auth/aicode`, `.../auth/cclog` e `.../auth/experimentsandconfigs`, que o
`gcloud auth application-default login` não concede. Nesse caso o veredito não muda por
teimosia — muda para **bloqueado**, e a razão fica escrita aqui.

## Consequências

- O Antigravity não aparece como opção em "Masmorra selada", pelo mesmo mecanismo que já
  esconde o Codex: `dockerExecution: false` na matriz de capabilities, e a razão em
  `execution_profile.disabled_reason` quando o perfil estiver desligado.
- A Fase 3 pode ser concluída: o critério dela é "Docker suportado **ou** marcado como
  experimental", e este ADR é a marcação.
- `fixedEnv` nasce aqui, mas não é do Antigravity: é o jeito de configurar qualquer CLI
  para dentro do container sem confundir configuração com credencial.
- A imagem de referência subiu para `0.2.0` e ficou 210 MB maior. O `agy` é um binário Go
  único de 210 MB, e não um pacote npm; os números estão em [`docker/README.md`](../../docker/README.md).
