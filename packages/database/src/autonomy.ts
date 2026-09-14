import type {
  AutonomyLevel,
  ProjectAutonomy,
  RoutingDecision,
  RuleFacts,
  TaskSuggestions,
} from "@dungeon-master/contracts";
import { allowsAutomation, describeAutonomy, routeTarget } from "@dungeon-master/domain";
import { and, asc, eq } from "drizzle-orm";

import { recordDomainEvent } from "./activity.js";
import type { AutonomyWriteFailure } from "./autonomy-failure.js";
import { computeBudgetPressure } from "./budget.js";
import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { findModelRow } from "./harness.js";
import { findLoadoutRow } from "./loadout.js";
import { findProjectRow } from "./project.js";
import { failed, ok, type Result } from "./result.js";
import { listRoutingRulesForDecision } from "./routing-rule.js";
import {
  executionProfiles,
  harnesses,
  type LoadoutRow,
  loadouts,
  models,
} from "./schema/execution.js";
import { projects } from "./schema/project.js";
import { findTaskRow } from "./task.js";
import { findWorkflowRow } from "./workflow.js";

/**
 * O nível de autonomia do Project e as sugestões (planejamento v0.4, Fase 9A;
 * documento técnico, seção 40).
 *
 * O que cada nível libera é do domínio (`allowsAutomation`); aqui só a
 * leitura, a escrita com o evento na mesma transação, e a montagem das
 * sugestões — que não gravam nada: a Task continua como está até alguém
 * aplicar o que foi sugerido.
 */

export function toProjectAutonomy(row: {
  id: string;
  autonomyLevel: AutonomyLevel;
  updatedAt: Date;
}): ProjectAutonomy {
  return {
    projectId: row.id,
    autonomyLevel: row.autonomyLevel,
    allows: describeAutonomy(row.autonomyLevel),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getProjectAutonomy(
  db: DatabaseExecutor,
  input: { userId: string; projectId: string },
): Promise<ProjectAutonomy | null> {
  const row = await findProjectRow(db, input);
  return row === null ? null : toProjectAutonomy(row);
}

/**
 * Muda o nível. Idempotente: o mesmo nível devolve o Project sem gravar um
 * segundo fato. `project.updated` vai ao diário e `autonomy.changed` ao
 * painel, na mesma transação.
 */
export async function updateProjectAutonomy(
  db: Database,
  input: { userId: string; projectId: string; autonomyLevel: AutonomyLevel },
): Promise<ProjectAutonomy | null> {
  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.userId, input.userId)))
      .for("update");
    if (current === undefined) return null;

    if (current.autonomyLevel === input.autonomyLevel) return toProjectAutonomy(current);

    const [row] = await tx
      .update(projects)
      .set({ autonomyLevel: input.autonomyLevel })
      .where(and(eq(projects.id, input.projectId), eq(projects.userId, input.userId)))
      .returning();
    if (row === undefined) throw new Error("A atualização de project não devolveu linha.");

    await recordDomainEvent(tx, {
      userId: input.userId,
      projectId: row.id,
      taskId: null,
      type: "project.updated",
      payload: {
        projectId: row.id,
        changed: ["autonomyLevel"],
        from: current.autonomyLevel,
        to: row.autonomyLevel,
      },
    });

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "autonomy.changed",
      payload: {
        projectId: row.id,
        from: current.autonomyLevel,
        to: row.autonomyLevel,
        allows: describeAutonomy(row.autonomyLevel),
      },
    });

    return toProjectAutonomy(row);
  });
}

// --------------------------------------------------------------------------
// Sugestões
// --------------------------------------------------------------------------

/**
 * O Loadout padrão do usuário: o marcado `isDefault`, o primeiro pelo nome.
 * Nulo quando não há nenhum.
 */
export async function findDefaultLoadoutRow(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<LoadoutRow | null> {
  const [row] = await db
    .select()
    .from(loadouts)
    .where(and(eq(loadouts.userId, input.userId), eq(loadouts.isDefault, true)))
    .orderBy(asc(loadouts.name), asc(loadouts.id))
    .limit(1);
  return row ?? null;
}

/**
 * Roteia o Model de um Loadout: as regras `MODEL` com os fatos, aceitando só
 * Models do Harness do Loadout; o padrão é o Model padrão do Harness. Um
 * Loadout que pina o Model não é roteado — é uma decisão humana.
 *
 * Compartilhada por `POST /runs` e por `POST /tasks/{id}/suggestions`, para
 * a sugestão dizer exatamente o que a partida faria.
 */
export async function routeModelForLoadout(
  db: DatabaseExecutor,
  input: {
    userId: string;
    loadout: Pick<LoadoutRow, "id" | "modelId" | "harnessId">;
    facts: RuleFacts;
    projectId: string | null;
  },
): Promise<RoutingDecision> {
  if (input.loadout.modelId !== null) {
    const pinado = await findModelRow(db, { userId: input.userId, modelId: input.loadout.modelId });
    return {
      kind: "MODEL",
      selectedId: pinado?.id ?? null,
      selectedName: pinado?.key ?? null,
      ruleId: null,
      decidedBy: "DEFAULT",
      reason: "O Loadout pina o Model; o roteamento não sobrescreve uma escolha humana.",
      attempts: [],
    };
  }

  const [padrao] = await db
    .select()
    .from(models)
    .where(and(eq(models.harnessId, input.loadout.harnessId), eq(models.isDefault, true)))
    .limit(1);

  // As regras são lidas uma vez e resolvidas de forma síncrona: `routeTarget`
  // é pura, então os candidatos são carregados antes.
  const rules = await listRoutingRulesForDecision(db, {
    userId: input.userId,
    projectId: input.projectId,
  });
  const candidatos = new Map<string, { id: string; key: string; harnessId: string }>();
  for (const rule of rules) {
    if (rule.kind !== "MODEL") continue;
    for (const targetId of [rule.targetId, ...rule.fallbackIds]) {
      if (candidatos.has(targetId)) continue;
      const model = await findModelRow(db, { userId: input.userId, modelId: targetId });
      if (model !== null)
        candidatos.set(targetId, { id: model.id, key: model.key, harnessId: model.harnessId });
    }
  }

  return routeTarget({
    kind: "MODEL",
    rules,
    facts: input.facts,
    resolve: (targetId) => {
      const model = candidatos.get(targetId);
      if (model === undefined) return { ok: false, reason: "O Model não existe mais." };
      if (model.harnessId !== input.loadout.harnessId) {
        return {
          ok: false,
          reason: "O Model pertence a outro Harness; a chave não é do vocabulário deste.",
        };
      }
      return { ok: true, candidate: { id: model.id, name: model.key } };
    },
    fallback: padrao === undefined ? null : { id: padrao.id, name: padrao.key },
    fallbackReason:
      padrao === undefined
        ? "O Harness não tem Model padrão: a CLI usa o dela."
        : "Vale o Model padrão do Harness.",
  });
}

/**
 * Loadout, Workflow e Model sugeridos para a Task, com o motivo de cada um.
 *
 * `null` é a Task que não existe. Exige Project e nível de autonomia que
 * libere `SUGGEST` (≥ 1): abaixo disso o sistema não sugere nada, de
 * propósito. Nada é gravado.
 */
export async function computeTaskSuggestions(
  db: DatabaseExecutor,
  input: { userId: string; taskId: string; now?: Date },
): Promise<Result<TaskSuggestions, AutonomyWriteFailure> | null> {
  const now = input.now ?? new Date();
  const task = await findTaskRow(db, input);
  if (task === null) return null;
  if (task.projectId === null) {
    return failed<AutonomyWriteFailure>({ code: "TASK_WITHOUT_PROJECT", taskId: task.id });
  }
  const project = await findProjectRow(db, { userId: input.userId, projectId: task.projectId });
  if (project === null) {
    return failed<AutonomyWriteFailure>({ code: "TASK_WITHOUT_PROJECT", taskId: task.id });
  }
  if (!allowsAutomation(project.autonomyLevel, "SUGGEST")) {
    return failed<AutonomyWriteFailure>({
      code: "AUTOMATION_NOT_ALLOWED",
      automation: "SUGGEST",
      autonomyLevel: project.autonomyLevel,
    });
  }

  const rules = await listRoutingRulesForDecision(db, {
    userId: input.userId,
    projectId: project.id,
  });
  const pressaoBase = await computeBudgetPressure(db, {
    userId: input.userId,
    projectId: project.id,
    loadoutId: null,
    now,
  });
  const factsBase: RuleFacts = {
    projectId: project.id,
    taskKind: task.kind,
    taskPriority: task.priority,
    budgetPressure: pressaoBase,
  };

  // ------------------------------------------------------------ Loadout
  const loadoutsPorId = new Map<string, LoadoutRow>();
  for (const rule of rules) {
    if (rule.kind !== "LOADOUT") continue;
    for (const targetId of [rule.targetId, ...rule.fallbackIds]) {
      if (loadoutsPorId.has(targetId)) continue;
      const row = await findLoadoutRow(db, { userId: input.userId, loadoutId: targetId });
      if (row !== null) loadoutsPorId.set(targetId, row);
    }
  }
  const loadoutPadrao = await findDefaultLoadoutRow(db, { userId: input.userId });
  const loadout = routeTarget({
    kind: "LOADOUT",
    rules,
    facts: factsBase,
    resolve: (targetId) => {
      const row = loadoutsPorId.get(targetId);
      return row === undefined
        ? { ok: false, reason: "O Loadout não existe mais." }
        : { ok: true, candidate: { id: row.id, name: row.name } };
    },
    fallback: loadoutPadrao === null ? null : { id: loadoutPadrao.id, name: loadoutPadrao.name },
    fallbackReason:
      loadoutPadrao === null ? "Não há Loadout padrão." : "Vale o Loadout marcado como padrão.",
  });

  // ------------------------------------------------------------ Workflow
  const workflowsPorId = new Map<string, { id: string; name: string }>();
  for (const rule of rules) {
    if (rule.kind !== "WORKFLOW") continue;
    for (const targetId of [rule.targetId, ...rule.fallbackIds]) {
      if (workflowsPorId.has(targetId)) continue;
      const row = await findWorkflowRow(db, { userId: input.userId, workflowId: targetId });
      if (row !== null) workflowsPorId.set(targetId, { id: row.id, name: row.name });
    }
  }
  const daTask =
    task.workflowId === null
      ? null
      : await findWorkflowRow(db, { userId: input.userId, workflowId: task.workflowId });
  const workflow = routeTarget({
    kind: "WORKFLOW",
    rules,
    facts: factsBase,
    resolve: (targetId) => {
      const row = workflowsPorId.get(targetId);
      return row === undefined
        ? { ok: false, reason: "O Workflow não existe mais." }
        : { ok: true, candidate: row };
    },
    fallback: daTask === null ? null : { id: daTask.id, name: daTask.name },
    fallbackReason:
      daTask === null ? "A Task não tem Workflow: vale o Run simples." : "Vale o Workflow da Task.",
  });

  // ------------------------------------------------------------ Model
  const loadoutEscolhido =
    loadout.selectedId === null
      ? null
      : (loadoutsPorId.get(loadout.selectedId) ??
        (loadoutPadrao !== null && loadoutPadrao.id === loadout.selectedId ? loadoutPadrao : null));

  let model: RoutingDecision;
  let pressao = pressaoBase;
  if (loadoutEscolhido === null) {
    model = {
      kind: "MODEL",
      selectedId: null,
      selectedName: null,
      ruleId: null,
      decidedBy: "DEFAULT",
      reason: "Sem Loadout sugerido não há Harness de que escolher um Model.",
      attempts: [],
    };
  } else {
    const [harness] = await db
      .select({ key: harnesses.key })
      .from(harnesses)
      .where(eq(harnesses.id, loadoutEscolhido.harnessId));
    const [profile] = await db
      .select({ mode: executionProfiles.mode, enforcement: executionProfiles.enforcement })
      .from(executionProfiles)
      .where(eq(executionProfiles.id, loadoutEscolhido.executionProfileId));
    pressao = await computeBudgetPressure(db, {
      userId: input.userId,
      projectId: project.id,
      loadoutId: loadoutEscolhido.id,
      now,
    });
    model = await routeModelForLoadout(db, {
      userId: input.userId,
      loadout: loadoutEscolhido,
      projectId: project.id,
      facts: {
        ...factsBase,
        loadoutId: loadoutEscolhido.id,
        ...(harness === undefined ? {} : { harnessKey: harness.key }),
        ...(profile === undefined
          ? {}
          : { executionMode: profile.mode, enforcement: profile.enforcement }),
        budgetPressure: pressao,
      },
    });
  }

  return ok({
    taskId: task.id,
    projectId: project.id,
    autonomyLevel: project.autonomyLevel,
    loadout,
    workflow,
    model,
    budgetPressure: pressao,
    computedAt: now.toISOString(),
  });
}
