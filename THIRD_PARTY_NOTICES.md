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

_Nenhuma entrada até o momento._ A Fase 0 do esqueleto do monorepo não copiou código
de terceiros. Os itens de Fase 0 do manifesto (terminação de árvore de processos e
validação de caminho do Archon, isolamento de gitconfig do Sandcastle, transport SSE
e poller adaptados para Hono, regra de lint do frontend) entram junto com
`packages/platform`, `packages/events` e o SSE da API.

## Licença deste projeto

Dungeon Master é distribuído sob a licença MIT. Veja [`LICENSE`](./LICENSE).
