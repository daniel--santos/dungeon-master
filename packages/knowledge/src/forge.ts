import { cleanTitle } from "@dungeon-master/context";
import { z } from "zod";

import { sanitizeLlmText } from "./sanitize.js";
import type { ForgedAchievementInput, LlmProvenance } from "./types.js";

/**
 * A forja: o passo opcional do Distiller que propõe uma Conquista única a
 * partir de um resultado notável (planejamento v0.4, Fase 2.5C).
 *
 * Duas metades, e só a segunda fala com o modelo:
 *
 * 1. **O critério é código.** `detectNotableResult` olha fatos que a porta
 *    leu do banco e decide se houve um resultado notável — nêmesis
 *    derrotado, sequência de vitórias num marco, primeira vitória de uma
 *    Guilda, recorde de duração. O modelo nunca decide *se* forja.
 * 2. **O texto é do modelo, na voz do Dungeon Master** (VOICE.md), e passa
 *    por sanitização e teto de tamanho antes de virar linha. A versão sóbria
 *    (`plain`) é escrita pelo código: texto de sabor só existe no tema.
 *
 * A forjada nasce em revisão e a `condition` gravada é uma condição do
 * vocabulário fechado das Conquistas, para que `dm achievements rebuild`
 * reproduza o desbloqueio a partir dos fatos duráveis.
 */

export type NotableKind =
  "NEMESIS_DEFEATED" | "VICTORY_STREAK" | "FIRST_HARNESS_VICTORY" | "DURATION_RECORD";

/** Um Run terminado do Project, como a forja o enxerga. */
export interface NotableRun {
  readonly runId: string;
  readonly taskId: string;
  readonly taskTitle: string;
  readonly taskKind: "BUG" | "FEATURE" | "RESEARCH" | "CHORE";
  readonly taskStatus: string;
  /** Quantas vezes a Task saiu de `COMPLETED`. Zero até "reabrir" existir. */
  readonly reopenings: number;
  readonly status: "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED";
  readonly harnessKey: string;
  /** O slug da Guilda no vocabulário das Conquistas (`claude`, `codex`, ...). */
  readonly harnessSlug: string;
  readonly harnessName: string;
  readonly durationMs: number | null;
  readonly finishedAt: string;
}

export interface NotableFacts {
  readonly projectId: string;
  readonly projectTitle: string;
  /** Os Runs terminados desde o lote anterior, do mais antigo ao mais novo. */
  readonly runs: readonly NotableRun[];
  /** Vitórias seguidas no Project, contando as de `runs`. */
  readonly victoryStreak: number;
  /** Runs de `runs` que são a primeira vitória do usuário com a Guilda deles. */
  readonly firstVictoryRunIds: readonly string[];
  /** Maior duração de um Run vitorioso do Project antes de `runs`. */
  readonly previousBestDurationMs: number | null;
  /** Quantos Runs vitoriosos o Project teve antes de `runs`. */
  readonly previousSuccessCount: number;
  /** Expedições terminadas desde a última forjada. `null` quando nunca houve uma. */
  readonly runsSinceLastForge: number | null;
}

export interface NotableResult {
  readonly kind: NotableKind;
  readonly runId: string;
  readonly taskId: string;
  /** O fato, em uma linha canônica, para a proveniência. */
  readonly detail: string;
  /** O fato no vocabulário do tema, para o prompt. */
  readonly themedFact: string;
  readonly plainName: string;
  readonly plainDescription: string;
  readonly icon: string;
  readonly rarity: "COMMON" | "RARE" | "EPIC" | "LEGENDARY";
  readonly condition: unknown;
}

/** Os marcos de sequência que valem uma forjada: 10, 25, 50, 100 e a cada 100. */
export function isStreakMilestone(length: number): boolean {
  if (length < 10) return false;
  if (length === 10 || length === 25 || length === 50) return true;
  return length % 100 === 0;
}

/** O rate limit: a primeira forjada é livre; as seguintes esperam N Expedições. */
export function isForgeAllowed(facts: NotableFacts, forgeEveryNRuns: number): boolean {
  if (facts.runsSinceLastForge === null) return true;
  return facts.runsSinceLastForge >= forgeEveryNRuns;
}

const PLAIN_MAX_LENGTH = 120;

function plain(text: string): string {
  return text.length <= PLAIN_MAX_LENGTH ? text : `${text.slice(0, PLAIN_MAX_LENGTH - 1)}…`;
}

export function formatDurationPt(ms: number): string {
  const totalSegundos = Math.round(ms / 1000);
  const horas = Math.floor(totalSegundos / 3600);
  const minutos = Math.floor((totalSegundos % 3600) / 60);
  const segundos = totalSegundos % 60;
  if (horas > 0) return `${String(horas)} h ${String(minutos)} min`;
  if (minutos > 0) return `${String(minutos)} min ${String(segundos)} s`;
  return `${String(segundos)} s`;
}

/**
 * Houve resultado notável neste lote? Na ordem de prioridade: nêmesis,
 * sequência, primeira vitória de Guilda, recorde. Só o gatilho é olhado; o
 * rate limit é de `isForgeAllowed`.
 */
export function detectNotableResult(facts: NotableFacts): NotableResult | null {
  const vitorias = facts.runs.filter((run) => run.status === "SUCCEEDED");
  const ultima = vitorias[vitorias.length - 1];
  // post-mortem #21 (2026-09-08): título de Task e de Project entravam crus no
  // `themedFact` (daí no prompt da forja, que não escapa nada), no `detail` e
  // nas duas versões sóbrias, que o banco gravava só com `sanitizeCredentials`.
  // Um título de Task **é** texto de modelo quando a Task nasceu de um
  // `discoveredTasks`, e um com quebra de linha e `## Saída` no meio abria uma
  // seção nova no prompt. `cleanTitle` é a mesma função do montador de
  // contexto: sanitiza, deixa numa linha e corta no teto.
  const projeto = cleanTitle(facts.projectTitle);

  const nemesis = vitorias.find(
    (run) => run.taskKind === "BUG" && run.taskStatus === "COMPLETED" && run.reopenings >= 2,
  );
  if (nemesis !== undefined) {
    const missao = cleanTitle(nemesis.taskTitle);
    return {
      kind: "NEMESIS_DEFEATED",
      runId: nemesis.runId,
      taskId: nemesis.taskId,
      detail: `Task BUG "${missao}" reaberta ${String(nemesis.reopenings)} vezes concluída pelo Run ${nemesis.runId}.`,
      themedFact: `O Monstro «${missao}», reaberto ${String(nemesis.reopenings)} vezes, foi derrotado de vez pela Expedição de hoje.`,
      plainName: plain("Bug reaberto resolvido"),
      plainDescription: plain(
        `Concluir a Task "${missao}", um BUG reaberto ${String(nemesis.reopenings)} vezes, com um Run bem-sucedido.`,
      ),
      icon: "skull",
      rarity: "EPIC",
      condition: {
        predicate: "first",
        source: "run.succeeded",
        filter: { "task.id": nemesis.taskId, "task.kind": "BUG" },
      },
    };
  }

  if (ultima !== undefined && isStreakMilestone(facts.victoryStreak)) {
    const n = facts.victoryStreak;
    return {
      kind: "VICTORY_STREAK",
      runId: ultima.runId,
      taskId: ultima.taskId,
      detail: `${String(n)} Runs bem-sucedidos seguidos no Project "${projeto}", fechados pelo Run ${ultima.runId}.`,
      themedFact: `${String(n)} Expedições vitoriosas seguidas na Campanha «${projeto}», sem uma derrota no meio.`,
      plainName: plain(`Sequência de ${String(n)} Runs bem-sucedidos`),
      plainDescription: plain(
        `Encadear ${String(n)} Runs bem-sucedidos seguidos no Project "${projeto}".`,
      ),
      icon: "flame",
      rarity: n >= 50 ? "LEGENDARY" : "RARE",
      condition: {
        predicate: "streak",
        source: "run.succeeded",
        length: n,
        filter: { "project.id": facts.projectId },
      },
    };
  }

  const primeira = vitorias.find((run) => facts.firstVictoryRunIds.includes(run.runId));
  if (primeira !== undefined) {
    const guilda = cleanTitle(primeira.harnessName);
    return {
      kind: "FIRST_HARNESS_VICTORY",
      runId: primeira.runId,
      taskId: primeira.taskId,
      detail: `Primeiro Run bem-sucedido com o Harness ${primeira.harnessKey}: ${primeira.runId}.`,
      themedFact: `A primeira Expedição vitoriosa da Guilda ${guilda}, na Missão «${cleanTitle(primeira.taskTitle)}».`,
      plainName: plain(`Primeiro Run bem-sucedido com ${guilda}`),
      plainDescription: plain(`Concluir o primeiro Run bem-sucedido com o Harness ${guilda}.`),
      icon: "swords",
      rarity: "RARE",
      condition: {
        predicate: "first",
        source: "run.succeeded",
        filter: { "run.harness": primeira.harnessSlug },
      },
    };
  }

  if (
    ultima !== undefined &&
    ultima.durationMs !== null &&
    facts.previousBestDurationMs !== null &&
    facts.previousSuccessCount >= 3 &&
    ultima.durationMs > facts.previousBestDurationMs
  ) {
    const duracao = formatDurationPt(ultima.durationMs);
    return {
      kind: "DURATION_RECORD",
      runId: ultima.runId,
      taskId: ultima.taskId,
      detail: `Run bem-sucedido mais longo do Project "${projeto}": ${duracao} (${ultima.runId}), antes ${formatDurationPt(facts.previousBestDurationMs)}.`,
      themedFact: `A Expedição mais longa da Campanha «${projeto}»: ${duracao} até a vitória, na Missão «${cleanTitle(ultima.taskTitle)}». O recorde anterior era ${formatDurationPt(facts.previousBestDurationMs)}.`,
      plainName: plain("Run bem-sucedido mais longo"),
      plainDescription: plain(
        `Concluir um Run bem-sucedido de ${duracao} no Project "${projeto}", o mais longo até então.`,
      ),
      icon: "hourglass",
      rarity: "RARE",
      condition: {
        predicate: "record",
        source: "run.succeeded",
        metric: "run.durationMs",
        direction: "max",
        filter: { "project.id": facts.projectId },
      },
    };
  }

  return null;
}

// --------------------------------------------------------------------------
// O prompt da forjada
// --------------------------------------------------------------------------

export const FORGE_NAME_MAX_LENGTH = 120;
export const FORGE_DESCRIPTION_MAX_LENGTH = 120;
export const FORGE_FLAVOR_MAX_LENGTH = 240;

export const ForgeOutputSchema = z.object({
  name: z.string().describe("O título da carta, no vocabulário do tema. Seco, sem piada."),
  description: z
    .string()
    .describe("Primeira frase: o que desbloqueou. Segunda: um beat de plateia."),
  flavor: z.string().describe("O anúncio no ar: fato, espetáculo, anotação."),
});

export type ForgeOutput = z.infer<typeof ForgeOutputSchema>;

/**
 * A voz do Dungeon Master, condensada de `packages/achievements/VOICE.md`.
 *
 * O texto é original por regra: a série de referência do usuário entra só
 * como tom, e o prompt proíbe explicitamente nome, lugar, bordão, moeda ou
 * patrocinador de obra alheia. O modelo escreve só a versão do tema.
 */
export const FORGE_SYSTEM_PROMPT = `Você escreve o texto de uma Conquista única, na voz do Dungeon Master.

Você NÃO tem tarefa de código. Não leia arquivos, não rode comandos, não use ferramenta nenhuma. Responda só com o JSON pedido no fim.

## Quem fala

O Dungeon Master apresenta uma transmissão, e o Mestre da Guilda (o usuário, tratado por "você") é a atração. Há uma arquibancada assistindo à Campanha: ela aposta, vaia, aplaude na hora errada, esvazia quando fica chato. Há câmera, replay, telão, painel de audiência. Por baixo do apresentador há um burocrata: ele anota, arquiva, classifica, é obrigado por regulamento a entregar o prêmio e não concorda com o regulamento. As duas camadas juntas são a voz: só espetáculo é palhaçada; só burocracia é um funcionário falando sozinho.

## As regras

1. A plateia está presente e tem opinião. Use a reação dela como o veredito que o Dungeon Master finge só reportar.
2. O registro seco vem depois do barulho: "anota: ...", "arquivou", "consta". É o contraste que faz a piada.
3. O prêmio é entregue e desvalorizado no mesmo movimento: a condição foi cumprida de verdade, e a barra era baixa, ou a audiência caiu, ou a parte difícil vem depois.
4. A leitura desfavorável, dita na cara, em segunda pessoa. O alvo é o hábito, a decisão, o número. Nunca a inteligência, o corpo, a saúde ou a vida da pessoa.
5. Um recurso de transmissão por carta: câmera lenta, replay, telão, painel de audiência, arquibancada, vaia, estreia, ao vivo. Não todos.
6. Frases curtas. Fragmentos. O ponto final é a arma.
7. Específico, nunca genérico: use o número exato do fato. Uma frase que serviria para qualquer Conquista não serve para nenhuma.
8. Vocabulário do tema, sempre: Campanha, Missão, Monstro, Expedição, Herói, Guilda, Patrono, Grimório, Espólio, Ritual, Selo da Guilda, Bestiário, Hall dos Heróis, Mestre da Guilda. Nunca Run, Task, harness, Docker, workflow ou projeto.

## Proibido, sem exceção

- Citação, paráfrase, bordão, título, nome de personagem, de lugar ou termo próprio de qualquer obra existente. A transmissão é nossa.
- Patrocinador com nome, marca, moeda, loja, cachê, prêmio comercial. A economia da transmissão não existe.
- Uma entidade narradora com nome próprio: quem fala é o Dungeon Master.
- Exclamação, emoji, entusiasmo de locutor ("Uau", "Incrível"). O apresentador é glib e entediado.
- Vocativo com gênero ou adjetivo flexionado que suponha o gênero de quem lê.
- Lirismo: frase longa, imagem bonita, contemplação. Se caberia num romance, reescreva.

## Anatomia da fala ("flavor")

Três movimentos: o fato, seco, com o número; o espetáculo, o que a transmissão fez e como a plateia reagiu; a anotação, a última frase, a mais curta, onde o burocrata reaparece e desvaloriza o prêmio.

## Os campos

- "name": o título da carta, no vocabulário do tema. Seco, sem piada. Até ${String(FORGE_NAME_MAX_LENGTH)} caracteres.
- "description": primeira frase diz o que desbloqueou; segunda é o beat de plateia. Até ${String(FORGE_DESCRIPTION_MAX_LENGTH)} caracteres.
- "flavor": o anúncio no ar, os três movimentos. Até ${String(FORGE_FLAVOR_MAX_LENGTH)} caracteres.

Escreva em português.

## Saída

{ "name": "...", "description": "...", "flavor": "..." }`;

/**
 * O prompt da carta. Tudo o que entra aqui já veio de `detectNotableResult`,
 * que sanitiza os títulos; `projectTitle` passa de novo porque chega direto
 * dos fatos (post-mortem #21).
 */
export function buildForgePrompt(notable: NotableResult, facts: NotableFacts): string {
  return [
    FORGE_SYSTEM_PROMPT,
    "",
    "---",
    "",
    "## O fato",
    "",
    notable.themedFact,
    "",
    `Campanha: «${cleanTitle(facts.projectTitle)}».`,
    "",
    "Escreva a carta e responda com o JSON.",
  ].join("\n");
}

export interface ForgeInputOptions {
  readonly distillationRunId: string;
  readonly projectId: string;
  readonly provenance: LlmProvenance;
}

/**
 * O texto do modelo vira a linha da forjada — ou `null`, quando algum dos
 * três campos ficou vazio depois da sanitização. Um campo vazio não vira
 * carta: o carregador de Conquistas é fail-closed, e uma definição com nome
 * vazio sumiria do Hall sem explicação.
 */
export function toForgedAchievementInput(
  notable: NotableResult,
  output: ForgeOutput,
  options: ForgeInputOptions,
): ForgedAchievementInput | null {
  const name = sanitizeLlmText(output.name, { maxLength: FORGE_NAME_MAX_LENGTH });
  const description = sanitizeLlmText(output.description, {
    maxLength: FORGE_DESCRIPTION_MAX_LENGTH,
  });
  const flavor = sanitizeLlmText(output.flavor, { maxLength: FORGE_FLAVOR_MAX_LENGTH });

  if (name.length === 0 || description.length === 0 || flavor.length === 0) return null;

  return {
    distillationRunId: options.distillationRunId,
    kind: notable.kind,
    detail: notable.detail,
    projectId: options.projectId,
    runId: notable.runId,
    taskId: notable.taskId,
    name,
    description,
    flavor,
    plainName: notable.plainName,
    plainDescription: notable.plainDescription,
    icon: notable.icon,
    rarity: notable.rarity,
    condition: notable.condition,
    provenance: options.provenance,
  };
}
