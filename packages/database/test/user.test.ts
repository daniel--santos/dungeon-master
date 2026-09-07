import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createDatabase, type DatabaseHandle } from "../src/client.js";
import { pingDatabase } from "../src/health.js";
import { newId } from "../src/ids.js";
import { users, userSettings } from "../src/schema/user.js";
import { LOCAL_USER_ID, seedLocalUser } from "../src/seed.js";

let handle: DatabaseHandle;

beforeAll(() => {
  handle = createDatabase({ url: inject("databaseUrl"), max: 2, applicationName: "vitest" });
});

afterAll(async () => {
  await handle.close();
});

describe("conexão", () => {
  it("responde ao SELECT 1", async () => {
    const result = await pingDatabase(handle.db);

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
  });
});

describe("usuário semeado", () => {
  it("existe depois das migrações e do seed", async () => {
    const rows = await handle.db.select().from(users).where(eq(users.id, LOCAL_USER_ID));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(LOCAL_USER_ID);
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
  });

  it("é idempotente: semear de novo não duplica", async () => {
    const again = await seedLocalUser(handle.db);
    expect(again.created).toBe(false);

    const rows = await handle.db.select({ id: users.id }).from(users);
    expect(rows.filter((row) => row.id === LOCAL_USER_ID)).toHaveLength(1);
  });
});

describe("user_setting", () => {
  it("grava e lê um valor JSON pela chave composta", async () => {
    const key = `test.theme.${newId()}`;

    await handle.db.insert(userSettings).values({
      userId: LOCAL_USER_ID,
      key,
      value: { enabled: true, glossary: "dnd" },
    });

    const rows = await handle.db.select().from(userSettings).where(eq(userSettings.key, key));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toEqual({ enabled: true, glossary: "dnd" });
    expect(rows[0]?.updatedAt).toBeInstanceOf(Date);

    await handle.db.delete(userSettings).where(eq(userSettings.key, key));
  });
});

describe("identificadores", () => {
  it("gera UUIDv7 com variante correta e ordem crescente", async () => {
    const first = newId();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = newId();

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second > first).toBe(true);
  });

  it("o id do usuário local é um UUIDv7 válido", () => {
    expect(LOCAL_USER_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
