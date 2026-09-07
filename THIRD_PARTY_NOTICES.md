# Third Party Notices

Este produto inclui trechos de código copiados ou adaptados de projetos de terceiros
licenciados sob a licença MIT. O aviso de copyright e a permissão de cada titular
acompanham o respectivo código, conforme exigido pela licença.

O manifesto completo do que pode ser reaproveitado, com origem, modo (copiar, adaptar
ou ler), destino e fase, está na seção 13 de `docs/planejamento_dungeon_master_v0.4.md`.

## Regras (seção 13.0 do planejamento)

1. Nada é vendorizado como subsistema. Somente utilitários autocontidos, prompts e
   trechos de SQL.
2. Todo arquivo copiado ou adaptado leva o cabeçalho padrão abaixo **e** uma entrada
   nesta página.
3. Testes que acompanham o arquivo de origem são copiados junto e passam a rodar na
   nossa matriz de CI (`windows-latest` + `macos-latest`).
4. Antes de copiar, verificar imports de `bun:` / `Bun.` (Archon) e de `effect`
   (Sandcastle), e removê-los.
5. Commits de referência ficam fixados na tabela de projetos; qualquer atualização
   futura compara contra eles.

Cabeçalho padrão de todo arquivo copiado ou adaptado:

```ts
// Adapted from <projeto> — <caminho no repositório de origem>@<commit>
// Copyright (c) <ano> <titular>. Licensed under the MIT License.
// Changes: <resumo das adaptações feitas aqui>
```

## Projetos de referência e commits fixados

| Projeto                                                                          | Titular     | Licença | Commit fixado       | Data       |
| -------------------------------------------------------------------------------- | ----------- | ------- | ------------------- | ---------- |
| [Sandcastle](https://github.com/mattpocock/sandcastle)                           | Matt Pocock | MIT     | `e99f832` (v0.12.0) | 29/06/2026 |
| [Archon](https://github.com/coleam00/Archon)                                     | Cole Medin  | MIT     | `0773b97`           | 01/09/2026 |
| [TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) | Tencent     | MIT     | `3efcd31`           | 31/08/2026 |

## Entradas

Cada arquivo importado recebe uma entrada nesta seção, no formato abaixo.

```text
### <caminho no nosso repositório>

- Origem: <projeto> — <caminho no repositório de origem>@<commit>
- Copyright: (c) <ano> <titular>. Licensed under the MIT License.
- Modo: copiar | adaptar
- Fase: <n>
- Changes: <resumo das adaptações>
```

Os demais itens de Fase 0 do manifesto (transport SSE e poller adaptados para Hono,
gatilho de NOTIFY, regra de lint do frontend) entram junto com `packages/events` e o
SSE da API.

### Archon — packages/platform

#### `packages/platform/src/process-tree.ts`

- Origem: Archon — `packages/cli/src/utils/detached-run-control.ts@0773b97`, linhas 454–572
- Copyright: (c) 2026 Cole Medin. Licensed under the MIT License.
- Modo: adaptar (extrair)
- Fase: 0
- Changes: extraídos só `processExists`, `waitUntilGone`, `processGroupExists`,
  `commandTerminatedBySignal` e a terminação por sistema operacional; o IPC por socket
  e a lease de execução, que são o resto do arquivo, não vieram.
  `terminateDetachedProcessTree` virou `terminateProcessTree` e devolve
  `TerminationResult` em vez de lançar: o contrato passou a ser nunca lançar por causa
  do alvo, vivo ou morto, e lançar só por argumento inválido. As esperas viraram
  parâmetros (`graceMs`, `confirmMs`). No POSIX, um alvo que não lidera grupo nenhum
  deixou de ser erro e passa a ser sinalizado sozinho. Mensagens em português.

#### `packages/platform/src/path-validation.ts` e `path-validation.test.ts`

- Origem: Archon — `packages/core/src/utils/path-validation.ts@0773b97` e o `.test.ts` ao lado
- Copyright: (c) 2026 Cole Medin. Licensed under the MIT License.
- Modo: adaptar
- Fase: 0
- Changes: a raiz permitida deixou de vir de `@archon/paths` e virou o primeiro
  argumento, porque aqui a restrição é por working directory de Run e não por um
  diretório global; `isPathWithinWorkspace` virou `isPathWithinRoot`. A comparação
  passou a ser case-insensitive no Windows e no macOS, onde o sistema de arquivos é
  case-insensitive por padrão. Acrescentados `normalizeAbsolutePath`, `isInside` e
  `samePath`. No teste, `bun:test` virou Vitest, os casos deixaram de depender de
  variáveis de ambiente do Archon e os caminhos literais POSIX viraram caminhos válidos
  no sistema que estiver rodando, para o mesmo arquivo servir Windows e macOS.

### Sandcastle

#### `tooling/vitest/git-isolation.ts`

- Origem: Sandcastle — `src/testSetup.ts@e99f832`
- Copyright: (c) 2026 Matt Pocock. Licensed under the MIT License.
- Modo: copiar
- Fase: 0
- Changes: comentários traduzidos para o português; nenhuma mudança de comportamento.
  O arquivo não tinha import de `effect` para remover. O teste que prova o isolamento
  (`tooling/vitest/test/`) é nosso: o original não tinha um.

## Licença deste projeto

Dungeon Master é distribuído sob a licença MIT. Veja [`LICENSE`](./LICENSE).
