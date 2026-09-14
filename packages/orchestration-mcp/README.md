# @dungeon-master/orchestration-mcp

O servidor MCP de **delegação Agent-to-Agent** (planejamento v0.4, Fase 9B;
documento técnico, seção 40, nível 4). Um processo por Run, subido pela CLI do
harness por stdio, escopado ao Run mãe, ao `project_id` e ao `user_id`
recebidos na partida. Três ferramentas; uma delas escreve.

É um pacote separado do Grimório (`@dungeon-master/knowledge-mcp`) de
propósito: aquele só lê; este cria Task, Run e eventos. Um agente que ganha o
poder de abrir Runs precisa de um servidor cuja simples presença diga isso — e
o Worker só o oferece quando o nível de autonomia do Project libera `DELEGATE`.

## Ferramentas

| Ferramenta                                      | O que faz                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `list_loadouts()`                               | lista os Loadouts do usuário com nome, id, agente, papel e harness                                 |
| `delegate_task(loadout, prompt, taskStrategy?)` | abre um Run filho com o Loadout (nome ou id) pelo mesmo caminho do step `delegate`, e devolve o id |
| `await_run(runId, timeoutMs?)`                  | espera um filho **deste** Run mãe terminar e devolve estado, veredito, consumo e resumo            |

Regras que valem para todas, provadas em `src/tools.test.ts`, `src/server.test.ts`
e `test/stdio.test.ts`:

- **Escopo fechado na construção.** O Run mãe, o Project e o usuário entram uma
  vez, no `store`, e nenhuma ferramenta os aceita por argumento. `await_run`
  só enxerga filhos do Run mãe: outro Run é "não encontrado", mesmo existindo.
  Um servidor subido com o Project errado não delega em nome de ninguém.
- **As mesmas recusas de `POST /runs`.** O filho nasce por `createDelegatedRun`
  → `createRunWithin`: disjuntores, orçamentos, política de partida e
  capability matching decidem como na API. A profundidade máxima (2) e o nível
  de autonomia (`DELEGATE`, relido **na transação**) são conferidos antes.
- **`delegate_task` se declara de escrita** no `tools/list`
  (`readOnlyHint: false`); as outras duas, de leitura.
- **Sanitização na saída.** O resumo do filho passa por `sanitizeForContext`
  antes de voltar ao prompt de quem chamou.

## Contrato do processo

```text
node dist/bundle/orchestration-mcp.mjs --run <uuid> --project <uuid> --user <uuid>
```

- `--run`, `--project` e `--user` são identificadores e vão no argv.
- `DATABASE_URL` chega **pelo ambiente** e nunca pela linha de comando
  (CLAUDE.md, seção 8). Sem ela o processo recusa subir, com código `2`.
- stdout é do protocolo. Avisos vão para o stderr.
- O processo encerra quando o cliente fecha o stdin, e trata `SIGINT`,
  `SIGTERM` e `SIGBREAK`.

## Um arquivo só

`pnpm build` roda o `tsc` e depois `scripts/bundle.mjs`, que empacota
`dist/bin.js` com o esbuild em `dist/bundle/orchestration-mcp.mjs`. O Worker
aponta o harness para esse arquivo no host e o monta read-only em
`/opt/dungeon-master/orchestration-mcp/orchestration-mcp.mjs` no modo `DOCKER`.

## Testes

```bash
pnpm --filter @dungeon-master/orchestration-mcp test
```

- `src/tools.test.ts`: as três ferramentas sobre o store em memória — escopo,
  nível, profundidade, argumentos e formato.
- `src/server.test.ts`: o servidor falando o protocolo com o cliente do SDK
  pelo par em memória — `tools/list` com as anotações e `tools/call`.
- `test/stdio.test.ts`: o arquivo empacotado, subido como processo, contra o
  PostgreSQL embutido — o filho nasce `DELEGATION` na mesma Task ou numa Task
  filha, `await_run` espera o desfecho, escopo por Run e Project, nível relido,
  profundidade e a recusa de subir sem `DATABASE_URL`.
