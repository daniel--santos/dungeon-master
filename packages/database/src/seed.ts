import { eq } from "drizzle-orm";

import type { Database } from "./client.js";
import { users } from "./schema/user.js";

/**
 * Identificador do único usuário local.
 *
 * O sistema não tem login (planejamento v0.4, decisões de partida da Fase 0);
 * toda tabela com `user_id` aponta para este registro. O valor é um UUIDv7
 * válido e fixo, escolhido para ser reconhecível em consultas manuais:
 * versão `7`, variante `8`, sufixo `...0001`. Ele nunca muda, e nenhum outro
 * registro pode usá-lo.
 */
export const LOCAL_USER_ID = "01996d00-0000-7000-8000-000000000001" as const;

export interface SeedResult {
  readonly userId: string;
  /** `true` quando a linha foi inserida agora; `false` quando já existia. */
  readonly created: boolean;
}

/** Garante que o usuário local existe. Idempotente. */
export async function seedLocalUser(db: Database): Promise<SeedResult> {
  const inserted = await db
    .insert(users)
    .values({ id: LOCAL_USER_ID })
    .onConflictDoNothing({ target: users.id })
    .returning({ id: users.id });

  if (inserted.length > 0) {
    return { userId: LOCAL_USER_ID, created: true };
  }

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.id, LOCAL_USER_ID));

  if (existing.length === 0) {
    throw new Error(`Falha ao semear o usuário local ${LOCAL_USER_ID}.`);
  }

  return { userId: LOCAL_USER_ID, created: false };
}
