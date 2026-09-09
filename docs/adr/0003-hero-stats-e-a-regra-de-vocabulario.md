# ADR 0003 — `hero_stats` e a regra de vocabulário temático

- **Status**: proposto — aguarda decisão do dono do projeto
- **Data**: 08/09/2026
- **Contexto**: rodada de correção documentação × código de 08/09/2026; seção 1 do
  [`CLAUDE.md`](../../CLAUDE.md) ("o tema é um skin e **nunca** entra no código").
- **Decide**: se a projeção de Conquistas é renomeada para vocabulário canônico, ou se a
  regra da seção 1 passa a admitir explicitamente o que ela hoje proíbe.

Este ADR **não** executa nada. Ele levanta a superfície, mede o custo e recomenda. A
mudança atravessa banco, contrato, API e web ao mesmo tempo e é decisão do dono do
projeto, não de quem auditou.

## O achado

A regra da seção 1 do `CLAUDE.md` diz:

> Nunca escreva `campanha`, `missao`, `expedicao`, `heroi`, `guilda`, `grimorio`,
> `espolio` ou `monstro` em nome de tipo, tabela, coluna, evento, rota ou chave de JSON.

A projeção de Conquistas faz exatamente isso, em inglês, nas cinco camadas que a regra
enumera — tipo, tabela, coluna, evento e rota — e mais uma que ela não previu: a chave do
glossário.

A prova mais curta de que é o tema, e não uma escolha de domínio, está no próprio
glossário. `packages/glossary/src/plain.ts` — o modo **sem tema** — traduz:

| Chave                 | `dnd`                 | `plain`         |
| --------------------- | --------------------- | --------------- |
| `hero.expeditions`    | "Expedições"          | "Execuções"     |
| `hero.monstersSlain`  | "Monstros derrotados" | "Bugs resolvidos" |
| `hero.victories`      | "Vitórias"            | "Sucessos"      |
| `hero.xp`             | "Experiência"         | "Pontos"        |

O repositório já sabe que `expeditions` quer dizer "execuções" e que `monstersSlain` quer
dizer "bugs resolvidos". Essa tradução mora no glossário — e o nome da coluna, do campo de
JSON e da rota ficou com o lado errado dela.

## `hero` em inglês viola uma regra que lista termos em português?

É a pergunta que decide o resto, então vai argumentada.

**A leitura literal diz que não.** A lista da seção 1 é de oito palavras em português, sem
acento e no singular: `expedicao`, `heroi`, `monstro`. `expeditions`, `hero` e
`monstersSlain` não estão nela. Por essa leitura o repositório está em dia e não há achado.

**A leitura literal é insustentável**, por três razões:

1. **Ela torna a regra inócua.** Se a proibição é de grafias, ela é contornada por
   tradução. `expedicao` é proibido e `expedition` é permitido — para a mesma entidade, que
   se chama `Run`. Uma regra que qualquer dicionário desarma não é uma regra.

2. **Ela contradiz a frase que a própria seção abre**, que é o comando de verdade: "O tema é
   um skin e **nunca** entra no código." A lista vem depois, introduzida como exemplo do
   vocabulário temático, e a frase seguinte ("Esse vocabulário existe apenas como label da
   interface, vindo de `packages/glossary`") define onde o tema pode morar. O sujeito da
   regra é o **conceito**, não a grafia.

3. **Ela falha no teste operacional que a seção 2 escreve.** "O interruptor de tema troca
   **só texto**. Rotas, URLs, ícones, layout e payloads são idênticos nos dois modos."
   Trocar `dnd` por `plain` hoje não muda `GET /api/v1/heroes/stats`, não muda a coluna
   `monsters_slain` e não muda a chave `expeditions` do JSON. Um consumidor do
   `openapi.json` em modo "sem tema" recebe campos com nome temático. O interruptor não
   troca só texto — logo a regra está furada, em qualquer idioma.

**Conclusão:** sim, é violação. E a **redação** da regra também é defeituosa, porque
listar grafias em português convida exatamente esse erro: quem escreveu `hero_stats`
provavelmente conferiu a lista, não encontrou a palavra e seguiu. Isso vale
independentemente da decisão sobre renomear, e é a correção mais barata deste ADR:

> Nunca escreva o vocabulário temático — Campanha, Missão, Expedição, Herói, Guilda,
> Grimório, Espólio, Monstro — **nem a tradução dele para outro idioma** em nome de tipo,
> tabela, coluna, evento, rota ou chave de JSON. O teste é o da seção 2: se trocar o
> glossário `dnd` pelo `plain` não muda o identificador, mas mudaria o label, então o
> identificador está do lado errado da linha.

## A superfície, identificador por identificador

### Banco (`packages/database`)

| O quê                        | Onde                                                        |
| ---------------------------- | ----------------------------------------------------------- |
| `pgEnum("hero_scope", …)`    | `src/schema/achievement.ts:71`                              |
| `pgTable("hero_stats", …)`   | `src/schema/achievement.ts:266-267`                         |
| coluna `expeditions`         | `src/schema/achievement.ts:277`                             |
| coluna `victories`           | `src/schema/achievement.ts:278`                             |
| coluna `defeats`             | `src/schema/achievement.ts:279`                             |
| coluna `monsters_slain`      | `src/schema/achievement.ts:280`                             |
| coluna `docker_victories`    | `src/schema/achievement.ts:282`                             |
| constraint `hero_stats_scope_uq` | `src/schema/achievement.ts:292`                         |
| FK `hero_stats_user_id_user_id_fk` | gerada, `drizzle/0006_…sql:94`                         |
| tipos `HeroStatsRow` / `NewHeroStatsRow` | `src/schema/achievement.ts:302-303`             |
| `HeroStatsView`, `HeroStatsResult`, `toHeroView`, `readHeroStats` | `src/achievement.ts:857,872,877,901` |
| `heroKey`, `HeroDelta`, o `upsert` e o evento emitido | `src/achievement-projector.ts:636,856,899,908` |
| DDL commitada                | `drizzle/0006_conquistas_projecao_e_stats.sql:5,67,70,74,77,78,83,94` |
| snapshots do journal         | `drizzle/meta/0006`–`0014_snapshot.json` (9 arquivos)       |

### Contrato (`packages/contracts`)

| O quê                                   | Onde                            |
| --------------------------------------- | ------------------------------- |
| `HeroScopeSchema`, id `HeroScope`       | `src/achievement.ts:112-117`    |
| `HeroStatsSchema`, id `HeroStats`       | `src/achievement.ts:127,152`    |
| chave `expeditions`                     | `src/achievement.ts:134`        |
| chave `monstersSlain`                   | `src/achievement.ts:141`        |
| `HeroStatsResponseSchema`, id `HeroStatsResponse` | `src/achievement.ts:156-166` |
| evento `"hero_stats.updated"`           | `src/dashboard-event.ts:74`     |

### API (`apps/api`)

| O quê                            | Onde                          |
| -------------------------------- | ----------------------------- |
| rota `/api/v1/heroes/stats`      | `src/routes/achievements.ts:299` |
| tag OpenAPI `heroes`             | `src/routes/achievements.ts:300` e `src/app.ts:404` |
| `heroStatsRoute`                 | `src/routes/achievements.ts:297` |
| porta `heroStats()`              | `src/ports.ts:488,669`        |
| fiação e handler                 | `src/composition.ts:19,279`, `src/handlers/achievements.ts:65-66` |

### Projeção pura (`packages/achievements`)

`src/projector/hero-stats.ts` — o arquivo inteiro: `HeroStatsState:14`,
`EMPTY_HERO_STATS:31`, os campos `expeditions:18`, `monstersSlain:22`,
`dockerVictories:24`, e `applyRunOutcome`/`applyUsage`.

### Gerados (não se editam; saem do `pnpm gen`)

`packages/api-client/openapi.json` e `packages/api-client/src/schema.d.ts`: os ids
`HeroStats`, `HeroStatsResponse`, `HeroScope`, o caminho `/api/v1/heroes/stats` e as
propriedades `expeditions` e `monstersSlain`.

### Web (`apps/web`)

`src/lib/heroes.ts` (arquivo inteiro: `HeroStatsRecord:20`, `useHeroStats:26`, a chamada
a `/api/v1/heroes/stats:30`), `src/components/hall/heroes-tab.tsx` (`:14,35,82,100,109,126,173,176`),
`src/lib/achievement-toast.tsx:57` (`HERO_STATS_UPDATED`), `src/lib/achievements.ts:207,246`
(`HALL_TABS` com `"heroes"`, `heroKeys`), `src/routes/hall.tsx:10,133,230`.

### Glossário (`packages/glossary`)

As dez chaves `hero.*` em `src/keys.ts:475-484`, com os pares em `src/dnd.ts:461-470` e
`src/plain.ts:461-470`.

### Testes

`apps/api/test/achievements-hall.test.ts:243,248`, `apps/api/test/support.ts:70`,
`apps/worker/test/support.ts:306`, `packages/database/test/achievements.test.ts:67,296,315,441,447,448`,
`packages/database/test/knowledge.test.ts:105`,
`packages/achievements/src/projector/hero-stats.test.ts`,
`apps/web/src/components/hall/heroes-tab.test.tsx`.

## O nome canônico proposto

`agent_stats` — a sugestão da auditoria — tem um problema: a tabela é escopada por
`hero_scope`, que vale `AGENT` **ou** `LOADOUT` (`src/schema/achievement.ts:273`). Chamá-la
de `agent_stats` mente sobre metade das linhas. A proposta é:

| Hoje                    | Proposto                       |
| ----------------------- | ------------------------------ |
| `hero_stats`            | `execution_stats`              |
| `hero_scope`            | `execution_stats_scope`        |
| `expeditions`           | `runs_total`                   |
| `victories`             | `runs_succeeded`               |
| `defeats`               | `runs_failed`                  |
| `monsters_slain`        | `bug_tasks_completed`          |
| `docker_victories`      | `docker_runs_succeeded`        |
| `HeroStats`             | `ExecutionStats`               |
| `HeroStatsResponse`     | `ExecutionStatsResponse`       |
| `GET /api/v1/heroes/stats` | `GET /api/v1/execution-stats` |
| `hero_stats.updated`    | `execution_stats.updated`      |
| chaves `hero.*`         | `executionStats.*`             |

Duas colunas ficam num meio-termo e merecem decisão à parte: **`xp` e `level`**. O `plain`
traduz `hero.xp` para "Pontos", então pelo teste da seção 2 elas também estão do lado
errado. Mas "xp" e "level" são vocabulário genérico de gamificação, não do tema de RPG de
mesa que o glossário troca. A recomendação é **mantê-las**, e dizer isso por escrito no
`CLAUDE.md` em vez de deixar por omissão.

## O custo

**Migração `0015`.** A última entrada do journal é a `0014_indices_do_projetor_de_conquistas`
(`packages/database/drizzle/meta/_journal.json`, 15 entradas, `idx` 0 a 14). A `0015` seria
escrita à mão — o gerador do Drizzle não emite `RENAME`, ele emite `DROP` mais `CREATE`, o
que apagaria os dados. Conteúdo: `ALTER TABLE … RENAME TO`, sete `RENAME COLUMN`,
`ALTER TYPE … RENAME`, o rename da constraint única, e um `UPDATE dashboard_event SET
type = 'execution_stats.updated' WHERE type = 'hero_stats.updated'` para o histórico não
ficar órfão de um filtro que a web faz por string.

**`pnpm gen`** regenera `openapi.json` e `schema.d.ts`; **`pnpm db:check`** confirma que o
schema e as migrações voltaram a bater.

**O que quebra para quem já tem dados.** Muito menos do que parece, por três razões:

1. O sistema é **single-user e local**. Não há cliente externo do `openapi.json` para
   quebrar: o único consumidor é `packages/api-client`, que é gerado no mesmo commit.
2. `hero_stats` é **projeção**, não dado de origem. A seção 12 do `CLAUDE.md` garante que
   ela é "calculada a partir de eventos já persistidos, idempotente, reconstruível do zero",
   e existe o comando que faz isso: `pnpm dm achievements rebuild`. Se a migração de rename
   der errado, a saída é dropar e reprojetar — não há perda irrecuperável.
3. As linhas antigas de `dashboard_event` são histórico de painel. O `UPDATE` acima resolve;
   sem ele, o pior caso é um toast que não aparece para eventos de antes da migração.

O que de fato custa é a **largura**: um commit único tocando `contracts`, `database`,
`achievements`, `api`, `api-client` (gerado), `web` e `glossary`, mais a migração à mão.
Não dá para fatiar sem deixar o repositório vermelho no meio, porque o contrato é a fonte
do cliente que a web importa.

## Decisão recomendada

**Mudar o código: renomear.** As três razões, em ordem de peso:

1. **O custo só cresce.** A regra existe porque um nome temático em contrato público é caro
   de desfazer. Hoje o consumidor do `openapi.json` é um só e é gerado. Na Fase 8, com
   Loadouts avançados, Skills e Tools, e com qualquer integração externa, deixa de ser.
   Este é o momento mais barato que vai existir.

2. **A alternativa não é neutra.** Abrir uma exceção para "a projeção de Conquistas", do
   jeito que a seção 5 abriu para "pacotes puros com schemas próprios", parece simétrico mas
   não é: a exceção da seção 5 é sobre **onde um schema mora**, e não muda o que o schema
   diz. Uma exceção aqui muda o que o produto expõe — e a fronteira dela é indefensável. A
   Conquista pode ter nome temático porque **é** o tema (a regra já diz isso: "e nos nomes e
   textos de Conquistas"). A contagem de Runs bem-sucedidos de um Agent não é o tema; é
   `Run` e `Agent`, que estão na lista canônica.

3. **O repositório já discorda de si mesmo.** O `plain.ts` traduz `expeditions` para
   "Execuções". Manter a coluna `expeditions` é manter, no schema, um nome que o próprio
   projeto documenta como sendo a versão temática de outro.

**Junto, e independentemente:** corrigir a redação da seção 1 para falar de conceito e não
de grafia, com o teste operacional explícito. Sem isso o próximo `guild_settings` ou
`loot_table` passa pela mesma porta.

**Quando:** não nesta rodada de correção. Como uma tarefa própria, com o repositório
parado nas sete áreas, porque é um commit largo e atômico.

### A saída alternativa, se a decisão for o contrário

Se o dono preferir **mudar a regra**, o mínimo honesto é uma exceção nomeada e delimitada
na seção 1 — não um silêncio. Algo como: "Exceção: a projeção de Conquistas
(`hero_stats` e a rota `/api/v1/heroes/stats`) usa vocabulário temático em inglês por
decisão registrada no ADR 0003. A exceção não se estende a nenhuma outra tabela, rota ou
contrato." O que não pode continuar é a regra dizer "nunca" enquanto o repositório faz.
