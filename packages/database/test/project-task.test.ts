import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from "vitest";

import { createDatabase, type DatabaseHandle } from "../src/client.js";
import { newId } from "../src/ids.js";
import { createProject } from "../src/project.js";
import { activities } from "../src/schema/activity.js";
import { dashboardEvents } from "../src/schema/dashboard-event.js";
import { projects } from "../src/schema/project.js";
import { taskDependencies, tasks } from "../src/schema/task.js";
import { LOCAL_USER_ID } from "../src/seed.js";
import { changeTaskStatus, createTask } from "../src/task.js";

/**
 * O que só o banco consegue provar: as restrições que a aplicação não pode
 * contornar nem por engano. As regras de domínio e as rotas têm testes
 * próprios; aqui o alvo são os `CHECK`, o escopo por `user_id` e o fato de
 * mudança e evento saírem na mesma transação.
 */

let handle: DatabaseHandle;

beforeAll(() => {
  handle = createDatabase({ url: inject("databaseUrl"), max: 3, applicationName: "vitest-work" });
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

async function projetoAtivo(title = "Projeto") {
  return await createProject(handle.db, { userId: LOCAL_USER_ID, title });
}

describe("CHECK task_inbox_project_ck", () => {
  it("aceita project_id nulo quando o status é INBOX", async () => {
    await expect(
      handle.pool.query(
        "insert into task (id, user_id, project_id, title, status) values ($1, $2, null, $3, 'INBOX')",
        [newId(), LOCAL_USER_ID, "captura"],
      ),
    ).resolves.toBeDefined();
  });

  it("aceita project_id nulo em CANCELLED: é a captura descartada", async () => {
    await expect(
      handle.pool.query(
        "insert into task (id, user_id, project_id, title, status) values ($1, $2, null, $3, 'CANCELLED')",
        [newId(), LOCAL_USER_ID, "descartada"],
      ),
    ).resolves.toBeDefined();
  });

  it("recusa project_id nulo em todo estado de trabalho vivo", async () => {
    for (const status of [
      "READY",
      "QUEUED",
      "RUNNING",
      "WAITING",
      "BLOCKED",
      "COMPLETED",
      "FAILED",
    ]) {
      await expect(
        handle.pool.query(
          `insert into task (id, user_id, project_id, title, status) values ($1, $2, null, $3, '${status}')`,
          [newId(), LOCAL_USER_ID, "sem projeto"],
        ),
        status,
      ).rejects.toThrow(/task_inbox_project_ck/);
    }
  });

  it("recusa também sair de INBOX sem escolher um Project", async () => {
    const [row] = (
      await handle.pool.query<{ id: string }>(
        "insert into task (id, user_id, project_id, title, status) values ($1, $2, null, $3, 'INBOX') returning id",
        [newId(), LOCAL_USER_ID, "captura"],
      )
    ).rows;

    await expect(
      handle.pool.query("update task set status = 'READY' where id = $1", [row?.id]),
    ).rejects.toThrow(/task_inbox_project_ck/);
  });
});

describe("CHECK task_dependency_no_self_ck", () => {
  it("recusa uma Task que depende de si mesma", async () => {
    const project = await projetoAtivo();
    const criada = await createTask(handle.db, {
      userId: LOCAL_USER_ID,
      projectId: project.id,
      title: "sozinha",
    });
    expect(criada.ok).toBe(true);
    if (!criada.ok) return;

    await expect(
      handle.pool.query(
        "insert into task_dependency (user_id, task_id, depends_on_task_id) values ($1, $2, $2)",
        [LOCAL_USER_ID, criada.value.id],
      ),
    ).rejects.toThrow(/task_dependency_no_self_ck/);
  });
});

describe("gravação na mesma transação", () => {
  it("criar Task grava activity e dashboard_event junto", async () => {
    const project = await projetoAtivo();

    const criada = await createTask(handle.db, {
      userId: LOCAL_USER_ID,
      projectId: project.id,
      title: "primeira",
      kind: "BUG",
    });

    expect(criada.ok).toBe(true);
    if (!criada.ok) return;

    const registros = await handle.db
      .select()
      .from(activities)
      .where(eq(activities.taskId, criada.value.id));

    expect(registros).toHaveLength(1);
    expect(registros[0]?.type).toBe("task.created");

    const eventos = await handle.db
      .select()
      .from(dashboardEvents)
      .where(eq(dashboardEvents.userId, LOCAL_USER_ID));

    // Um para `project.created` e outro para `task.created`.
    expect(eventos.map((evento) => evento.type)).toEqual(["project.created", "task.created"]);
  });

  it("uma transição recusada não deixa rastro nenhum", async () => {
    const project = await projetoAtivo();
    const criada = await createTask(handle.db, {
      userId: LOCAL_USER_ID,
      projectId: project.id,
      title: "não vai executar",
    });
    if (!criada.ok) throw new Error("a criação deveria ter passado");

    const antes = await handle.db
      .select()
      .from(dashboardEvents)
      .where(eq(dashboardEvents.userId, LOCAL_USER_ID));

    // `READY → RUNNING` pula a fila e não existe na máquina de estados. Não é
    // `READY → COMPLETED`: essa aresta existe desde a conclusão manual, e o que
    // este teste precisa é de uma transição que o domínio realmente recuse.
    const recusada = await changeTaskStatus(handle.db, {
      userId: LOCAL_USER_ID,
      taskId: criada.value.id,
      to: "RUNNING",
    });

    expect(recusada?.ok).toBe(false);

    const depois = await handle.db
      .select()
      .from(dashboardEvents)
      .where(eq(dashboardEvents.userId, LOCAL_USER_ID));

    expect(depois).toHaveLength(antes.length);

    const [task] = await handle.db.select().from(tasks).where(eq(tasks.id, criada.value.id));
    expect(task?.status).toBe("READY");
    expect(task?.completedAt).toBeNull();
  });

  it("concluir escreve completed_at e sobe updated_at", async () => {
    const project = await projetoAtivo();
    const criada = await createTask(handle.db, {
      userId: LOCAL_USER_ID,
      projectId: project.id,
      title: "ciclo completo",
    });
    if (!criada.ok) throw new Error("a criação deveria ter passado");

    for (const to of ["QUEUED", "RUNNING", "COMPLETED"] as const) {
      const resultado = await changeTaskStatus(handle.db, {
        userId: LOCAL_USER_ID,
        taskId: criada.value.id,
        to,
      });
      expect(resultado?.ok, `transição para ${to}`).toBe(true);
    }

    const [task] = await handle.db.select().from(tasks).where(eq(tasks.id, criada.value.id));

    expect(task?.status).toBe("COMPLETED");
    expect(task?.completedAt).toBeInstanceOf(Date);
    expect(task?.updatedAt.getTime()).toBeGreaterThanOrEqual(task?.createdAt.getTime() ?? 0);
  });
});

describe("escopo por usuário", () => {
  it("uma Task de outro usuário não é encontrada", async () => {
    const outro = newId();
    await handle.pool.query('insert into "user" (id) values ($1)', [outro]);

    try {
      const projectId = newId();
      await handle.pool.query(
        "insert into project (id, user_id, title) values ($1, $2, 'alheio')",
        [projectId, outro],
      );

      const criada = await createTask(handle.db, {
        userId: LOCAL_USER_ID,
        projectId,
        title: "não deveria entrar",
      });

      expect(criada.ok).toBe(false);
      if (criada.ok) return;
      expect(criada.failure.code).toBe("PROJECT_NOT_FOUND");
    } finally {
      await handle.pool.query('delete from "user" where id = $1', [outro]);
    }
  });
});
