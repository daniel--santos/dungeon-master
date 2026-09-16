# Planejamento de Implementação — Dungeon Master

**Plataforma pessoal de trabalho com agentes de IA, com um toque de RPG de mesa.**

**Versão:** 0.5  
**Data:** 15/09/2026  
**Status:** Pronto para iniciar a Fase 11  
**Substitui:** `planejamento_dungeon_master_v0.4.md` (Fases 0 a 10, executado por inteiro; mantido como histórico com os blocos de andamento e de fechamento de cada fase)  
**Documento companheiro:** `documentacao_ideia_e_fundamentos_tecnicos.md` (v0.4, revisão 0.5)  
**Lista-fonte:** `proximos_passos_e_ideias.md` (o que ficou em aberto e as ideias ainda sem fase)

---

## 0. O que mudou

### 0.1 v0.4 → v0.5

| Tema | v0.4 | v0.5 | Motivo |
|---|---|---|---|
| Natureza | construir o sistema, fase a fase, do monorepo à observabilidade | fechar as dívidas que as onze fases deixaram e provar em Docker o que só foi provado no host | O produto existe; o que falta é robustez, não funcionalidade nova |
| Fases | 0 a 10 | 11 a 15, numeradas em sequência, mais uma frente transversal de operação | Post-mortems, migrações e blocos de fechamento continuam numa sequência só |
| Tamanho | fases grandes com três ondas (A backend, B worker, C web) | fases pequenas com uma ou duas ondas; só a Fase 14 é grande | Dívida pequena fecha em uma onda; uma onda por fase reduz merges e conflitos |
| Ordem | pela dependência entre capacidades | pelo custo de carregar a dívida: contrato e métricas primeiro, Docker por último | Cada fase seguinte herdaria os schemas anônimos e os buracos das métricas |
| Vocabulário | regra reescrita no meio (ADR 0003) | regra estável desde o começo: tema só textual, identificador canônico em qualquer idioma | Nenhuma fase do v0.5 cria identificador temático |
| Fora do MVP | ranking, recompensas que destravam funcionalidade, economia de itens, LLM no caminho quente | os mesmos, mais Worker remoto, embeddings e artefatos grandes, que ficam como ideias | Manter o v0.5 curto |

### 0.2 O que o v0.4 entregou

Onze fases entre 07/09 e 15/09/2026, com o CI verde em Windows e macOS a cada merge: execução em quatro Guildas (Claude Code, Codex, Pi, Antigravity), no host e em Masmorra selada para Claude Code e Pi; Worker com fila, travas, cancelamento, retomada, presença por batimento e reconciliação por silêncio; Rituais com Selo por CAS; Pistas e Mapa da Campanha; Grimório com Distiller e revisão; Provisões congeladas por Expedição e MCP de conhecimento; Arsenal com Habilidades versionadas, Itens, Relíquias, Patronatos e Equipamento por referência com preflight; Autonomia com Rédea, Éditos, Tesouros, Sentinelas, Encaminhamentos e delegação restart-safe; Conquistas como projeção; métricas, custo com procedência e Torre de Vigia. Vinte e uma migrações (`0000` a `0020`), 28 post-mortems no código, três ADRs.

---

## 1. Ponto de partida

- `main` com CI verde nos dois sistemas; 18 pacotes; próxima migração **`0021`**; próximo post-mortem **#29**; próximo ADR **0004**.
- As regras do `CLAUDE.md` valem sem exceção: nomes canônicos (seção 1), tema só pelo glossário (2), fronteiras por lint (3), migração para toda mudança de schema e nunca no banco compartilhado antes do merge (4), artefatos gerados commitados (5), verificação completa antes de entregar e processos derrubados só pelo PID (6), versões exatas (7), Windows e macOS de primeira classe (8), post-mortem em comentário numerado (9), atribuição de terceiros (10), commits convencionais em português (11), fora de escopo por padrão (12).
- Método que funcionou no v0.4 e continua: um worktree e uma branch por agente, criados pelo orquestrador; agentes nunca fazem merge nem push; brief completo com as regras, a verificação obrigatória e a prova manual com Claude Code real em banco irmão e portas próprias; relatório curto; merge `--no-ff` pelo orquestrador com verificação completa, e2e, push conferindo o remoto, CI conferido por job e escolhido pelo SHA, migração no banco de desenvolvimento, bloco de andamento no plano e memória. Quando uma fase tem onda web, ela parte da branch da onda backend assim que os contratos ficam prontos, sem esperar o merge, com a ordem de não reescrever histórico e avisar mudança de contrato.
- Toda fase termina com um bloco `## Fechamento da Fase N` neste arquivo: critério cumprido e como foi provado, o que entrou por onda, correções no fechamento, pendências que ficam. Pendência que não entra em fase nenhuma volta para `proximos_passos_e_ideias.md`.

---

## 2. As fases

### Fase 11 — Higiene de contrato

**Objetivo.** Nenhum schema com `.meta({ id })` fica embutido na spec; nenhum campo de contrato registrado como pendência nas Fases 5 a 10 continua faltando. É a fase que impede que toda fase seguinte herde a mesma dívida.

**Entregas.**

- [ ] Componentes nomeados para `ProviderAuth`, `CliPreflight`, `PolicyDecision`, `BreakerAdmission`, `RoutingDecision`, `HarnessAuthStatus` e `AchievementRarity`. Onde a causa for o `.nullable()` que perde o `id`, a correção é a união com `z.null()`; onde o nome nunca existiu, é o `.meta({ id })` na fonte única (o pacote puro, quando o schema mora nele).
- [ ] Um teste de spec em `apps/api` que percorra **todos** os schemas registrados com `.meta({ id })` nos contratos e nos pacotes puros e falhe para cada um que não esteja em `components.schemas`. Conferido vermelho antes da correção.
- [ ] `ProposedTask.decidedBy` (`USER | POLICY:<id>`), gravado na decisão e exposto em `GET /proposals` e no diário do Run; migração `0021` (`proposed_task.decided_by`).
- [ ] `GET /runs?parentRunId=` e `GET /runs?createdBy=`; `BreakerAdmission.openedAt`.
- [ ] `GET /runs/{id}/context` distingue "Run não existe" (`404`) de "Run sem contexto" (`204` ou `200` com `context: null`, decidido no bloco de andamento e registrado no problem details).
- [ ] `Harness.authStatus` e `authReason` obrigatórios no contrato; fixtures da web atualizadas.
- [ ] `MODEL_SELECTION_UNSUPPORTED` só avisa quando o Model foi escolhido de fato, não quando é o padrão da Guilda.
- [ ] Cliente regenerado; a web troca todo tipo derivado do pai (`Provider["billingKind"]`, `AchievementDefinition["rarity"]`, `ProviderAuthRecord`, `CliPreflightRecord`) pelo componente.

**Ondas.** Uma só (`feat/fase11-contratos`, agente `fase11-contratos`): contratos, API, migração `0021`, cliente e os ajustes de tipo na web. Sem tela nova.

**Critério de conclusão.** O teste de spec passa com zero schemas embutidos; `gen:check` e `db:check` verdes; a web compila sem nenhum tipo derivado do pai para esses schemas; uma Pista aprovada por Édito aparece com `decidedBy: POLICY:<id>` na API e no diário.

**Riscos.** Mudar a forma de um campo na spec muda o `schema.d.ts` inteiro; os valores não mudam, então o risco é só de compilação, coberto pelo `typecheck` do monorepo.

### Fase 12 — Métricas, segunda volta

**Objetivo.** As lacunas que a Torre de Vigia expôs: tokens por passo, custo de assinatura por Campanha, Model chaveado por identidade, retenção e exportação.

**Entregas.**

- [ ] **Tokens por passo.** `run_step_metric` (uma linha por `run_step` terminal: tipo, chave, tokens in/out/cache com a regra de acumulado por tentativa da Fase 10A, duração, ferramentas por servidor), projetada no mesmo lote de `run_metric` e reconstruída pelo mesmo `rebuild`; `RunMetrics.steps` passa a trazer tokens e duração por passo; migração `0022`.
- [ ] **Rateio de assinatura por Campanha.** Na leitura, a mensalidade do Provider é rateada Run a Run pela fatia de tokens de cada Run no mês do Provider; a soma por Project é a soma dos seus Runs. O rótulo continua `ESTIMATED_SUBSCRIPTION`; o total global não muda. Fica documentado que a fatia de um Run muda até o mês fechar.
- [ ] **Dimensão `MODEL` por identidade.** A chave do rollup passa a ser o `model.id`, e a série resolve chave e nome do Model e da Guilda; dois Harnesses com a mesma chave viram duas linhas. Rebuild obrigatório após a migração (o `db:migrate` avisa; `pnpm dm metrics rebuild` faz).
- [ ] **Retenção.** `METRICS_RETENTION_DAYS` (padrão 730) e `pnpm dm metrics prune`, que apaga `run_metric` e `run_step_metric` mais antigos que o prazo e mantém `metric_daily` para sempre; o `rebuild` depois do `prune` só reconstrói o que ainda tem fonte, e isso fica dito na tela.
- [ ] **Semente de cobrança.** Providers conhecidos nascem com `billing_kind` (`SUBSCRIPTION` para os que só vendem assinatura, `PER_TOKEN` para os demais) e sem preço; o custo continua `NOT_MEASURED` até haver preço ou mensalidade.
- [ ] **Exportação.** `GET /metrics/series` e `GET /metrics/costs` respondem `text/csv` por `Accept`, e a tela ganha o botão; nada de biblioteca nova.
- [ ] **Varredura de labels.** A varredura aceita chave cujo texto é idêntico nos dois glossários em vez de exigir `SKIPPED_KEYS`; a lista de exceções esvazia.
- [ ] Web: tokens e duração por passo na aba de Medidas; custo por Campanha com o rateio; exportação; nome do Model com a Guilda ao lado na quebra por dimensão.

**Ondas.** `feat/fase12-metricas` (12A, backend: migração `0022`, projeção, rotas, CLI) e `feat/fase12-web` (12B, web e e2e), a segunda partindo da primeira assim que os contratos estiverem prontos.

**Critério de conclusão.** Um Run real de Claude Code com Ritual de três passos aparece no cockpit com tokens por passo somando os tokens do Run; uma Campanha com Provider por assinatura mostra custo rateado, e a soma das Campanhas bate com o total global; `rebuild` reproduz linha por linha antes e depois do `prune`; o CSV abre com os mesmos números da tela.

### Fase 13 — Execução robusta

**Objetivo.** Os comportamentos do Worker e da API que as provas manuais das Fases 9 e 10 mostraram frágeis, sem tela nova.

**Entregas.**

- [ ] **Delegação sobrevive a restart com o filho em voo.** Na retomada, um passo `delegate` em `WAITING_CHILD` reencontra o filho por `parent_run_id` + `parent_step_key` em vez de assentar `DELEGATION_FAILED`; se o filho já terminou, consome o resultado; se ainda roda, volta a esperar. `retry` passa a valer para `delegate`, criando um filho novo com `attempt` maior.
- [ ] **Orçamento `PER_RUN` mede a família**: mãe mais filhos, em `GET /budgets/{id}/usage` e na re-checagem por passo.
- [ ] **`dispatch.skipped` uma vez por motivo**: o evento sai quando o motivo muda, não a cada reavaliação; o motivo atual fica na Task.
- [ ] **`await_run` por notificação**: `LISTEN` no canal de desfecho de Run com sondagem de segurança a cada 15 s, em vez de consulta a cada segundo.
- [ ] **Task filha explícita**: `taskStrategy: CHILD` aceita `kind` e `priority`; sem eles, herda e diz no diário que herdou.
- [ ] **Parada pedida pelo banco.** `worker.stop_requested_at` (migração `0023`) e `pnpm dm worker stop <id>`: o Worker lê a própria linha a cada batimento e inicia o desligamento gracioso, que hoje só um `Ctrl+C` num console de verdade consegue disparar no Windows. Com isso o caminho `stopped_at` → `OFFLINE` é provado à mão nos dois sistemas.
- [ ] **Token do MCP em cabeçalho** (`Authorization: Bearer`), não no caminho da URL; `envKeys` para servidores MCP `HTTP` do registro, injetados como cabeçalhos nomeados.
- [ ] **Testes que oscilam**: `pi@host` isolado das outras suítes de contrato por semáforo de porta; `tasks.test.ts` "sort=createdAt" com carimbos distintos por construção.

**Ondas.** Uma só (`feat/fase13-execucao`, agente `fase13-execucao`): workflow, worker, database, orchestration-mcp, contratos e API onde a forma muda. A web só troca o que os contratos mudarem.

**Critério de conclusão.** Provado com Claude Code real: um Ritual `analyze → delegate → execute` sobrevive à derrubada do Worker com o filho em voo e termina usando a saída do filho; `pnpm dm worker stop` leva o Worker a `OFFLINE` no Windows e no macOS sem sinal de console; `await_run` responde em menos de um segundo após o desfecho sem consulta em laço no log do banco.

### Fase 14 — Masmorra de verdade

**Objetivo.** Tudo o que só foi provado no host passa a ser provado em Docker, ou fica declarado como não suportado com o motivo medido pelo preflight. É a única fase grande do v0.5 e merece o ADR 0004.

**Entregas.**

- [ ] **ADR 0004 — passos de comando e validação em Docker.** Decide onde `command` e `validation` rodam quando o Run é `DOCKER`: dentro do mesmo container do agente, por `docker exec`, com a allow-list do perfil e o worktree montado. Hoje são fail-closed.
- [ ] **`command` e `validation` em Docker**, conforme o ADR, com o mesmo diário e o mesmo `Diagnostic` do host.
- [ ] **Delegação em Docker.** O `orchestration-mcp` dentro do container alcança a API do host por `host.docker.internal` com o token do Run em cabeçalho (Fase 13); `delegate_task` e `await_run` provados com Claude Code em Masmorra selada.
- [ ] **Credencial por Provider no boot em Docker.** O Worker mede a autenticação de cada Guilda também na imagem, com o mesmo comando local e sem saída bruta no log; `GET /harnesses` mostra os dois modos.
- [ ] **Antigravity.** O preflight `DOCKER` mede o Antigravity e devolve o motivo (`dockerExecution: false` do ADR 0002) como `CAPABILITY_BLOCKED` explicado, em vez de não medir.
- [ ] **Codex no Windows.** Investigar e resolver o commit barrado pelo sandbox (configuração de sandbox por perfil ou execução do commit pelo Worker fora do sandbox, decidido no bloco de andamento).
- [ ] **Suíte de contrato sem cota.** `contract-docker` roda contra um provedor de teste na imagem (o harness falso do repositório dentro do container) e a suíte real com Gemini passa a ser opcional por variável, para o CI local não depender de cota.
- [ ] **Desligamento gracioso dentro do container** e `OFFLINE` provado com o Worker em Docker.

**Ondas.** `feat/fase14-docker-passos` (14A: ADR, `command`/`validation`, credencial no boot), `feat/fase14-docker-delegacao` (14B: delegação, Antigravity, Codex), `feat/fase14-contrato` (14C: suíte de contrato sem cota, desligamento). 14B e 14C em paralelo depois da 14A.

**Critério de conclusão.** Um Ritual com `command`, `validation` e `delegate` termina inteiro em Masmorra selada com Claude Code; o boot do Worker mostra as Guildas autenticadas nos dois modos; o Antigravity em Docker falha antes de partir com o motivo escrito; `pnpm turbo run test` local passa sem nenhuma cota externa.

**Riscos.** Docker Desktop no Windows precisa estar de pé para a prova manual; a máquina de desenvolvimento reinicia por atualização e o Docker não volta sozinho (registrado na operação). O CI não tem Docker Linux, então a prova em Docker continua manual e descrita no bloco de fechamento.

### Fase 15 — Produto

**Objetivo.** O que ficou de tela quando o backend já está quieto.

**Entregas.**

- [ ] `loadout.purpose` (`GENERAL | DISTILLER`, migração `0024`) e a Nova Expedição pré-selecionando o Equipamento do Escriba quando a Missão é de destilação; a semente marca o "Escriba do Grimório".
- [ ] Sentinelas abertas e Tesouros estourados na Mesa do Mestre e no Hall, com link para a Torre de Vigia filtrada.
- [ ] `GET /search?q=` novo, escopado por usuário, devolvendo Missões, Expedições e Campanhas por título ou id com o tipo de cada resultado; a paleta de comandos passa a consultá-lo além das telas.
- [ ] Conquista desbloqueada e ainda não vista: contador na navegação a partir de `achievement_unlock.seen_at`, zerado ao abrir o Hall.
- [ ] Estado de credencial por Patronato na tela de Patronatos, vindo de `GET /harnesses`, sem depender do preflight de um Equipamento.
- [ ] Glossário com as chaves novas nos dois temas; e2e para cada item.

**Ondas.** `feat/fase15-produto` (15A: `purpose`, `search`, `seen_at` na API) e `feat/fase15-web` (15B), a segunda partindo da primeira.

**Critério de conclusão.** Cada item tem um teste de ponta a ponta verde nos dois temas; a Nova Expedição de uma Missão de destilação abre com o Escriba escolhido; a paleta encontra uma Missão pelo título.

### Operação contínua (transversal)

Sem fase própria; entra em cada fechamento.

- [ ] `pnpm dm dev up | down | status`: sobe API, Worker e web com PIDs guardados em arquivo e os derruba pelos PIDs; sobrevive a reinício por tarefa agendada do Windows (opcional, documentado).
- [ ] `pnpm dm doctor`: Docker no ar, banco migrado até a última, CLIs autenticadas, portas 3333/5173/3399/5273 livres ou ocupadas por quem.
- [ ] Limpeza das branches locais já mescladas ao fechar a Fase 11.
- [ ] Auditoria do código por agente ao fechar cada fase, no molde da rodada de 08/09/2026, com os achados corrigidos antes do fechamento seguinte.

---

## 3. Ordem, paralelismo e tamanho

| Fase | Tamanho | Ondas | Migrações | Depende de | Tela nova |
|---|---|---|---|---|---|
| 11 Higiene de contrato | P | 1 | `0021` | — | não |
| 12 Métricas, segunda volta | P | 2 (web parte da backend) | `0022` | 11 (componentes nomeados) | aba e botão |
| 13 Execução robusta | M | 1 | `0023` | 11 | não |
| 14 Masmorra de verdade | G | 3 (B e C após A) | — | 13 (token em cabeçalho, parada pelo banco) | não |
| 15 Produto | M | 2 | `0024` | 11 | sim |

A Fase 15 pode correr em paralelo com a 13 ou a 14, porque não toca o Worker; a Fase 12 pode correr em paralelo com a 13. Duas fases ao mesmo tempo é o teto: acima disso as migrações disputam número e os merges viram trabalho do orquestrador em vez dos agentes.

---

## 4. Modelo de dados previsto

```text
Fase 11
proposed_task.decided_by          # USER | POLICY:<id>

Fase 12
run_step_metric                   # (run_id, step_key): tipo, tokens in/out/cache, duração, ferramentas por servidor; projeção
metric_daily.dimension_key        # MODEL passa a ser model.id (rebuild obrigatório)

Fase 13
worker.stop_requested_at          # parada pedida pelo banco; lida a cada batimento

Fase 15
loadout.purpose                   # GENERAL | DISTILLER
```

Todas as tabelas de métrica continuam projeções: podem ser truncadas e reconstruídas de `run`, `run_step`, `run_event` e `run_context`.

---

## 5. Glossário: chaves previstas

Só a Fase 15 e a 12B criam chaves novas. As previstas: `metrics.export`, `run.metrics.step.*` (12B); `loadout.purpose.*`, `nav.achievements.unseen`, `home.breakers.open`, `home.budgets.exceeded`, `search.kind.*` (15B). Nenhum identificador novo do v0.5 é temático; os labels temáticos entram só nos dois glossários, com paridade em tempo de tipo.

---

## 6. Critério de encerramento do v0.5

- Zero schemas embutidos na spec, provado por teste.
- Métricas com tokens por passo, custo por Campanha e retenção, reconstruíveis.
- Worker que para por pedido no banco nos dois sistemas e delegação que sobrevive a restart com o filho em voo.
- Ritual inteiro, com comando, validação e delegação, provado em Masmorra selada.
- Cada item de produto com e2e nos dois temas.
- `pnpm dm doctor` e `pnpm dm dev` em uso.

Ao encerrar: bloco "Encerramento do plano v0.5" neste arquivo, `proximos_passos_e_ideias.md` atualizado com o que sobrou, e a decisão sobre um v0.6 (ideias: Worker remoto, alertas de custo em dinheiro, resumo da semana na voz do DM, embeddings, artefatos grandes).

---

## 7. Fora de escopo por padrão

Os mesmos do v0.4 (multi-user, RBAC, Kubernetes, microserviços, Redis, banco vetorial separado, editor visual de Workflow, execução remota, swarms autônomos, ranking, recompensas que destravam funcionalidade, economia de itens, LLM no caminho quente da UI), mais: Worker remoto, embeddings e armazenamento de artefatos grandes, que ficam em `proximos_passos_e_ideias.md` até que uma medição mostre a necessidade.
