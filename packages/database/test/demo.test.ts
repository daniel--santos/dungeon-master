import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from "vitest";

import { listProjectActivity } from "../src/activity.js";
import { createDatabase, type DatabaseHandle } from "../src/client.js";
import { seedDemoData } from "../src/demo.js";
import { listProjects } from "../src/project.js";
import { activities } from "../src/schema/activity.js";
import { dashboardEvents } from "../src/schema/dashboard-event.js";
import { projects } from "../src/schema/project.js";
import { taskDependencies, tasks } from "../src/schema/task.js";
import { LOCAL_USER_ID } from "../src/seed.js";
import { listTasks } from "../src/task.js";

/**
 * A massa de demonstração é o primeiro conteúdo que alguém vê, então ela
 * precisa provar duas coisas: que cobre o que as telas mostram, e que rodar o
 * comando de novo não duplica nada.
 */

let handle: DatabaseHandle;

beforeAll(() => {
  handle = createDatabase({ url: inject("databaseUrl"), max: 3, applicationName: "vitest-demo" });
});

afterEach(async () => {
  await limpar();
});

afterAll(async () => {
  await limpar();
  await handle.close();
});

async function limpar(): Promise<void> {
  await handle.db.delete(activities).where(eq(activities.userId, LOCAL_USER_ID));
  await handle.db.delete(taskDependencies).where(eq(taskDependencies.userId, LOCAL_USER_ID));
  await handle.db.delete(tasks).where(eq(tasks.userId, LOCAL_USER_ID));
  await handle.db.delete(projects).where(eq(projects.userId, LOCAL_USER_ID));
  await handle.db.delete(dashboardEvents).where(eq(dashboardEvents.userId, LOCAL_USER_ID));
}

async function todasAsTasks() {
  const page = await listTasks(handle.db, { userId: LOCAL_USER_ID, page: 1, pageSize: 100 });
  return page.items;
}

describe("massa de demonstração", () => {
  it("cria dois Projects, catorze Tasks e três capturas", async () => {
    const resultado = await seedDemoData(handle.db, { userId: LOCAL_USER_ID });

    expect(resultado.projectsCreated).toBe(2);
    expect(resultado.tasksCreated).toBe(14);

    const projetos = await listProjects(handle.db, {
      userId: LOCAL_USER_ID,
      page: 1,
      pageSize: 10,
    });
    expect(projetos.items.map((item) => item.title).sort()).toEqual([
      "Expedição ao Legado",
      "Forja de Widgets",
    ]);

    const itens = await todasAsTasks();
    expect(itens).toHaveLength(14);
    expect(itens.filter((task) => task.status === "INBOX")).toHaveLength(3);
    expect(itens.filter((task) => task.parentTaskId !== null)).toHaveLength(2);
  });

  it("varia kind, prioridade e status, sem deixar nada em QUEUED nem RUNNING", async () => {
    await seedDemoData(handle.db, { userId: LOCAL_USER_ID });
    const itens = await todasAsTasks();

    expect(new Set(itens.map((task) => task.kind))).toEqual(
      new Set(["BUG", "FEATURE", "RESEARCH", "CHORE"]),
    );
    expect(new Set(itens.map((task) => task.priority))).toEqual(
      new Set(["LOW", "MEDIUM", "HIGH", "URGENT"]),
    );
    expect(new Set(itens.map((task) => task.status))).toEqual(
      new Set(["INBOX", "READY", "BLOCKED", "COMPLETED", "CANCELLED"]),
    );

    // `BLOCKED` só é alcançável a partir de `RUNNING`, então a Task travada
    // atravessa QUEUED e RUNNING — mas nenhuma pode ficar lá.
    expect(itens.filter((task) => task.status === "QUEUED" || task.status === "RUNNING")).toEqual(
      [],
    );
  });

  it("cria duas dependências", async () => {
    await seedDemoData(handle.db, { userId: LOCAL_USER_ID });

    const arestas = await handle.db
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.userId, LOCAL_USER_ID));

    expect(arestas).toHaveLength(2);
  });

  it("gera activity e dashboard_event pelas mesmas funções da API", async () => {
    await seedDemoData(handle.db, { userId: LOCAL_USER_ID });

    const diario = await handle.db
      .select()
      .from(activities)
      .where(eq(activities.userId, LOCAL_USER_ID));
    const stream = await handle.db
      .select()
      .from(dashboardEvents)
      .where(eq(dashboardEvents.userId, LOCAL_USER_ID));

    // Um `INSERT` direto não produziria nenhuma das duas tabelas.
    expect(diario.length).toBeGreaterThan(14);
    expect(stream).toHaveLength(diario.length);
    expect(new Set(diario.map((linha) => linha.type))).toEqual(
      new Set([
        "project.created",
        "task.created",
        "task.status_changed",
        "task.dependency_created",
      ]),
    );

    const forja = (
      await listProjects(handle.db, { userId: LOCAL_USER_ID, page: 1, pageSize: 10 })
    ).items.find((item) => item.title === "Forja de Widgets");

    const paginaDoDiario = await listProjectActivity(handle.db, {
      userId: LOCAL_USER_ID,
      projectId: forja?.id ?? "",
      page: 1,
      pageSize: 100,
    });

    expect(paginaDoDiario.total).toBeGreaterThan(0);
  });

  it("rodar de novo não duplica nada", async () => {
    await seedDemoData(handle.db, { userId: LOCAL_USER_ID });

    const diarioAntes = await handle.db
      .select()
      .from(activities)
      .where(eq(activities.userId, LOCAL_USER_ID));

    const segunda = await seedDemoData(handle.db, { userId: LOCAL_USER_ID });

    expect(segunda.projectsCreated).toBe(0);
    expect(segunda.tasksCreated).toBe(0);

    expect(await todasAsTasks()).toHaveLength(14);

    const projetos = await listProjects(handle.db, {
      userId: LOCAL_USER_ID,
      page: 1,
      pageSize: 10,
    });
    expect(projetos.total).toBe(2);

    // Nem um fato a mais: a segunda passada não escreveu nada.
    const diarioDepois = await handle.db
      .select()
      .from(activities)
      .where(eq(activities.userId, LOCAL_USER_ID));
    expect(diarioDepois).toHaveLength(diarioAntes.length);
  });
});
