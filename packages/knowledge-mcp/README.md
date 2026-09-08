# @dungeon-master/knowledge-mcp

O servidor MCP **somente leitura** do Grimório (planejamento v0.4, Fase 7). Um
processo por Run, subido pela CLI do harness por stdio, escopado ao `user_id` e
ao `project_id` recebidos na partida. Cinco ferramentas de consulta; nenhuma
escreve.

É a alternativa ao recall automático por turno, que destruía o cache de prompt
do provedor (documento técnico, seção 20.1): uma linha fixa no prompt diz que
as ferramentas existem, e o agente decide quando buscar.

## Por que um pacote com `bin`, e não um app

O servidor não tem laço próprio, nem porta, nem configuração de operador: ele
nasce e morre com o processo da CLI que o chamou, e quem o sobe é o Worker. O
que o Worker precisa **importar** — nome canônico do servidor, nomes das
ferramentas, caminho do arquivo empacotado, argumentos de partida e a linha de
instrução — mora em `src/entrypoint.ts`; o que **roda** é `dist/bin.js`,
empacotado num arquivo só. Um app em `apps/` sugeriria um serviço com vida
própria, e este não é.

## Ferramentas

| Ferramenta                        | O que devolve                                                               |
| --------------------------------- | --------------------------------------------------------------------------- |
| `search_knowledge(query, limit?)` | páginas `ACTIVE` do Project por FTS, com título, tipo, trecho e id          |
| `get_knowledge_item(id)`          | uma página inteira, limitada a `CONTENT_CHARS`                              |
| `get_project_summary()`           | o `SUMMARY` corrente e as contagens de páginas ativas                       |
| `list_decisions(limit?)`          | as decisões `ACTIVE`, da mais antiga para a mais recente                    |
| `get_task_context(taskId)`        | título, descrição, estado, Task mãe, dependências e dependentes de uma Task |

Regras que valem para todas, provadas em `src/tools.test.ts` e `test/stdio.test.ts`:

- **Escopo fechado na construção.** `userId` e `projectId` entram uma vez, no
  `store`, e nenhuma ferramenta os aceita por argumento. Uma página de outro
  Project, de outro usuário, em revisão ou arquivada é "não existe", nunca
  "existe mas não é sua".
- **Só `ACTIVE`.** O que está em revisão ainda não é conhecimento; o resumo tem
  porta própria e não aparece na busca nem na leitura por id.
- **Sanitização na saída.** Todo texto devolvido passa por `escapeXmlTags` de
  `@dungeon-master/knowledge`, inclusive título e descrição de Task, que são
  texto do usuário.
- **Respostas compactas.** A busca traz trecho e id; a página inteira é pedida
  por id. Os tetos estão em `src/format.ts`.
- **Anotações de leitura.** Toda ferramenta publica `readOnlyHint: true` e
  `destructiveHint: false` no `tools/list`.

## Contrato do processo

```text
node dist/bundle/knowledge-mcp.mjs --project <uuid> --user <uuid>
```

- `--project` e `--user` são identificadores e vão no argv.
- `DATABASE_URL` chega **pelo ambiente** e nunca pela linha de comando
  (CLAUDE.md, seção 8): no host, pela allow-list do harness; no container, por
  `-e DATABASE_URL` sem valor, com o valor no ambiente do cliente Docker. Sem
  ela o processo recusa subir, com código `2` e o motivo no stderr.
- stdout é do protocolo. Avisos vão para o stderr.
- O processo encerra quando o cliente fecha o stdin, e trata `SIGINT`,
  `SIGTERM` e `SIGBREAK`.

## Um arquivo só

`pnpm build` roda o `tsc` e depois `scripts/bundle.mjs`, que empacota
`dist/bin.js` com o esbuild em `dist/bundle/knowledge-mcp.mjs`. O Worker aponta
o harness para esse arquivo no host e o monta read-only em
`/opt/dungeon-master/knowledge-mcp/knowledge-mcp.mjs` no modo `DOCKER`. Um
arquivo porque o `node_modules` do pnpm é uma floresta de links simbólicos que
não sobrevive a um bind mount, e porque o que roda no container precisa ser
exatamente o que roda no host. O teste de stdio empacota com a mesma função.

## Testes

```bash
pnpm --filter @dungeon-master/knowledge-mcp test
```

- `src/tools.test.ts`: as cinco ferramentas sobre o store em memória — escopo,
  limites, formato e sanitização.
- `src/server.test.ts`: o servidor falando o protocolo com o cliente do SDK
  pelo par em memória — `tools/list` com as anotações e `tools/call` no
  envelope certo.
- `test/stdio.test.ts`: o arquivo empacotado, subido como processo pelo cliente
  do SDK, contra o PostgreSQL embutido — FTS, escopo por usuário e Project, e
  a recusa de subir sem `DATABASE_URL`.
