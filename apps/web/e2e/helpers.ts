import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Page } from "@playwright/test";
import { Client } from "pg";

/**
 * Utilitários compartilhados pelas suítes de ponta a ponta.
 *
 * O banco é um só para a suíte inteira e as suítes rodam em série, então uma
 * delas deixar o tema desligado quebraria a seguinte. `setTheme` deixa o estado
 * explícito no começo de cada teste que depende de label.
 */

/** Liga ou desliga o interruptor de tema, pela tela de configurações. */
export async function setTheme(page: Page, on: boolean): Promise<void> {
  await page.goto("/settings");

  const toggle = page.getByRole("switch");
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
