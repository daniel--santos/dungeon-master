import type { ModelPrice, ModelPriceFailure } from "@dungeon-master/contracts";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "./client.js";
import { appendDashboardEvent, type DatabaseExecutor } from "./dashboard-event.js";
import { newId } from "./ids.js";
import { recomputeMetricDailyForModel } from "./metric-projector.js";
import { failed, ok, type Result } from "./result.js";
import { harnesses, models } from "./schema/execution.js";
import { modelPrices, type ModelPriceRow } from "./schema/metrics.js";

/**
 * O preço de um Model, por vigência (planejamento v0.4, Fase 10A).
 *
 * **Append-only.** Cadastrar um preço novo fecha a vigência anterior e abre
 * outra; nada é sobrescrito. Sem isso, o custo de março mudaria sozinho no dia
 * de um reajuste em abril, e o relatório do mês passado deixaria de bater com o
 * que foi de fato pago.
 *
 * Gravar um preço **recalcula o rollup dos dias em que aquele Model apareceu**:
 * `metric_daily` é derivado de `run_metric` mais o preço vigente, e sem o
 * recálculo a tela continuaria mostrando `NOT_MEASURED` para Runs que acabaram
 * de ganhar preço até alguém rodar uma reconstrução completa.
 */

function toModelPrice(
  row: ModelPriceRow,
  model?: { key: string | null; name: string | null },
): ModelPrice {
  return {
    id: row.id,
    modelId: row.modelId,
    modelKey: model?.key ?? null,
    modelName: model?.name ?? null,
    currency: row.currency,
    inputPerMillion: Number(row.inputPerMillion),
    outputPerMillion: Number(row.outputPerMillion),
    cacheReadPerMillion: Number(row.cacheReadPerMillion),
    cacheWritePerMillion: Number(row.cacheWritePerMillion),
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

/** As vigências correntes, uma por Model que tem preço. */
export async function listCurrentModelPrices(
  db: DatabaseExecutor,
  input: { userId: string },
): Promise<ModelPrice[]> {
  const rows = await db
    .select({ price: modelPrices, key: models.key, name: models.name })
    .from(modelPrices)
    .leftJoin(models, eq(models.id, modelPrices.modelId))
    .where(and(eq(modelPrices.userId, input.userId), isNull(modelPrices.effectiveTo)))
    .orderBy(models.name, modelPrices.modelId);

  return rows.map((row) => toModelPrice(row.price, { key: row.key, name: row.name }));
}

/** O histórico de um Model, da vigência mais recente para a mais antiga. */
export async function listModelPriceHistory(
  db: DatabaseExecutor,
  input: { userId: string; modelId: string },
): Promise<ModelPrice[]> {
  const rows = await db
    .select({ price: modelPrices, key: models.key, name: models.name })
    .from(modelPrices)
    .leftJoin(models, eq(models.id, modelPrices.modelId))
    .where(and(eq(modelPrices.userId, input.userId), eq(modelPrices.modelId, input.modelId)))
    .orderBy(desc(modelPrices.effectiveFrom), desc(modelPrices.id));

  return rows.map((row) => toModelPrice(row.price, { key: row.key, name: row.name }));
}

export interface SetModelPriceInput {
  userId: string;
  modelId: string;
  currency: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
  effectiveFrom?: Date;
  note?: string | null;
}

/**
 * Abre uma vigência nova, fechando a corrente.
 *
 * Devolve `null` quando o Model não existe. Recusa quando a vigência nova não
 * começa **depois** do início da corrente: permitir isso deixaria duas
 * vigências cobrindo o mesmo instante, e `priceAt` teria de desempatar — o
 * desempate de um dado torto não é regra de negócio.
 */
export async function setModelPrice(
  db: Database,
  input: SetModelPriceInput,
): Promise<Result<ModelPrice, ModelPriceFailure> | null> {
  const [model] = await db
    .select({ id: models.id, key: models.key, name: models.name, harnessKey: harnesses.key })
    .from(models)
    .innerJoin(harnesses, eq(harnesses.id, models.harnessId))
    .where(and(eq(models.id, input.modelId), eq(models.userId, input.userId)));

  if (model === undefined) return null;

  const effectiveFrom = input.effectiveFrom ?? new Date();

  const resultado = await db.transaction(async (tx) => {
    // `for update` na vigência corrente: dois `PUT` simultâneos no mesmo Model
    // fechariam a mesma linha e o índice único parcial recusaria o segundo com
    // um erro de banco em vez de uma resposta explicável.
    const { rows } = await tx.execute<{ id: string; effective_from: Date }>(
      sql`select id, effective_from from model_price
          where user_id = ${input.userId}::uuid
            and model_id = ${input.modelId}::uuid
            and effective_to is null
          for update`,
    );

    const corrente = rows[0];
    if (corrente !== undefined) {
      if (new Date(corrente.effective_from).getTime() >= effectiveFrom.getTime()) {
        return failed<ModelPriceFailure>("EFFECTIVE_FROM_NOT_AFTER_CURRENT");
      }
      await tx
        .update(modelPrices)
        .set({ effectiveTo: effectiveFrom })
        .where(eq(modelPrices.id, corrente.id));
    }

    const [row] = await tx
      .insert(modelPrices)
      .values({
        id: newId(),
        userId: input.userId,
        modelId: input.modelId,
        currency: input.currency,
        inputPerMillion: String(input.inputPerMillion),
        outputPerMillion: String(input.outputPerMillion),
        cacheReadPerMillion: String(input.cacheReadPerMillion ?? 0),
        cacheWritePerMillion: String(input.cacheWritePerMillion ?? 0),
        effectiveFrom,
        note: input.note ?? null,
      })
      .returning();

    if (row === undefined) throw new Error("A inserção em model_price não devolveu linha.");

    await appendDashboardEvent(tx, {
      userId: input.userId,
      type: "model.updated",
      payload: { id: input.modelId, changed: ["price"] },
    });

    return ok(toModelPrice(row, { key: model.key, name: model.name }));
  });

  if (resultado.ok) {
    // Fora da transação do preço de propósito: o recálculo pode tocar muitos
    // dias, e segurar a linha do preço travada enquanto ele roda bloquearia
    // qualquer outro `PUT`. Uma falha aqui deixa o rollup velho, não o preço.
    await recomputeMetricDailyForModel(db, {
      userId: input.userId,
      harnessKey: model.harnessKey,
      modelKey: model.key,
    });
  }

  return resultado;
}
