import { and, eq } from "drizzle-orm";

import { createAgent } from "../src/agent.js";
import type { Database, DatabaseHandle } from "../src/client.js";
import { listExecutionProfiles } from "../src/execution-profile.js";
import { listHarnesses } from "../src/harness.js";
import { createLoadout } from "../src/loadout.js";
import { createProject } from "../src/project.js";
import { projects } from "../src/schema/project.js";
import { LOCAL_USER_ID } from "../src/seed.js";
import { seedExecutionRegistry } from "../src/seed-execution.js";
import { createTask } from "../src/task.js";

/**
 * Fixtures dos testes de execução.
 *
 * Tudo passa pelas mesmas funções que a API usa — nada de `INSERT` direto —,
 * então a massa de teste respeita a máquina de estados e as regras de
 * referência. Um estado que a aplicação não sabe produzir não é um teste: é uma
 * armadilha que só falha depois.
 */

export const USER = LOCAL_USER_ID;

export function exigirOk<V, F>(
  result: { ok: true; value: V } | { ok: false; failure: F } | null,
  what: string,
): V {
  if (result === null) throw new Error(`${what}: não encontrado.`);
  if (!result.ok) throw new Error(`${what}: recusado — ${JSON.stringify(result.failure)}.`);
  return result.value;
}

/** Um Project com workspace, que é o que um Run exige. */
export async function criarProjectComWorkspace(
  db: Database,
  input: { title: string; workspacePath: string },
): Promise<{ id: string }> {
  const project = await createProject(db, { userId: USER, title: input.title });

  await db
    .update(projects)
    .set({ workspacePath: input.workspacePath })
    .where(and(eq(projects.id, project.id), eq(projects.userId, USER)));

  return { id: project.id };
}

export async function criarTask(
  db: Database,
  input: { projectId: string; title: string },
): Promise<{ id: string }> {
  const task = exigirOk(
    await createTask(db, { userId: USER, projectId: input.projectId, title: input.title }),
    `a criação da Task "${input.title}"`,
  );
  return { id: task.id };
}

export interface Equipamento {
  readonly loadoutId: string;
  readonly agentId: string;
  readonly harnessId: string;
  readonly executionProfileId: string;
}

/**
 * Um Loadout completo sobre os cadastros semeados.
 *
 * Usa o Harness `CLAUDE_CODE` e o perfil "Campo aberto", que são os dois que o
 * `db:seed` deixa ligados.
 */
export async function criarEquipamento(
  db: Database,
  input: { nome: string },
): Promise<Equipamento> {
  const harnesses = await listHarnesses(db, { userId: USER });
  const harness = harnesses.find((item) => item.key === "CLAUDE_CODE");
  if (harness === undefined) throw new Error("O Harness CLAUDE_CODE não foi semeado.");

  const perfis = await listExecutionProfiles(db, { userId: USER });
  const perfil = perfis.find((item) => item.enabled);
  if (perfil === undefined) throw new Error("Nenhum ExecutionProfile ligado foi semeado.");

  const agent = exigirOk(
    await createAgent(db, {
      userId: USER,
      name: `Engenheiro ${input.nome}`,
      role: "ENGINEER",
      instructions: "Implemente o que a Missão pede.",
    }),
    "a criação do Agent",
  );

  const loadout = exigirOk(
    await createLoadout(db, {
      userId: USER,
      name: `Equipamento ${input.nome}`,
      agentId: agent.id,
      harnessId: harness.id,
      executionProfileId: perfil.id,
    }),
    "a criação do Loadout",
  );

  return {
    loadoutId: loadout.id,
    agentId: agent.id,
    harnessId: harness.id,
    executionProfileId: perfil.id,
  };
}

/**
 * Apaga tudo o que os testes de execução escrevem, na ordem das chaves
 * estrangeiras. Harness e ExecutionProfile ficam: são semente, não massa.
 *
 * Os registros da Fase 8A (Skill, Tool, servidor MCP, Provider) são apagados
 * inteiros e semeados de novo: parte deles é semente (as cinco Tools de git,
 * os quatro Providers, o `knowledge` builtIn) e parte é massa de teste, e a
 * semente idempotente é mais barata que distinguir os dois.
 */
export async function limparExecucao(handle: DatabaseHandle): Promise<void> {
  for (const tabela of [
    "proposed_task",
    "knowledge_candidate",
    "knowledge_item",
    "distillation_run",
    "approval_gate",
    "run_step",
    "workspace_lock",
    "run_event",
    "run",
    "loadout",
    "model",
    "agent",
    "activity",
    "task_dependency",
    "task",
    "workflow_step",
    "workflow_version",
    "workflow",
    "project",
    "skill_version",
    "skill",
    "tool",
    "mcp_server",
    "provider",
    "dashboard_event",
  ]) {
    await handle.pool.query(`delete from ${tabela} where user_id = $1`, [USER]);
  }
  await seedExecutionRegistry(handle.db, { userId: USER });
}
