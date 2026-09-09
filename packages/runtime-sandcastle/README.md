# `@dungeon-master/runtime-sandcastle`

Adapters de **Claude Code**, **Codex** e **Pi** para execução no host,
implementando `HarnessAdapter` de `@dungeon-master/runtime`.

O que mora aqui: o argv não interativo de cada CLI, o parser incremental do
NDJSON de cada uma, a matriz de capabilities e o preflight (executável no PATH,
versão, autenticação quando barata).

O que **não** mora aqui: timeout, cancelamento, worktree, política de ambiente e
resultado estruturado. Isso é do runtime, uma camada acima, e é o que garante
que essas promessas não variem de harness para harness.

## Autenticação no preflight (Fase 8B)

Cada definição declara `detectAuthentication`, uma checagem local, não
interativa e sem chamada de modelo, que o preflight roda depois do `--version`
com o mesmo ambiente por allow-list do Run (`auth-check.ts`, interpretações
puras e testadas):

| Harness     | Comando                                        | Veredito                                    | Custo medido (09/09/2026) |
| ----------- | ---------------------------------------------- | ------------------------------------------- | ------------------------- |
| Claude Code | `claude auth status`                           | JSON com `loggedIn`                         | ~0,2 s                    |
| Codex       | `codex login status`                           | código `0`; `1` com "Not logged in"         | ~0,2 s                    |
| Pi          | `pi auth check --provider <p> --json`          | `status: ready` / `not_ready`, por provedor | ~0,35 s por provedor      |
| Antigravity | `agy models` (no pacote `runtime-antigravity`) | código `0`; `1` com "Please sign in"        | ~2,6 s (0,9 s sem sessão) |

O Pi exige `--provider`; com o provedor fixado no adapter é uma checagem, sem
ele são três (`google`, `anthropic`, `openai`), e uma pronta basta. O resultado
sai em `PreflightResult.authenticated` com `authReason`, uma frase com o comando
e o que ele respondeu — nunca a saída bruta, porque o JSON do `claude auth
status` traz o e-mail e a organização do usuário. Qualquer resposta que não dá
para ler deixa `authenticated` indefinido: um `false` sem prova travaria
execuções que funcionariam. O Worker grava o veredito em
`harness.auth_status` no boot; a API o mede de novo no preflight do Loadout.

```ts
import {
  createAgentRuntime,
  createHarnessRegistry,
  createWorkspaceManager,
  createWorkspaceResolver,
} from "@dungeon-master/runtime";
import { hostAdapters } from "@dungeon-master/runtime-sandcastle";

const runtime = createAgentRuntime({
  registry: createHarnessRegistry(hostAdapters()),
  workspace: createWorkspaceResolver({ manager: createWorkspaceManager() }),
});

for await (const event of runtime.execute(request)) {
  // ExecutionEvent canônico, igual para os três harnesses
}
```

---

## ADR 0001 — Como o Sandcastle entra no runtime de host

**Status:** aceito · 07/09/2026 · verificado contra `@ai-hero/sandcastle` 0.12.0
(`e99f832`), Claude Code 2.1.263, Codex 0.147.0 e Pi 0.85.1, em Windows 11.

### Contexto

O planejamento coloca o Sandcastle como primeiro backend de execução (seção
3.6), e o documento técnico registra que **cancelamento, timeout e trava são do
nosso domínio, não da biblioteca** (seções 13 e 16). A pergunta desta fase é
onde exatamente a linha cai: usar `run()` inteiro, usar só as peças, ou nenhuma
das duas.

Quatro fatos foram verificados no código de origem, e cada um empurra a linha
para o mesmo lado:

1. **`run()` não expõe o PID e não permite injetar o spawn.** O processo do
   agente nasce em `noSandbox().create().exec()`
   (`src/sandboxes/no-sandbox.ts`), que devolve uma `Promise<ExecResult>` e nada
   mais. Sem PID não há kill de árvore, e o kill de árvore com confirmação por
   polling é requisito do domínio.
2. **Não existe `proc.kill()` em lugar nenhum do Sandcastle.** O `AbortSignal`
   de `run()` apenas ganha uma corrida contra a promessa (`raceAbortSignal.ts`);
   o processo do agente e os filhos dele continuam vivos, órfãos no host. O
   mesmo vale para o timeout de ociosidade, que "força a conclusão" sem matar
   ninguém.
3. **`buildPrintCommand` devolve uma linha de comando de shell, não um argv.**
   O provider monta uma string com `shellEscape`, e `exec` a entrega a `sh -c` no
   POSIX e a `cmd.exe /d /s /c` no Windows. Nosso `CLAUDE.md` (seção 8) proíbe
   as duas coisas — shell e comando montado por concatenação — porque o texto que
   entra ali vem de Task, Loadout e resultado de agente. O `shellEscape` do
   Sandcastle é, além disso, POSIX puro: ele envolve o argumento em aspas
   simples, que o `cmd.exe` não reconhece como aspas.
4. **`noSandbox` espalha `{ ...process.env }` no filho.** A allow-list do
   Sandcastle (`.sandcastle/.env`) é aditiva, e não restritiva: no modo host o
   agente herda o ambiente inteiro do worker. Nossa política de ambiente é
   allow-list de verdade.

Um quinto fato pesou menos, mas confirma a direção: os parsers de stream de
`AgentProvider.ts` são **lossy** por desenho. Eles descartam toda ferramenta
fora de uma allow-list de quatro nomes (`Bash`, `WebSearch`, `WebFetch`,
`Agent`), não emitem resultado de ferramenta, e no Pi a tabela é comparada
contra `toolName` — que o Pi emite em minúsculas (`bash`), de modo que **nenhuma
chamada de ferramenta do Pi sobrevive ao parser de origem**. O nosso
`ExecutionEvent` precisa de `ToolCall` **e** `ToolResult` para o Run Cockpit.

### Alternativas

**A. Depender de `run()` do Sandcastle.**
_Prós:_ menos código nosso; ganhamos de graça worktree, Docker e captura de
sessão; upgrades trazem provider novo.
_Contras:_ sem PID, o cancelamento vira `AbortSignal` sem kill — exatamente a
lacuna que o documento técnico manda cobrir; o env do worker vaza inteiro; o
spawn passa por shell; os eventos ficam limitados ao que os parsers de origem
preservam. Os quatro pontos são requisitos, não preferências.

**B. Usar os providers só para montar o argv e parsear o stream.**
_Prós:_ o pacote continua sendo "adapter do Sandcastle" de verdade; parsers
mantidos por terceiros.
_Contras:_ `buildPrintCommand` devolve string de shell, então "montar o argv"
exigiria fazer o parse inverso da string que acabou de ser montada — frágil e
errado no Windows. `ParsedStreamEvent` não é exportado em `src/index.ts` (só
`AgentProvider`, que o referencia), então o tipo não é nomeável de fora. E os
parsers perdem eventos que precisamos. Sobraria uma dependência que não carrega
o próprio peso.

**C. Argv e parsers nossos, adaptados dos de `AgentProvider.ts`, com o spawn
por `packages/platform`.**
_Prós:_ PID desde o primeiro instante, logo kill de árvore com confirmação;
argumentos em array, sem shell, iguais nos dois sistemas; ambiente por
allow-list de verdade; eventos com a fidelidade que o `ExecutionEvent` pede
(`ToolResult`, `Artifact`, `Usage`, permissão negada). O trabalho de descoberta
— quais flags, qual linha traz o id de sessão, qual formato de usage — já estava
feito pelo Sandcastle e foi aproveitado com atribuição.
_Contras:_ mais código nosso (cerca de 700 linhas com testes); mudança de
formato de CLI passa a ser problema nosso; não ganhamos providers novos de
graça.

### Decisão

**Alternativa C.** Os adapters de host não dependem de `@ai-hero/sandcastle` em
runtime. O pacote **não** tem o Sandcastle como dependência: o argv, os parsers
e o spawn são nossos.

O que veio do Sandcastle veio como **código adaptado, com atribuição**, no modo
"Ler"/"Adaptar" do manifesto (planejamento v0.4, seção 13.1): os formatos de
argumento e os parsers de stream dos três providers (`claude-code.ts`,
`codex.ts`, `pi.ts`), o extrator de resultado estruturado
(`packages/runtime/src/structured-output.ts`), a cauda limitada
(`packages/runtime/src/bounded-tail.ts`, com o teste de origem) e o par de flags
que evita a disputa pelo `.git/config.lock` no `worktree add`. Cada arquivo traz
o cabeçalho `caminho@commit` e uma entrada em `THIRD_PARTY_NOTICES.md`.

**O nome do pacote continua `runtime-sandcastle`**, como o planejamento define
(seção 5). Ele descreve a linhagem — este é o pacote dos harnesses que o
Sandcastle cobre, e é aqui que a dependência voltaria se as lacunas fossem
fechadas — e trocá-lo custaria uma renomeação em cascata para ganhar precisão
que este ADR já dá.

### Consequências

- `AgentRuntime.cancel()` mata a árvore de processos e confirma o
  desaparecimento por polling, nos dois sistemas. A suíte de contrato prova isso
  com um agente que ignora `SIGTERM` e deixa um neto vivo.
- Uma mudança de formato de NDJSON numa CLI quebra um teste de parser nosso, com
  linhas reais capturadas em `src/parsers.test.ts`, em vez de quebrar em
  produção com um id de sessão perdido em silêncio.
- Ficamos devendo o que o Sandcastle daria de graça: **Docker** (Fase 2C) e a
  transferência de sessão entre host e container. Quando a Fase 2C chegar, vale
  reavaliar `createSandbox()` para o modo `DOCKER` — lembrando que ele **não**
  propaga o `env` do provider a containers longevos, e que `sandbox.interactive()`
  passa `dangerouslySkipPermissions: true` incondicionalmente e não deve ser
  usado.
- Se uma versão futura do Sandcastle expuser o PID (ou aceitar um spawn
  injetado) e trocar a string de shell por argv, a alternativa B volta a ser
  viável para os parsers. A superfície pública do nosso `HarnessAdapter` não
  muda; só o miolo destes três arquivos.

---

## Decisões menores, registradas

**Resolução de executável sem shell (`resolve-cli.ts`).** No Windows as CLIs
chegam como binário (`claude.exe`) ou como shim `.cmd` do npm (`codex.cmd`,
`pi.cmd`). Desde a correção do CVE-2024-27980 o Node recusa executar `.cmd` sem
`shell: true`. Em vez de ligar o shell, o adapter lê o shim, extrai o caminho do
script `.js` que ele invoca e sobe `node <script.js>` com `process.execPath`.
O `PATHEXT` é consultado **antes** do nome nu: o npm instala `pi` (script `sh`,
para o Git Bash) ao lado de `pi.cmd`, e no Windows o primeiro não é executável.

**Permissões.** O modo padrão nunca é bypass. `DEFAULT` não passa flag nenhuma —
vale o padrão da CLI, que é o mais restritivo. `CONFIGURED` passa o modo nativo
(`--permission-mode` no Claude, `-s` no Codex). `BYPASS` só sobrevive com
`SANDBOX_ENFORCED` ou opt-in explícito na política; fora disso o runtime o
rebaixa e registra um `Diagnostic`.

Uma consequência prática, medida na demonstração e que a UI precisa comunicar:
**num Run sem ninguém olhando, os modos nativos do Claude Code não chegam ao
`git commit`.** `acceptEdits` deixa escrever o arquivo e barra o `Bash`;
`dontAsk` nega tudo, porque não existe quem aprove. No host, um Run autônomo que
precise commitar exige `BYPASS` com opt-in explícito — e é por isso que o
enforcement cai para `ADVISORY` e o `Diagnostic` fica visível na timeline. Em
`DOCKER` (Fase 2C) o mesmo bypass passa a valer `SANDBOX_ENFORCED`, que é a
diferença que a seção 15 do documento técnico manda a interface mostrar.

**Capabilities honestas.** `forkSession` é `false` no Codex porque
`codex exec fork` não existe na 0.147.0, e `false` no Pi porque `--fork` existe
mas ainda não foi exercitado na suíte. `nativePermissions` é `false` no Pi: ele
tem `--approve`/`--no-approve` para confiar em arquivos do projeto, não um modo
de permissão por ferramenta, e chamar isso de permissão nativa mostraria uma
proteção que não existe.

**O prompt vai pelo stdin nos três.** No Windows a linha de comando inteira tem
teto de 32767 caracteres, e um prompt com contexto de projeto passa disso sem
esforço. No Codex isso exige o argumento `-`: sem ele, um stdin aberto vira um
bloco `<stdin>` **anexado** ao prompt posicional, e o agente recebe o pedido
duas vezes.

---

## Servidores MCP (Fase 7)

`ExecutionRequest.mcpServers` chega ao adapter só quando a matriz diz
`mcpServers: true`; o resto é tradução por CLI. Tudo abaixo foi medido em
08/09/2026 com um servidor de sondagem que só relata que variáveis enxerga.

| Harness     | `mcpServers` | Como                                                                                                                                                                                                                                                                            |
| ----------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | `true`       | `--mcp-config '<json>' --strict-mcp-config`, mais `mcp__<servidor>__<tool>` na `--allowedTools`. O servidor herda o ambiente inteiro da CLI (~100 variáveis): `DATABASE_URL` chega sem argv nem arquivo. A chamada vem como `tool_use` de nome `mcp__<servidor>__<tool>`.       |
| Codex       | `true`       | `-c mcp_servers.<nome>.command/args/env_vars/enabled_tools` e `default_tools_approval_mode="approve"`. Sem `env_vars` o servidor recebe só ~20 variáveis; sem `approve` a chamada morre como "user cancelled MCP tool call" em `approval_policy="never"`. Item `mcp_tool_call`. |
| Pi          | `false`      | "No MCP" é decisão de projeto do Pi (README da 0.85.1): sem flag, sem arquivo, sem variável. Só uma extensão (`-e`) traria MCP, e isso é assunto da Fase 8.                                                                                                                     |

A configuração do Claude Code vai como **string JSON no argv**, e não como
arquivo temporário: a CLI aceita as duas formas, a string não deixa nada para
limpar e é a mesma nos dois modos — dentro do container não haveria como
apontar para um arquivo do host. O JSON carrega comando, argumentos e ids;
nunca um segredo. `--strict-mcp-config` deixa de fora o que o usuário tiver na
conta dele: o diário mostra só ferramentas que o Loadout ou o Grimório
ofereceram.

No modo `DOCKER`, o adapter de container monta o arquivo do servidor read-only,
troca o comando pelo de dentro da imagem, reescreve `DATABASE_URL` para
`host.docker.internal` (o valor no ambiente do cliente, `-e NOME` no argv) e
liga `--add-host host.docker.internal:host-gateway`. O `buildArgs` do Claude
Code é o mesmo dos dois modos; o que muda é a lista que ele recebe.

## Testes

```bash
pnpm --filter @dungeon-master/runtime-sandcastle test
```

- `parsers.test.ts` roda sempre: linhas reais das três CLIs, capturadas em
  07/09/2026, contra os parsers.
- `resolve-cli.test.ts` roda sempre, com os casos de Windows e de POSIX
  separados por `describe.runIf`.
- `mcp-args.test.ts` roda sempre: a tradução dos servidores MCP para o argv de
  cada CLI, com a prova de que o segredo não está nele.
- `contract.test.ts` roda os onze casos da Fase 3E, mais o `usesMcpServer` da
  Fase 7, com as CLIs **reais**, e some quando a CLI não está instalada ou quando
  `CI` está definida. `DM_HARNESS_CONTRACT=1` força a execução. No CI, quem cobre
  os mesmos casos é o harness falso, em
  `packages/runtime/src/testing/fake-harness.test.ts`.

## Demonstração

`scripts/demo.ts` cria um repositório git em temp, sobe um worktree por Run,
manda o Claude Code criar e commitar um arquivo com resultado estruturado, e
depois cancela um segundo Run aos 2 s confirmando que a árvore de processos
morreu.

```bash
pnpm --filter @dungeon-master/runtime-sandcastle demo
```
