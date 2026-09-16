# Próximos passos e ideias — Dungeon Master

**Data:** 15/09/2026  
**Ponto de partida:** plano v0.4 encerrado (Fases 0 a 10 concluídas; `main` com CI verde em Windows e macOS; 21 migrações; 28 post-mortems; ADR 0003 executado)  
**Plano que executa esta lista:** `planejamento_dungeon_master_v0.5.md`

Este arquivo é a lista viva do que ficou em aberto ao fim do v0.4 e das ideias que ainda não viraram fase. Cada item diz de onde veio (a fase que o registrou) e o tamanho estimado (P, M, G). Quando um item entra num plano, ele ganha a referência da fase; quando é feito, sai daqui e fica registrado no bloco de fechamento da fase que o fez.

---

## 1. Higiene de contrato (P) — Fase 11 do v0.5

Dívidas pequenas da spec OpenAPI e dos contratos, que toda fase seguinte herdaria.

- Schemas que aparecem embutidos ou sem nome em `components.schemas`: `ProviderAuth`, `CliPreflight` (Fase 8B), `PolicyDecision`, `BreakerAdmission`, `RoutingDecision` (Fase 9A), `HarnessAuthStatus` (Fase 8B) e `AchievementRarity` (Fase 2.5). Causa conhecida para os dois últimos: `.nullable()` devolve um schema novo sem o `id` do `.meta()`; a correção é a união com `z.null()` (Fase 10A, `BillingKind`).
- `RunToolCalls` é componente, mas `RunMetrics` não expõe tokens por passo (Fase 10B) — ver o tema 4.
- `ProposedTask` sem `decidedBy` (Fase 5).
- `GET /runs` sem filtro `parentRunId` (Fase 9).
- `GET /runs/{id}/context` devolve `404` ambíguo entre "Run não existe" e "Run sem contexto" (Fase 7).
- `BreakerAdmission` sem `openedAt` (Fase 9).
- `Harness.authStatus`/`authReason` ainda opcionais no contrato; deviam ser obrigatórios agora que as fixtures da web os conhecem (Fase 8B).
- `MODEL_SELECTION_UNSUPPORTED` avisa também quando o Model é só o padrão da Guilda (Fase 8/9).
- Um teste de spec que percorra **todos** os schemas com `.meta({ id })` e confira que cada um virou componente, para a classe de erro não voltar.

## 2. Masmorra de verdade (G) — Fase 14 do v0.5

Tudo o que só foi provado no host.

- Delegação entre agentes (`delegate`, `delegate_task`, `await_run`) provada em Docker (Fase 9B).
- Passos `command` e `validation` em modo `DOCKER` são fail-closed hoje (Fase 4/8); precisam rodar dentro do container com a allow-list.
- Preflight `DOCKER` não mede o Antigravity; credencial por Provider não é medida no boot em Docker (Fase 8B; ADR 0002).
- Commit do Codex barrado pelo sandbox no Windows (Fase 2/8).
- `contract-docker` vermelho local por cota do Gemini (Pi em Docker): a suíte de contrato precisa de um provedor de teste que não dependa de cota.
- Desligamento gracioso do Worker dentro do container e `OFFLINE` provado à mão (Fase 10A).

## 3. Execução (M) — Fase 13 do v0.5

- Restart com o filho em voo assenta `DELEGATION_FAILED` sem retentativa; `retry` não vale para `delegate` (Fase 9B).
- `GET /budgets/{id}/usage` em `PER_RUN` mede só o último Run terminal (Fase 9).
- `dispatch.skipped` sai a cada reavaliação, poluindo o painel (Fase 9B).
- `await_run` sonda o banco a cada segundo; devia esperar por `NOTIFY` (Fase 9B).
- Task de `taskStrategy: CHILD` herda tipo e prioridade da mãe (Fase 9B).
- Desligamento gracioso do Worker no Windows: nenhum sinal chega a um processo desanexado; falta um canal próprio (arquivo de parada, pipe nomeado ou Job Object) e a prova manual de `stopped_at` → `OFFLINE` (Fase 10A).
- Token do servidor MCP viaja no caminho da URL; deve ir para cabeçalho (Fase 7).
- Servidor MCP `HTTP` do registro não tem para onde levar `envKeys` (Fase 8A).
- Suíte de contrato `pi@host` oscila sob carga das outras suítes (Fase 8).
- Teste `tasks.test.ts` "sort=createdAt não segue o updatedAt" oscilou uma vez (carimbo no mesmo milissegundo) (Fase 10A).

## 4. Métricas, segunda volta (P) — Fase 12 do v0.5

- Tokens por passo: `RunMetrics.steps` só tem contagem por tipo; falta `run_step_metric` ou colunas por passo em `run_metric` (Fase 10B).
- Rateio de assinatura por Campanha: hoje só no recorte global; precisa de dimensão Project × Provider ou de rateio por Run na leitura (Fase 10A).
- Dimensão `MODEL` chaveada por `model_key`, que é única por Harness; dois Harnesses com a mesma chave compartilham a linha (Fase 10A).
- Retenção de `metric_daily` (Fase 10A).
- Providers do seed nascem sem `billing_kind`; os conhecidos (Anthropic, OpenAI, Google) podiam nascer com o tipo de cobrança e sem preço (Fase 10A).
- Exportação CSV das séries e da quebra (ideia).
- Dez chaves de glossário ficaram em `SKIPPED_KEYS` da varredura de labels por serem palavras idênticas nos dois temas; a varredura devia aceitar chaves iguais nos dois glossários em vez de pular (Fase 10B).

## 5. Produto (M) — Fase 15 do v0.5

- Escriba pré-selecionado na Nova Expedição: falta `purpose` no Loadout (Fase 6/7).
- Sentinelas abertas e Tesouros estourados no Hall e na Mesa do Mestre, não só na Torre de Vigia (Fase 9C/10B).
- Busca na paleta de comandos por Expedição e Missão, não só por telas (Fase 1).
- Aviso de Conquista desbloqueada fora do Hall: toast já existe; falta uma marca persistente até ser vista (Fase 2.5).
- Estado de credencial por Provider visível fora do preflight de um Equipamento (Fase 8B).

## 6. Operação (P) — transversal no v0.5

- App de desenvolvimento como serviço com PIDs guardados, que sobrevive a reinício do Windows (hoje sobe à mão e morre no reboot).
- Limpeza das dezenas de branches locais já mescladas (`feat/fase1-*`, `fix/*`, …).
- Auditoria periódica do código por um agente (a rodada de 08/09 achou 77 itens), como rotina a cada fechamento de fase.
- `pnpm dm` ganhar `doctor`: Docker no ar, banco migrado, CLIs autenticadas, portas livres.

---

## Ideias que ainda não viraram fase

Registradas para não se perder; nenhuma tem prioridade decidida.

- **Worker remoto.** Com presença por batimento e reconciliação por silêncio, um segundo Worker numa outra máquina (um Mac ao lado do Windows) já é seguro; falta só a configuração e a prova. Abre a execução em macOS para Missões que pedem aquele ambiente.
- **Alertas de custo.** Um Tesouro em dinheiro, não só em tokens: com preço vigente por Model, o orçamento pode ser "US$ 20 por semana".
- **Resumo da semana na voz do DM.** Um lote semanal, do Distiller ou das Conquistas, que escreve o que aconteceu na Campanha: Expedições, Monstros abatidos, Páginas do Grimório, custo. Texto por LLM fora do caminho quente, com o mesmo cuidado de voz das Conquistas.
- **Embeddings no Grimório** (questão 7 dos fundamentos): só quando a busca lexical mostrar limite; medir antes.
- **Artifacts grandes** (questão 3 dos fundamentos): decidir filesystem versus armazenamento de objetos quando houver um artefato que não caiba no banco.
- **Skills como pacotes instaláveis.** Importar e exportar Habilidades entre instâncias, com versão e changelog já existentes.
- **Painel por Campanha compartilhável.** Um link somente leitura da Torre de Vigia filtrada por Project, para mostrar a alguém sem abrir a conta.
- **Retomada de Run com worktree sujo.** Hoje é sempre um Run novo; um "continuar de onde parou" com diff do worktree como contexto.

## Ordem recomendada

1. Higiene de contrato (Fase 11) e métricas, segunda volta (Fase 12): pequenas, fecham dívidas, cabem em uma onda cada.
2. Execução (Fase 13): média, sem tela nova.
3. Masmorra de verdade (Fase 14): a única grande; depende de Docker estável na máquina.
4. Produto (Fase 15): o que sobra de tela, com o backend já quieto.
5. Operação: ao longo do caminho, em cada fechamento de fase.
