import { describe, expect, it } from "vitest";

import { ACTIVITY_TYPE_VALUES, ActivitySchema } from "./activity.js";
import { DashboardEventTypeSchema } from "./dashboard-event.js";
import { CaptureInboxSchema, PromoteInboxSchema } from "./inbox.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PageQuerySchema } from "./pagination.js";
import { CreateProjectSchema, ProjectDetailSchema } from "./project.js";
import {
  ChangeTaskStatusSchema,
  CreateTaskSchema,
  DEFAULT_TASK_KIND,
  DEFAULT_TASK_PRIORITY,
  TASK_STATUS_VALUES,
  TASK_TITLE_MAX_LENGTH,
  TaskListQuerySchema,
  TaskSchema,
  TaskStatusCountsSchema,
  UpdateTaskSchema,
} from "./task.js";

const UUID = "01996d00-0000-7000-8000-000000000001";

describe("TaskSchema", () => {
  it("aceita uma Task de Inbox, sem Project", () => {
    const parsed = TaskSchema.parse({
      id: UUID,
      projectId: null,
      parentTaskId: null,
      workflowId: null,
      title: "ver por que a autenticação quebra no módulo X",
      description: null,
      kind: "RESEARCH",
      status: "INBOX",
      priority: "MEDIUM",
      completedAt: null,
      createdAt: "2026-09-07T12:00:00.000Z",
      updatedAt: "2026-09-07T12:00:00.000Z",
    });

    expect(parsed.projectId).toBeNull();
  });

  it("rejeita um status fora dos nove estados", () => {
    expect(TaskSchema.shape.status.safeParse("ARCHIVED").success).toBe(false);
  });

  it("TaskStatusCounts tem exatamente uma chave por status", () => {
    expect(Object.keys(TaskStatusCountsSchema.shape).sort()).toEqual(
      [...TASK_STATUS_VALUES].sort(),
    );
  });
});

describe("CreateTaskSchema", () => {
  it("exige projectId", () => {
    expect(CreateTaskSchema.safeParse({ title: "sem projeto" }).success).toBe(false);
  });

  it("deixa kind e priority de fora, com padrões documentados", () => {
    const parsed = CreateTaskSchema.parse({ projectId: UUID, title: "  com espaços  " });

    expect(parsed.kind).toBeUndefined();
    expect(parsed.priority).toBeUndefined();
    // O título é normalizado no schema, não no handler.
    expect(parsed.title).toBe("com espaços");
    expect(DEFAULT_TASK_KIND).toBe("FEATURE");
    expect(DEFAULT_TASK_PRIORITY).toBe("MEDIUM");
  });

  it("rejeita título vazio ou só de espaços", () => {
    expect(CreateTaskSchema.safeParse({ projectId: UUID, title: "   " }).success).toBe(false);
  });

  it("rejeita título acima do limite", () => {
    const title = "a".repeat(TASK_TITLE_MAX_LENGTH + 1);
    expect(CreateTaskSchema.safeParse({ projectId: UUID, title }).success).toBe(false);
  });
});

describe("UpdateTaskSchema", () => {
  it("não tem campo de status: a transição tem rota própria", () => {
    expect(Object.keys(UpdateTaskSchema.shape)).not.toContain("status");
    expect(ChangeTaskStatusSchema.shape.to.safeParse("QUEUED").success).toBe(true);
  });

  it("aceita desligar a Task mãe com null", () => {
    expect(UpdateTaskSchema.parse({ parentTaskId: null }).parentTaskId).toBeNull();
  });
});

describe("TaskListQuerySchema", () => {
  it("aceita status como valor único e como lista", () => {
    expect(TaskListQuerySchema.parse({ status: "READY" }).status).toBe("READY");
    expect(TaskListQuerySchema.parse({ status: ["READY", "BLOCKED"] }).status).toEqual([
      "READY",
      "BLOCKED",
    ]);
  });

  it("rejeita página não numérica", () => {
    expect(TaskListQuerySchema.safeParse({ page: "abacate" }).success).toBe(false);
    expect(TaskListQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(PageQuerySchema.safeParse({ page: "3", pageSize: "10" }).success).toBe(true);
  });

  it("o padrão de página cabe no teto", () => {
    expect(DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });
});

describe("Inbox", () => {
  it("a captura é só texto", () => {
    expect(Object.keys(CaptureInboxSchema.shape)).toEqual(["text"]);
    expect(CaptureInboxSchema.safeParse({ text: "" }).success).toBe(false);
  });

  it("promover exige o Project", () => {
    expect(PromoteInboxSchema.safeParse({}).success).toBe(false);
    expect(PromoteInboxSchema.safeParse({ projectId: UUID }).success).toBe(true);
  });
});

describe("Activity e DashboardEventType", () => {
  it("todo tipo de activity também é um tipo de evento de dashboard", () => {
    for (const type of ACTIVITY_TYPE_VALUES) {
      expect(DashboardEventTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("activity recusa um tipo fora do vocabulário", () => {
    const linha = {
      id: UUID,
      projectId: UUID,
      taskId: null,
      payload: { a: 1 },
      createdAt: "2026-09-07T12:00:00.000Z",
    };

    expect(ActivitySchema.safeParse({ ...linha, type: "task.created" }).success).toBe(true);
    expect(ActivitySchema.safeParse({ ...linha, type: "task.exploded" }).success).toBe(false);
  });
});

describe("ProjectDetailSchema", () => {
  it("carrega a contagem por status", () => {
    const counts = Object.fromEntries(TASK_STATUS_VALUES.map((status) => [status, 0]));

    const parsed = ProjectDetailSchema.parse({
      id: UUID,
      title: "Dungeon Master",
      description: null,
      status: "ACTIVE",
      workspaceKind: "GIT_REPO",
      workspacePath: null,
      archivedAt: null,
      createdAt: "2026-09-07T12:00:00.000Z",
      updatedAt: "2026-09-07T12:00:00.000Z",
      taskCounts: counts,
    });

    expect(parsed.taskCounts.READY).toBe(0);
  });

  it("rejeita título vazio na criação", () => {
    expect(CreateProjectSchema.safeParse({ title: " " }).success).toBe(false);
  });
});
