import type { components } from "@dungeon-master/api-client";
import { DEFAULT_THEME, dnd, plain } from "@dungeon-master/glossary";
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskTable } from "@/components/task/task-table";
import { useGlossaryStore } from "@/lib/glossary";
import { renderInRouter } from "@/test/router";

type Task = components["schemas"]["Task"];

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "0199aaaa-0000-7000-8000-000000000001",
    projectId: "0199bbbb-0000-7000-8000-000000000001",
    parentTaskId: null,
    title: "Encerrar a árvore de processos no Windows",
    description: null,
    kind: "BUG",
    status: "READY",
    priority: "URGENT",
    completedAt: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-06T12:00:00.000Z",
    ...overrides,
  };
}

const TASKS: Task[] = [
  task(),
  task({
    id: "0199aaaa-0000-7000-8000-000000000002",
    title: "Avaliar o CLI em modo headless",
    kind: "RESEARCH",
    status: "COMPLETED",
    priority: "LOW",
  }),
];

const PROJECTS = new Map([["0199bbbb-0000-7000-8000-000000000001", "Dungeon Master"]]);

function renderTable(onSortChange = vi.fn()) {
  return renderInRouter(
    <TaskTable
      empty={<p>vazio</p>}
      error={null}
      isPending={false}
      onPageChange={vi.fn()}
      onSortChange={onSortChange}
      order="desc"
      page={1}
      pageSize={25}
      projectTitles={PROJECTS}
      sort="updatedAt"
      tasks={TASKS}
      total={2}
    />,
  );
}

afterEach(() => {
  cleanup();
  act(() => {
    useGlossaryStore.getState().setTheme(DEFAULT_THEME);
  });
});

describe("tabela da lista", () => {
  it("renderiza uma linha por item, com o título ligado ao detalhe", () => {
    renderTable();

    for (const item of TASKS) {
      const link = screen.getByRole("link", { name: item.title });
      expect(link.getAttribute("href")).toBe(`/tasks/${item.id}`);
    }
  });

  it("mostra tipo, estado e prioridade com os labels do glossário ativo", () => {
    renderTable();

    expect(screen.getByText(dnd["entity.task.kind.bug"])).toBeTruthy();
    expect(screen.getByText(dnd["entity.task.kind.research"])).toBeTruthy();
    expect(screen.getByText(dnd["task.status.ready"])).toBeTruthy();
    expect(screen.getByText(dnd["task.priority.urgent"])).toBeTruthy();
    expect(screen.getByText(dnd["entity.project"])).toBeTruthy();
  });

  it("troca os labels quando o tema muda, sem mexer nos dados", () => {
    renderTable();

    act(() => {
      useGlossaryStore.getState().setTheme("plain");
    });

    expect(screen.getByText(plain["entity.task.kind.bug"])).toBeTruthy();
    expect(screen.queryByText(dnd["entity.task.kind.bug"])).toBeNull();
    expect(screen.getByText(plain["entity.project"])).toBeTruthy();

    // Os dados e a rota não mudam com o tema.
    expect(screen.getByRole("link", { name: TASKS[0]!.title }).getAttribute("href")).toBe(
      `/tasks/${TASKS[0]!.id}`,
    );
  });

  it("pede a ordenação ao servidor quando a coluna é clicada", () => {
    const onSortChange = vi.fn();
    renderTable(onSortChange);

    screen.getByRole("button", { name: /Prioridade/ }).click();

    expect(onSortChange).toHaveBeenCalledWith("priority", "desc");
  });
});
