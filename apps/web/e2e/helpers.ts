import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { dnd } from "@dungeon-master/glossary";
import { expect, type Page } from "@playwright/test";
import { Client } from "pg";

/**
 * Utilitários compartilhados pelas suítes de ponta a ponta.
 *
 * O banco é um só para a suíte inteira e as suítes rodam em série, então uma
 * delas deixar o tema desligado quebraria a seguinte. `setTheme` deixa o estado
 * explícito no começo de cada teste que depende de label.
 */

/**
 * O interruptor de tema, pelo nome acessível: Settings tem mais de um
 * `switch` desde a Fase 6B (a revisão humana do Grimório), e o rótulo do tema
 * é o mesmo nos dois glossários.
 */
export function themeToggle(page: Page) {
  return page.getByRole("switch", { name: dnd["settings.theme.toggle"] });
}

/** Liga ou desliga o interruptor de tema, pela tela de configurações. */
export async function setTheme(page: Page, on: boolean): Promise<void> {
  await page.goto("/settings");

  const toggle = themeToggle(page);
  await expect(toggle).toBeEnabled();

  const wanted = on ? "checked" : "unchecked";
  if ((await toggle.getAttribute("data-state")) !== wanted) {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("data-state", wanted);
}

export interface CatalogDefinition {
  readonly key: string;
  readonly rarity: string;
  readonly hidden: boolean;
  readonly name: { readonly theme: string; readonly plain: string };
  readonly flavor: string;
}

const CATALOG_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/achievements/catalog/v1",
);

function read<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(CATALOG_DIR, file), "utf8")) as T;
}

/**
 * O catálogo versionado, lido do arquivo.
 *
 * O teste compara a tela com a fonte de verdade em vez de repetir os nomes: se
 * o catálogo mudar de voz, a asserção continua correta sem edição.
 */
export function definitions(): readonly CatalogDefinition[] {
  return read<CatalogDefinition[]>("catalog.json");
}

/** Os templates, que na tela viram uma única carta oculta. */
export function templates(): readonly { readonly key: string }[] {
  return read<{ key: string }[]>("templates.json");
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DM_SCRIPT = resolve(ROOT, "apps/worker/scripts/dm.ts");
const TSX_CLI = createRequire(resolve(ROOT, "apps/worker/package.json")).resolve("tsx/cli");

/**
 * Roda um passe do projetor de Conquistas contra o banco do e2e.
 *
 * O projetor mora no Worker, e a configuração do Playwright não sobe Worker de
 * propósito: um Worker no ar tentaria executar os Runs que `runs.spec` deixa em
 * `QUEUED`, e aquele arquivo prova exatamente que eles ficam lá. O que este
 * helper faz é o mesmo que `pnpm dm achievements rebuild` faria à mão — o
 * comando de operador que a Fase 2.5B entregou —, com o mesmo carregador de
 * catálogo e a mesma função de projeção.
 *
 * O `tsx` é resolvido pelo caminho, e não invocado por `pnpm`: chamar o
 * gerenciador daqui exigiria `shell: true` no Windows.
 */
export function projectAchievements(): void {
  execFileSync(process.execPath, [TSX_CLI, DM_SCRIPT, "achievements", "rebuild"], {
    cwd: ROOT,
    env: process.env,
    stdio: "pipe",
    windowsHide: true,
  });
}

export interface OpenApprovalGateInput {
  readonly runId: string;
  /** Chave do RunStep de tipo `approval` que vai esperar. */
  readonly stepKey: string;
  /** Chave do gate, vinda da definição do Workflow. */
  readonly gateKey: string;
  readonly title: string;
  readonly description?: string;
}

/**
 * Deixa um Run parado num gate de aprovação, por SQL no banco do e2e.
 *
 * Quem faz isso em produção é o motor do Worker (Fase 4B), ao chegar num
 * step `approval`, e a configuração do Playwright não sobe Worker de
 * propósito. A fixture escreve o que `createApprovalGate` escreveria, na mesma
 * transação: os steps anteriores assentam em `SUCCEEDED`, o step de aprovação
 * e o Run vão para `WAITING_APPROVAL`, a Task vai para `RUNNING`, o gate nasce
 * `PENDING`, o `ApprovalRequested` entra no log do Run e o `approval.requested`
 * entra no dashboard — cujo trigger emite o `NOTIFY` no COMMIT, então a
 * interface aberta recebe o toast pelo SSE de verdade.
 *
 * A resolução, essa é pela API: é o CAS de `POST /approval-gates/{id}/resolve`
 * que o teste quer provar, e ele exige exatamente o estado que a fixture deixa.
 *
 * Os ids são UUID v4 do Node, e não os v7 da aplicação: é uma linha de
 * fixture, e o `newId()` mora num pacote que o e2e não precisa carregar.
 */
export async function openApprovalGate(input: OpenApprovalGateInput): Promise<{ gateId: string }> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL não está no ambiente: rode pelo run-e2e.mjs.");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");

    const run = await client.query<{ user_id: string; task_id: string; harness_key: string }>(
      `SELECT user_id, task_id, harness_key FROM run WHERE id = $1 AND status = 'QUEUED' FOR UPDATE`,
      [input.runId],
    );
    const owner = run.rows[0];
    if (owner === undefined) throw new Error(`O Run ${input.runId} não existe ou não está QUEUED.`);

    // Os steps antes do gate rodaram e assentaram; o resultado casa com o tipo.
    await client.query(
      `UPDATE run_step
         SET status = 'SUCCEEDED', attempt = 1, started_at = now(), finished_at = now(),
             updated_at = now(),
             result = CASE type
               WHEN 'agent' THEN '{"kind":"agent","status":"completed","summary":"Fixture do e2e."}'::jsonb
               WHEN 'command' THEN '{"kind":"command","exitCode":0,"durationMs":1}'::jsonb
               WHEN 'validation' THEN '{"kind":"validation","verdict":"passed","exitCode":0,"durationMs":1}'::jsonb
               WHEN 'knowledge' THEN '{"kind":"knowledge","candidates":[]}'::jsonb
               ELSE NULL END
       WHERE run_id = $1
         AND position < (SELECT position FROM run_step WHERE run_id = $1 AND key = $2)`,
      [input.runId, input.stepKey],
    );

    const step = await client.query<{ id: string }>(
      `UPDATE run_step
         SET status = 'WAITING_APPROVAL', attempt = 1, started_at = now(), updated_at = now()
       WHERE run_id = $1 AND key = $2 AND type = 'approval' AND status = 'PENDING'
       RETURNING id`,
      [input.runId, input.stepKey],
    );
    const stepId = step.rows[0]?.id;
    if (stepId === undefined) {
      throw new Error(
        `O Run ${input.runId} não tem um step approval PENDING com a chave ${input.stepKey}.`,
      );
    }

    await client.query(
      `UPDATE run SET status = 'WAITING_APPROVAL', started_at = coalesce(started_at, now()),
                      updated_at = now()
       WHERE id = $1`,
      [input.runId],
    );
    await client.query(
      `UPDATE task SET status = 'RUNNING', updated_at = now() WHERE id = $1 AND status = 'QUEUED'`,
      [owner.task_id],
    );

    const gateId = randomUUID();
    await client.query(
      `INSERT INTO approval_gate
         (id, user_id, run_id, run_step_id, gate_key, title, description, status, requested_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', now())`,
      [
        gateId,
        owner.user_id,
        input.runId,
        stepId,
        input.gateKey,
        input.title,
        input.description ?? null,
      ],
    );

    const requestedAt = new Date().toISOString();
    await client.query(
      `INSERT INTO run_event (id, user_id, run_id, sequence, type, timestamp, payload)
       SELECT $1, $2, $3, coalesce(max(sequence), 0) + 1, 'ApprovalRequested', now(), $4::jsonb
         FROM run_event WHERE run_id = $3`,
      [
        randomUUID(),
        owner.user_id,
        input.runId,
        JSON.stringify({
          type: "ApprovalRequested",
          timestamp: requestedAt,
          harness: owner.harness_key,
          approvalKey: input.gateKey,
          summary: input.title,
          gateId,
          stepKey: input.stepKey,
        }),
      ],
    );

    await client.query(
      `INSERT INTO dashboard_event (user_id, type, payload) VALUES ($1, 'approval.requested', $2::jsonb)`,
      [
        owner.user_id,
        JSON.stringify({
          runId: input.runId,
          taskId: owner.task_id,
          gateId,
          gateKey: input.gateKey,
          title: input.title,
        }),
      ],
    );

    await client.query("COMMIT");
    return { gateId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export interface SeedRunOutcomeInput {
  /** Um Run em `QUEUED`, criado pela API. */
  readonly runId: string;
  /** As propostas que o resultado traz, na ordem de `discoveredTasks`. */
  readonly proposals: readonly {
    readonly title: string;
    readonly description?: string;
    readonly rationale?: string;
  }[];
  /** Os candidatos a conhecimento do resultado, se houver. */
  readonly knowledge?: readonly {
    readonly title: string;
    readonly content: string;
    readonly kind?: string;
  }[];
}

/**
 * Termina um Run em `SUCCEEDED` com propostas de trabalho, por SQL no banco
 * do e2e (Fase 5B).
 *
 * Quem faz isso em produção é o Worker, ao escrever o desfecho pela porta
 * `writeRunTerminalStatus`, e a configuração do Playwright não sobe Worker de
 * propósito. A fixture escreve o que a porta escreveria, na mesma transação:
 * o Run vai para `SUCCEEDED` com o `result` estruturado, a Task de origem vai
 * para `COMPLETED`, cada `discoveredTask` vira uma linha de `proposed_task`
 * em `PROPOSED` (com a posição que é a chave de idempotência), cada candidato
 * vira uma linha de `knowledge_candidate`, e o `task.proposed` entra no
 * dashboard — cujo trigger emite o `NOTIFY` no COMMIT, então a interface
 * aberta recebe o toast pelo SSE de verdade.
 *
 * As decisões, essas são pela API: é o CAS de `POST /proposed-tasks/{id}/…`
 * que o teste quer provar, e ele exige exatamente o estado que a fixture deixa.
 */
export async function seedRunOutcome(
  input: SeedRunOutcomeInput,
): Promise<{ proposedTaskIds: string[] }> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL não está no ambiente: rode pelo run-e2e.mjs.");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");

    const run = await client.query<{ user_id: string; task_id: string; project_id: string }>(
      `SELECT r.user_id, r.task_id, t.project_id
         FROM run r JOIN task t ON t.id = r.task_id
        WHERE r.id = $1 AND r.status = 'QUEUED'
        FOR UPDATE OF r`,
      [input.runId],
    );
    const owner = run.rows[0];
    if (owner === undefined) throw new Error(`O Run ${input.runId} não existe ou não está QUEUED.`);

    const result = {
      status: "completed",
      summary: "Fixture do e2e: o trabalho terminou e apontou o que falta.",
      artifacts: [],
      discoveredTasks: input.proposals.map((proposal) => ({
        title: proposal.title,
        ...(proposal.description === undefined ? {} : { description: proposal.description }),
        ...(proposal.rationale === undefined ? {} : { rationale: proposal.rationale }),
      })),
      knowledgeCandidates: (input.knowledge ?? []).map((candidate) => ({
        title: candidate.title,
        content: candidate.content,
        ...(candidate.kind === undefined ? {} : { kind: candidate.kind }),
      })),
      warnings: [],
    };

    await client.query(
      `UPDATE run
         SET status = 'SUCCEEDED', started_at = coalesce(started_at, now()), finished_at = now(),
             updated_at = now(), result = $2::jsonb
       WHERE id = $1`,
      [input.runId, JSON.stringify(result)],
    );
    await client.query(
      `UPDATE task SET status = 'COMPLETED', completed_at = now(), updated_at = now() WHERE id = $1`,
      [owner.task_id],
    );

    const proposedTaskIds: string[] = [];
    for (const [position, proposal] of input.proposals.entries()) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO proposed_task
           (id, user_id, project_id, origin_task_id, origin_run_id, position, title, description,
            rationale, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PROPOSED')`,
        [
          id,
          owner.user_id,
          owner.project_id,
          owner.task_id,
          input.runId,
          position,
          proposal.title,
          proposal.description ?? null,
          proposal.rationale ?? null,
        ],
      );
      proposedTaskIds.push(id);
    }

    for (const [position, candidate] of (input.knowledge ?? []).entries()) {
      await client.query(
        `INSERT INTO knowledge_candidate
           (id, user_id, project_id, task_id, run_id, position, title, content, kind, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING')`,
        [
          randomUUID(),
          owner.user_id,
          owner.project_id,
          owner.task_id,
          input.runId,
          position,
          candidate.title,
          candidate.content,
          candidate.kind ?? null,
        ],
      );
    }

    if (proposedTaskIds.length > 0) {
      await client.query(
        `INSERT INTO dashboard_event (user_id, type, payload) VALUES ($1, 'task.proposed', $2::jsonb)`,
        [
          owner.user_id,
          JSON.stringify({
            projectId: owner.project_id,
            taskId: owner.task_id,
            runId: input.runId,
            count: proposedTaskIds.length,
            proposedTaskIds,
          }),
        ],
      );
    }

    await client.query("COMMIT");
    return { proposedTaskIds };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export interface SeedKnowledgeInput {
  /** Um Run em `QUEUED`, criado pela API. */
  readonly runId: string;
  /** Um sufixo para os títulos ficarem únicos entre testes. */
  readonly suffix: string;
}

export interface SeedKnowledgeResult {
  readonly projectId: string;
  readonly taskId: string;
  readonly batchId: string;
  /** O `FACT` em revisão. */
  readonly pendingFactId: string;
  /** A `DECISION` em revisão. */
  readonly pendingDecisionId: string;
  /** O item `ACTIVE`. */
  readonly activeItemId: string;
  /** O `SUMMARY` corrente. */
  readonly summaryId: string;
  /** A forjada em revisão. */
  readonly forgedId: string;
  readonly titles: {
    readonly pendingFact: string;
    readonly pendingDecision: string;
    readonly active: string;
    readonly summary: string;
    readonly forged: string;
  };
}

/**
 * Deixa uma Campanha com Grimório, por SQL no banco do e2e (Fase 6B).
 *
 * Quem faz isso em produção é o Distiller do Worker, num lote sob o advisory
 * lock do Project, e a configuração do Playwright não sobe Worker de
 * propósito. A fixture escreve o que o lote escreveria, na mesma transação:
 * o Run termina `SUCCEEDED` com candidatos no resultado, a Task vai para
 * `COMPLETED`, um `distillation_run` nasce e termina `SUCCEEDED`, quatro
 * candidatos são decididos (dois promovidos, um recusado com motivo, um
 * fundido), quatro itens entram no Grimório (um `FACT` e uma `DECISION` em
 * `PENDING_REVIEW`, um `PROCEDURE` `ACTIVE`, o `SUMMARY`), uma forjada entra
 * na forja, e `knowledge.distilled` e `achievement.forged` entram no
 * dashboard — cujo trigger emite o `NOTIFY` no COMMIT, então a interface
 * aberta recebe os toasts pelo SSE de verdade.
 *
 * As decisões, essas são pela API: é o CAS de `POST /knowledge-items/{id}/…`
 * e de `POST /achievements/{id}/…` que o teste quer provar, e ele exige
 * exatamente o estado que a fixture deixa.
 */
export async function seedKnowledge(input: SeedKnowledgeInput): Promise<SeedKnowledgeResult> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL não está no ambiente: rode pelo run-e2e.mjs.");
  }

  const titles = {
    pendingFact: `A sala norte alaga depois da chuva ${input.suffix}`,
    pendingDecision: `Entrar sempre pela galeria leste ${input.suffix}`,
    active: `Como abrir o portão sem a chave ${input.suffix}`,
    summary: `O que a Campanha já sabe ${input.suffix}`,
    forged: `Domador do Deadlock ${input.suffix}`,
  };

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");

    const run = await client.query<{ user_id: string; task_id: string; project_id: string }>(
      `SELECT r.user_id, r.task_id, t.project_id
         FROM run r JOIN task t ON t.id = r.task_id
        WHERE r.id = $1 AND r.status = 'QUEUED'
        FOR UPDATE OF r`,
      [input.runId],
    );
    const owner = run.rows[0];
    if (owner === undefined) throw new Error(`O Run ${input.runId} não existe ou não está QUEUED.`);

    const candidates = [
      {
        title: titles.pendingFact,
        content: "Depois da chuva o piso fica sob água.",
        kind: "gotcha",
      },
      {
        title: titles.pendingDecision,
        content: "A galeria leste é a entrada padrão.",
        kind: "decision",
      },
      { title: `Hoje choveu ${input.suffix}`, content: "Choveu a tarde inteira.", kind: "note" },
      {
        title: `Três batidas abrem o portão ${input.suffix}`,
        content: "Ritmo: 3, pausa, 2.",
        kind: "howto",
      },
    ];

    const result = {
      status: "completed",
      summary: "Fixture do e2e: o trabalho terminou e ensinou alguma coisa.",
      artifacts: [],
      discoveredTasks: [],
      knowledgeCandidates: candidates,
      warnings: [],
    };

    await client.query(
      `UPDATE run
         SET status = 'SUCCEEDED', started_at = coalesce(started_at, now() - interval '2 minutes'),
             finished_at = now() - interval '1 minute', updated_at = now(), result = $2::jsonb
       WHERE id = $1`,
      [input.runId, JSON.stringify(result)],
    );
    await client.query(
      `UPDATE task SET status = 'COMPLETED', completed_at = now(), updated_at = now() WHERE id = $1`,
      [owner.task_id],
    );

    const batchId = randomUUID();
    await client.query(
      `INSERT INTO distillation_run
         (id, user_id, project_id, status, trigger, loadout_id, candidate_count, promoted, rejected,
          merged, summary_regenerated, started_at, finished_at)
       VALUES ($1, $2, $3, 'SUCCEEDED', 'MANUAL', NULL, 4, 2, 1, 1, true,
               now() - interval '50 seconds', now() - interval '10 seconds')`,
      [batchId, owner.user_id, owner.project_id],
    );

    const provenance = (candidateId: string | null, merged: readonly string[] = []) => ({
      candidateId,
      runId: input.runId,
      taskId: owner.task_id,
      distillationRunId: batchId,
      harnessSessionId: null,
      usage: null,
      mergedCandidateIds: [...merged],
      coveredItemIds: [],
    });

    const candidateIds = candidates.map(() => randomUUID());
    const [factCandidate, decisionCandidate, rejectedCandidate, mergedCandidate] = candidateIds as [
      string,
      string,
      string,
      string,
    ];

    const pendingFactId = randomUUID();
    const pendingDecisionId = randomUUID();
    const activeItemId = randomUUID();
    const summaryId = randomUUID();

    const insertItem = (values: {
      id: string;
      type: string;
      status: string;
      title: string;
      content: string;
      provenance: unknown;
      version: number;
      reviewed: boolean;
      createdOffsetSeconds: number;
    }) =>
      client.query(
        `INSERT INTO knowledge_item
           (id, user_id, project_id, type, status, title, content, provenance, version, reviewed_at,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9,
                 CASE WHEN $10 THEN now() - interval '30 seconds' ELSE NULL END,
                 now() - ($11 || ' seconds')::interval, now() - ($11 || ' seconds')::interval)`,
        [
          values.id,
          owner.user_id,
          owner.project_id,
          values.type,
          values.status,
          values.title,
          values.content,
          JSON.stringify(values.provenance),
          values.version,
          values.reviewed,
          String(values.createdOffsetSeconds),
        ],
      );

    // O ativo primeiro: a decisão pendente é "posterior" a ele na linha do tempo.
    await insertItem({
      id: activeItemId,
      type: "PROCEDURE",
      status: "ACTIVE",
      title: titles.active,
      content: "Três batidas, uma pausa, duas batidas.\nFunciona mesmo sem a chave.",
      provenance: provenance(null, [mergedCandidate]),
      version: 2,
      reviewed: true,
      createdOffsetSeconds: 40,
    });
    await insertItem({
      id: pendingFactId,
      type: "FACT",
      status: "PENDING_REVIEW",
      title: titles.pendingFact,
      content:
        "Depois da chuva o piso da sala norte fica sob água.\nO caminho seguro é pela galeria leste.",
      provenance: provenance(factCandidate),
      version: 1,
      reviewed: false,
      createdOffsetSeconds: 30,
    });
    await insertItem({
      id: pendingDecisionId,
      type: "DECISION",
      status: "PENDING_REVIEW",
      title: titles.pendingDecision,
      content: "Decidido: a galeria leste é a entrada padrão da masmorra.",
      provenance: provenance(decisionCandidate),
      version: 1,
      reviewed: false,
      createdOffsetSeconds: 20,
    });
    await insertItem({
      id: summaryId,
      type: "SUMMARY",
      status: "ACTIVE",
      title: titles.summary,
      content: "Uma masmorra que alaga, um portão que abre com ritmo, uma galeria que salva.",
      provenance: {
        candidateId: null,
        runId: null,
        taskId: null,
        distillationRunId: batchId,
        harnessSessionId: null,
        usage: null,
        mergedCandidateIds: [],
        coveredItemIds: [activeItemId],
      },
      version: 1,
      reviewed: false,
      createdOffsetSeconds: 10,
    });

    const decisions = [
      {
        id: factCandidate,
        status: "PROMOTED",
        decision: "PROMOTE",
        reason: "Fato novo e útil.",
        itemId: pendingFactId,
      },
      {
        id: decisionCandidate,
        status: "PROMOTED",
        decision: "PROMOTE",
        reason: "Uma decisão registrada.",
        itemId: pendingDecisionId,
      },
      {
        id: rejectedCandidate,
        status: "REJECTED",
        decision: "REJECT",
        reason: "Efêmero: não serve para a próxima Expedição.",
        itemId: null,
      },
      {
        id: mergedCandidate,
        status: "MERGED",
        decision: "MERGE",
        reason: "Repete o procedimento do portão.",
        itemId: activeItemId,
      },
    ];
    for (const [position, candidate] of candidates.entries()) {
      const decided = decisions[position]!;
      await client.query(
        `INSERT INTO knowledge_candidate
           (id, user_id, project_id, task_id, run_id, position, title, content, kind, status,
            decision, reason, knowledge_item_id, distillation_run_id, processed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now() - interval '10 seconds')`,
        [
          decided.id,
          owner.user_id,
          owner.project_id,
          owner.task_id,
          input.runId,
          position,
          candidate.title,
          candidate.content,
          candidate.kind,
          decided.status,
          decided.decision,
          decided.reason,
          decided.itemId,
          batchId,
        ],
      );
    }

    const forgedId = randomUUID();
    const forgedProvenance = {
      kind: "VICTORY_STREAK",
      detail: `3 Runs bem-sucedidos seguidos, fechados pelo Run ${input.runId}.`,
      projectId: owner.project_id,
      runId: input.runId,
      taskId: owner.task_id,
      distillationRunId: batchId,
      harnessSessionId: null,
    };
    await client.query(
      `INSERT INTO achievement_definition
         (id, user_id, origin, natural_key, scope_type, scope_id, name_theme, name_plain,
          description_theme, description_plain, flavor, icon, rarity, hidden, condition, provenance,
          review_status, forged_provenance)
       VALUES ($1, $2, 'FORGED', $3, 'PROJECT', $4, $5, $6, $7, $8, $9, 'flame', 'RARE', false,
               $10::jsonb, $11::jsonb, 'PENDING_REVIEW', $12::jsonb)`,
      [
        forgedId,
        owner.user_id,
        `forged:${forgedId}`,
        owner.project_id,
        titles.forged,
        `Sequência de 3 Runs bem-sucedidos ${input.suffix}`,
        "Três Vitórias seguidas. A arquibancada apostou na derrota e perdeu.",
        "Encadear 3 Runs bem-sucedidos seguidos no Project.",
        "Três seguidas. A plateia queria sangue e recebeu planilha. Anota: previsível, porém eficaz.",
        JSON.stringify({
          predicate: "streak",
          source: "run.succeeded",
          length: 3,
          filter: { "project.id": owner.project_id },
        }),
        JSON.stringify({
          runId: input.runId,
          taskId: owner.task_id,
          createdAt: new Date().toISOString(),
        }),
        JSON.stringify(forgedProvenance),
      ],
    );

    await client.query(`UPDATE distillation_run SET forged_achievement_id = $2 WHERE id = $1`, [
      batchId,
      forgedId,
    ]);

    await client.query(
      `INSERT INTO dashboard_event (user_id, type, payload) VALUES ($1, 'knowledge.distilled', $2::jsonb)`,
      [
        owner.user_id,
        JSON.stringify({
          projectId: owner.project_id,
          distillationRunId: batchId,
          promoted: 2,
          rejected: 1,
          merged: 1,
          pendingReview: 2,
          knowledgeItemIds: [pendingFactId, pendingDecisionId],
        }),
      ],
    );
    await client.query(
      `INSERT INTO dashboard_event (user_id, type, payload) VALUES ($1, 'achievement.forged', $2::jsonb)`,
      [
        owner.user_id,
        JSON.stringify({
          definitionId: forgedId,
          name: titles.forged,
          kind: "VICTORY_STREAK",
          projectId: owner.project_id,
          runId: input.runId,
          taskId: owner.task_id,
          distillationRunId: batchId,
          reviewStatus: "PENDING_REVIEW",
        }),
      ],
    );

    await client.query("COMMIT");
    return {
      projectId: owner.project_id,
      taskId: owner.task_id,
      batchId,
      pendingFactId,
      pendingDecisionId,
      activeItemId,
      summaryId,
      forgedId,
      titles,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export interface SeedRunContextInput {
  /** Um Run criado pela API. Em `QUEUED`, a fixture o termina em `SUCCEEDED`. */
  readonly runId: string;
  /** O `SUMMARY` da Campanha, que entra na seção do resumo. */
  readonly summaryId: string;
  /** A Página que entra cortada na seção de Páginas. */
  readonly pageId: string;
  /** A Página que fica de fora por orçamento. */
  readonly excludedId: string;
  readonly titles: {
    readonly summary: string;
    readonly page: string;
    readonly excluded: string;
  };
  /** O Run cuja sessão este retomou e de quem copiou o contexto. */
  readonly inheritedFromRunId?: string;
  /** Grava também uma consulta ao Grimório no Diário: `ToolCall` e `ToolResult`. */
  readonly withToolCalls?: boolean;
}

export interface SeedRunContextResult {
  readonly contextId: string;
  readonly taskId: string;
  readonly projectId: string;
  readonly text: string;
}

/**
 * Deixa um Run com o contexto montado, por SQL no banco do e2e (Fase 7C).
 *
 * Quem faz isso em produção é o Worker, ao reclamar o Run e gravar o que o
 * montador de `packages/context` decidiu, e a configuração do Playwright não
 * sobe Worker de propósito. A fixture escreve o que `saveRunContext`
 * escreveria, na mesma transação: uma linha `ASSEMBLED` com três seções (o
 * resumo, uma Página cortada pelo teto da seção, a própria Missão na
 * linhagem), uma Página excluída pelo corte do total, o orçamento e o uso, a
 * política com a origem no Loadout do Run, e o texto exato do bloco. Um Run
 * ainda em `QUEUED` termina em `SUCCEEDED` com a Task em `COMPLETED`, como
 * `seedRunOutcome` faz; um Run já terminado só ganha o contexto.
 *
 * Com `withToolCalls`, o Diário ganha uma chamada ao servidor MCP do
 * Grimório e a resposta dela, com o nome `mcp__knowledge__…` que a CLI
 * emite: é o que o cockpit destaca e conta.
 */
export async function seedRunContext(input: SeedRunContextInput): Promise<SeedRunContextResult> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL não está no ambiente: rode pelo run-e2e.mjs.");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");

    const run = await client.query<{
      user_id: string;
      task_id: string;
      project_id: string;
      status: string;
      loadout_id: string;
      loadout_version: number;
      task_title: string;
    }>(
      `SELECT r.user_id, r.task_id, t.project_id, r.status, r.loadout_id, r.loadout_version,
              t.title AS task_title
         FROM run r JOIN task t ON t.id = r.task_id
        WHERE r.id = $1
        FOR UPDATE OF r`,
      [input.runId],
    );
    const owner = run.rows[0];
    if (owner === undefined) throw new Error(`O Run ${input.runId} não existe.`);

    if (owner.status === "QUEUED") {
      const result = {
        status: "completed",
        summary: "Fixture do e2e: o trabalho terminou com as provisões no prompt.",
        artifacts: [],
        discoveredTasks: [],
        knowledgeCandidates: [],
        warnings: [],
      };
      await client.query(
        `UPDATE run
           SET status = 'SUCCEEDED', started_at = coalesce(started_at, now() - interval '3 minutes'),
               finished_at = now() - interval '1 minute', updated_at = now(), result = $2::jsonb
         WHERE id = $1`,
        [input.runId, JSON.stringify(result)],
      );
      await client.query(
        `UPDATE task SET status = 'COMPLETED', completed_at = now(), updated_at = now() WHERE id = $1`,
        [owner.task_id],
      );
    }

    const summaryItem = {
      id: input.summaryId,
      kind: "KNOWLEDGE_ITEM",
      title: input.titles.summary,
      reason: "PROJECT_SUMMARY",
      score: null,
      tokens: 240,
      truncated: false,
    };
    const pageItem = {
      id: input.pageId,
      kind: "KNOWLEDGE_ITEM",
      title: input.titles.page,
      reason: "FTS_MATCH",
      score: 0.4256,
      tokens: 1500,
      truncated: true,
    };
    const taskItem = {
      id: owner.task_id,
      kind: "TASK",
      title: owner.task_title,
      reason: "PARENT_TASK",
      score: null,
      tokens: 90,
      truncated: false,
    };
    const excludedItem = {
      id: input.excludedId,
      kind: "KNOWLEDGE_ITEM",
      title: input.titles.excluded,
      reason: "FTS_MATCH",
      score: 0.12,
      tokens: 800,
      truncated: false,
    };

    const sections = [
      {
        kind: "SUMMARY",
        title: "Resumo do Project",
        items: [summaryItem],
        tokens: 240,
        budgetTokens: 2000,
        truncated: false,
      },
      {
        kind: "KNOWLEDGE",
        title: "Páginas relevantes",
        items: [pageItem],
        tokens: 1500,
        budgetTokens: 1700,
        truncated: true,
      },
      {
        kind: "LINEAGE",
        title: "Task mãe e dependências",
        items: [taskItem],
        tokens: 90,
        budgetTokens: 700,
        truncated: false,
      },
    ];
    const excluded = [{ section: "KNOWLEDGE", item: excludedItem, reason: "TOTAL_BUDGET" }];
    const budget = {
      totalTokens: 6000,
      frameTokens: 130,
      summaryMinTokens: 300,
      sections: {
        SUMMARY: 2000,
        DECISIONS: 880,
        KNOWLEDGE: 1700,
        LINEAGE: 700,
        ARTIFACTS: 300,
        SKILLS: 170,
      },
    };
    const usage = { estimatedTokens: 1960, itemCount: 3, excludedCount: 1 };
    const policy = {
      enabled: true,
      budgetTokens: 6000,
      maxKnowledgeItems: 8,
      maxDecisions: 5,
      maxArtifacts: 10,
      includeProjectSummary: true,
      includeDecisions: true,
      includeParentContext: true,
      includeDependencyContext: true,
      source: {
        loadout: {
          id: owner.loadout_id,
          version: owner.loadout_version,
          knowledgePolicy: { includeProjectSummary: true, includeDecisions: true, maxItems: 10 },
          contextPolicy: {
            includeParentContext: true,
            includeDependencyContext: true,
            maxTokens: 0,
          },
        },
        settings: {
          enabled: true,
          budgetTokens: 6000,
          maxKnowledgeItems: 8,
          maxDecisions: 5,
          maxArtifacts: 10,
        },
      },
    };

    const text = [
      "<context>",
      "<summary>",
      `<project-summary id="${input.summaryId}">${input.titles.summary}</project-summary>`,
      "</summary>",
      "<knowledge>",
      `<knowledge-item id="${input.pageId}" type="PROCEDURE">${input.titles.page} […]</knowledge-item>`,
      "</knowledge>",
      "<related-tasks>",
      `<task id="${owner.task_id}" relation="parent">${owner.task_title}</task>`,
      "</related-tasks>",
      "</context>",
    ].join("\n");

    const contextId = randomUUID();
    await client.query(
      `INSERT INTO run_context
         (id, user_id, run_id, task_id, project_id, status, text, query, sections, excluded,
          budget, usage, policy, inherited_from_run_id, error, assembled_at)
       VALUES ($1, $2, $3, $4, $5, 'ASSEMBLED', $6, $7, $8::jsonb, $9::jsonb, $10::jsonb,
               $11::jsonb, $12::jsonb, $13, NULL, now() - interval '2 minutes')`,
      [
        contextId,
        owner.user_id,
        input.runId,
        owner.task_id,
        owner.project_id,
        text,
        "sala & norte",
        JSON.stringify(sections),
        JSON.stringify(excluded),
        JSON.stringify(budget),
        JSON.stringify(usage),
        JSON.stringify(policy),
        input.inheritedFromRunId ?? null,
      ],
    );

    if (input.withToolCalls === true) {
      const at = new Date().toISOString();
      const events = [
        {
          type: "ToolCall",
          timestamp: at,
          harness: "CLAUDE_CODE",
          toolCallId: "call-grimorio-1",
          name: "mcp__knowledge__search_knowledge",
          arguments: '{"query":"portão"}',
        },
        {
          type: "ToolResult",
          timestamp: at,
          harness: "CLAUDE_CODE",
          toolCallId: "call-grimorio-1",
          ok: true,
          output: `1 página: ${input.titles.page}`,
        },
        {
          type: "ToolCall",
          timestamp: at,
          harness: "CLAUDE_CODE",
          toolCallId: "call-bash-1",
          name: "Bash",
          arguments: "pnpm test",
        },
      ];
      for (const payload of events) {
        await client.query(
          `INSERT INTO run_event (id, user_id, run_id, sequence, type, timestamp, payload)
           SELECT $1, $2, $3, coalesce(max(sequence), 0) + 1, $4, now(), $5::jsonb
             FROM run_event WHERE run_id = $3`,
          [randomUUID(), owner.user_id, input.runId, payload.type, JSON.stringify(payload)],
        );
      }
    }

    await client.query("COMMIT");
    return { contextId, taskId: owner.task_id, projectId: owner.project_id, text };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export interface SeedRegistryInput {
  /** Um sufixo para os nomes ficarem únicos entre testes. */
  readonly suffix: string;
}

export interface SeedRegistryResult {
  readonly skillId: string;
  readonly toolId: string;
  readonly mcpServerId: string;
  readonly providerId: string;
  readonly names: {
    readonly skill: string;
    readonly tool: string;
    readonly mcpServer: string;
    readonly provider: string;
  };
  readonly contents: { readonly v1: string; readonly v2: string };
}

/**
 * Deixa o Arsenal com um registro de cada, por SQL no banco do e2e (Fase 8C).
 *
 * Uma Habilidade com duas versões (a v2 acrescenta uma linha à v1, para o
 * diff ter o que mostrar), um Item de comando, uma Relíquia `STDIO` com um
 * caminho com espaço nos argumentos e uma variável de ambiente só pelo nome,
 * e um Patronato por chave de API que declara a Guilda do Claude Code. Tudo
 * escopado ao único usuário local, que o `db:seed` do banco embutido já criou.
 *
 * A escrita é direta porque o que os testes provam é a leitura e a edição
 * pela interface: criar pela API já é coberto pelos testes da API. Os ids são
 * UUID v4 do Node, como nas outras fixtures.
 */
export async function seedRegistry(input: SeedRegistryInput): Promise<SeedRegistryResult> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL não está no ambiente: rode pelo run-e2e.mjs.");
  }

  const names = {
    skill: `Testes de plataforma ${input.suffix}`,
    tool: `Status do git ${input.suffix}`,
    mcpServer: `reliquia-${input.suffix}`,
    provider: `Oráculo ${input.suffix}`,
  };
  const contents = {
    v1: "# Testes\n\nRode `pnpm test` antes de commitar.\nConfira o CI nos dois sistemas.",
    v2: "# Testes\n\nRode `pnpm test` antes de commitar.\nConfira o CI nos dois sistemas.\nProve que o vermelho é vermelho.",
  };

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");

    const user = await client.query<{ id: string }>(`SELECT id FROM "user" LIMIT 1`);
    const userId = user.rows[0]?.id;
    if (userId === undefined) throw new Error("O banco do e2e não tem o usuário local.");

    const skillId = randomUUID();
    await client.query(
      `INSERT INTO skill (id, user_id, name, description, latest_version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 2, now() - interval '2 minutes', now() - interval '1 minute')`,
      [skillId, userId, names.skill, "Como testar nos dois sistemas."],
    );
    await client.query(
      `INSERT INTO skill_version (id, user_id, skill_id, version, content, changelog, created_at)
       VALUES ($1, $2, $3, 1, $4, NULL, now() - interval '2 minutes'),
              ($5, $2, $3, 2, $6, 'Acrescenta a prova do vermelho.', now() - interval '1 minute')`,
      [randomUUID(), userId, skillId, contents.v1, randomUUID(), contents.v2],
    );

    const toolId = randomUUID();
    await client.query(
      `INSERT INTO tool (id, user_id, name, kind, command, mcp_server_id, tool_name, description)
       VALUES ($1, $2, $3, 'COMMAND', 'git status', NULL, NULL, 'Só lê o estado do repositório.')`,
      [toolId, userId, names.tool],
    );

    const mcpServerId = randomUUID();
    await client.query(
      `INSERT INTO mcp_server
         (id, user_id, name, transport, command, args, url, env_keys, read_only, built_in, description)
       VALUES ($1, $2, $3, 'STDIO', 'node', $4::jsonb, NULL, $5::jsonb, true, false, 'Uma Relíquia do e2e.')`,
      [
        mcpServerId,
        userId,
        names.mcpServer,
        JSON.stringify(["C:\\Program Files\\reliquia\\server.js", "--porta", "0"]),
        JSON.stringify(["RELIQUIA_TOKEN"]),
      ],
    );

    const providerId = randomUUID();
    await client.query(
      `INSERT INTO provider (id, user_id, name, kind, auth_env_keys, harness_keys, docs_url)
       VALUES ($1, $2, $3, 'API_KEY', $4::jsonb, $5::jsonb, 'https://example.invalid/oraculo')`,
      [
        providerId,
        userId,
        names.provider,
        JSON.stringify(["DM_E2E_ORACULO_KEY"]),
        JSON.stringify(["CLAUDE_CODE"]),
      ],
    );

    await client.query("COMMIT");
    return { skillId, toolId, mcpServerId, providerId, names, contents };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
