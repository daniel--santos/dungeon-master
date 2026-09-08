import { and, asc, eq } from "drizzle-orm";

import type { Database } from "./client.js";
import type { DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { DEFAULT_CONTEXT_POLICY, findLoadoutRow } from "./loadout.js";
import {
  agents,
  executionProfiles,
  harnesses,
  type LoadoutRow,
  loadouts,
} from "./schema/execution.js";

/**
 * O Loadout do Escriba do Grimório (planejamento v0.4, Fase 6).
 *
 * O Distiller entra pelo `AgentRuntime` com um Loadout como qualquer
 * Expedição — sem chave de API à parte —, e este é o semeado por padrão:
 * o Agent "Escriba do Grimório", o primeiro Harness ligado que declara
 * `structuredOutput`, e o perfil de execução padrão. O perfil é só
 * referência: o Worker sobrescreve estratégia e permissões na chamada
 * (workspace temporário, nenhum comando liberado), porque o Escriba não
 * executa nada — ele lê o prompt e responde JSON.
 *
 * Idempotente pelo nome, como os cadastros de execução: rodar de novo não
 * duplica, e o que o usuário editou fica. `knowledge.loadoutId` em Settings
 * escolhe outro Loadout; nulo usa este.
 */

export const KNOWLEDGE_SCRIBE_LOADOUT_NAME = "Escriba do Grimório" as const;
export const KNOWLEDGE_SCRIBE_AGENT_NAME = "Escriba do Grimório" as const;

const SCRIBE_INSTRUCTIONS = [
  "Você é o Escriba do Grimório: transforma o que os agentes aprenderam nas Expedições em",
  "páginas curtas, independentes do contexto e classificadas, e consolida o resumo do",
  "projeto. Você não executa tarefas de código: não leia arquivos, não rode comandos, não",
  "use ferramentas. Tudo o que precisa está no prompt. Responda só com o JSON pedido.",
].join(" ");

export interface KnowledgeSeedResult {
  readonly loadoutId: string | null;
  readonly created: boolean;
  /** Preenchido quando nenhum Harness ligado declara `structuredOutput`. */
  readonly reason: string | null;
}

/** O primeiro Harness ligado que produz resultado estruturado, na ordem da semente. */
async function findScribeHarness(db: DatabaseExecutor, userId: string) {
  const rows = await db
    .select()
    .from(harnesses)
    .where(and(eq(harnesses.userId, userId), eq(harnesses.enabled, true)))
    .orderBy(asc(harnesses.createdAt), asc(harnesses.id));
  return rows.find((row) => row.capabilities.structuredOutput) ?? null;
}

export async function seedKnowledgeLoadout(
  db: Database,
  input: { userId: string },
): Promise<KnowledgeSeedResult> {
  const { userId } = input;

  const [existente] = await db
    .select()
    .from(loadouts)
    .where(and(eq(loadouts.userId, userId), eq(loadouts.name, KNOWLEDGE_SCRIBE_LOADOUT_NAME)));
  if (existente !== undefined) return { loadoutId: existente.id, created: false, reason: null };

  const harness = await findScribeHarness(db, userId);
  if (harness === null) {
    return {
      loadoutId: null,
      created: false,
      reason: "Nenhum Harness ligado declara structuredOutput; o Escriba precisa de um.",
    };
  }

  const perfis = await db
    .select()
    .from(executionProfiles)
    .where(and(eq(executionProfiles.userId, userId), eq(executionProfiles.enabled, true)))
    .orderBy(asc(executionProfiles.createdAt));
  const perfil = perfis.find((row) => row.isDefault) ?? perfis[0];
  if (perfil === undefined) {
    return {
      loadoutId: null,
      created: false,
      reason: "Nenhum ExecutionProfile ligado; rode o db:seed dos cadastros de execução antes.",
    };
  }

  const [agente] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.userId, userId), eq(agents.name, KNOWLEDGE_SCRIBE_AGENT_NAME)));
  let agentId = agente?.id;
  if (agentId === undefined) {
    agentId = newId();
    await db.insert(agents).values({
      id: agentId,
      userId,
      name: KNOWLEDGE_SCRIBE_AGENT_NAME,
      role: "REVIEWER",
      instructions: SCRIBE_INSTRUCTIONS,
      description: "Quem escreve o Grimório: destila candidatos e consolida o resumo do projeto.",
    });
  }

  const loadoutId = newId();
  await db.insert(loadouts).values({
    id: loadoutId,
    userId,
    name: KNOWLEDGE_SCRIBE_LOADOUT_NAME,
    agentId,
    harnessId: harness.id,
    modelId: null,
    executionProfileId: perfil.id,
    skills: [],
    tools: [],
    mcpServers: [],
    // O Escriba não recebe Grimório no prompt: ele é quem o escreve.
    knowledgePolicy: { includeProjectSummary: false, includeDecisions: false, maxItems: 0 },
    contextPolicy: DEFAULT_CONTEXT_POLICY,
    version: 1,
    isDefault: false,
  });

  return { loadoutId, created: true, reason: null };
}

/**
 * O Loadout que o Distiller usa: o de `knowledge.loadoutId`, quando existe,
 * senão o semeado pelo nome. `null` quando não há nenhum dos dois — o lote
 * falha com o motivo e os candidatos ficam `PENDING`.
 */
export async function findKnowledgeScribeLoadout(
  db: DatabaseExecutor,
  input: { userId: string; loadoutId: string | null },
): Promise<LoadoutRow | null> {
  if (input.loadoutId !== null) {
    const escolhido = await findLoadoutRow(db, {
      userId: input.userId,
      loadoutId: input.loadoutId,
    });
    if (escolhido !== null) return escolhido;
  }

  const [semeado] = await db
    .select()
    .from(loadouts)
    .where(
      and(eq(loadouts.userId, input.userId), eq(loadouts.name, KNOWLEDGE_SCRIBE_LOADOUT_NAME)),
    );
  return semeado ?? null;
}
