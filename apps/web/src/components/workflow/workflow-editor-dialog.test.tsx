import { dnd } from "@dungeon-master/glossary";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkflowEditorDialog } from "@/components/workflow/workflow-editor-dialog";
import { api } from "@/lib/api";
import { ok } from "@/test/execution-fixtures";
import { renderInRouter } from "@/test/router";
import { WORKFLOW } from "@/test/workflow-fixtures";

/**
 * O editor por texto: o que o usuário escreve em YAML sai como JSON no POST,
 * e um `422` volta como lista apontando o step e o campo — nunca como um
 * "definição inválida" solto.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const YAML = `name: Ritual escrito à mão
steps:
  - type: agent
    key: analyze
    name: Analisar
    prompt: Analise a tarefa.
  - type: command
    key: check
    name: Checar
    dependsOn: [analyze]
    argv: [git, status]
`;

/** Uma recusa da API no formato problem details, como `openapi-fetch` a devolve. */
function problem(status: number, body: Record<string, unknown>) {
  return { data: undefined, error: body, response: new Response(null, { status }) };
}

function textarea(): HTMLTextAreaElement {
  return screen.getByLabelText("Definição") as HTMLTextAreaElement;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("editor de Ritual", () => {
  it("converte o YAML em JSON antes de criar", async () => {
    client.GET.mockResolvedValue(ok({ items: [], page: 1, pageSize: 100, total: 0 }) as never);
    client.POST.mockResolvedValue(ok(WORKFLOW) as never);
    const onSaved = vi.fn();

    renderInRouter(<WorkflowEditorDialog onOpenChange={vi.fn()} onSaved={onSaved} open />);

    expect(textarea().dataset["definitionFormat"]).toBe("yaml");
    fireEvent.change(textarea(), { target: { value: YAML } });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/workflows", {
        body: {
          name: "Ritual escrito à mão",
          steps: [
            { type: "agent", key: "analyze", name: "Analisar", prompt: "Analise a tarefa." },
            {
              type: "command",
              key: "check",
              name: "Checar",
              dependsOn: ["analyze"],
              argv: ["git", "status"],
            },
          ],
        },
      });
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(WORKFLOW);
    });
  });

  it("trocar o formato converte o texto; um texto ilegível fica como está", async () => {
    client.GET.mockResolvedValue(ok({ items: [], page: 1, pageSize: 100, total: 0 }) as never);
    renderInRouter(<WorkflowEditorDialog onOpenChange={vi.fn()} open />);

    fireEvent.change(textarea(), { target: { value: YAML } });
    fireEvent.click(screen.getByRole("radio", { name: "JSON" }));

    await waitFor(() => {
      expect(textarea().dataset["definitionFormat"]).toBe("json");
    });
    expect(JSON.parse(textarea().value)).toMatchObject({ name: "Ritual escrito à mão" });

    fireEvent.change(textarea(), { target: { value: "{ quebrado" } });
    fireEvent.click(screen.getByRole("radio", { name: "YAML" }));

    await waitFor(() => {
      expect(textarea().dataset["definitionFormat"]).toBe("yaml");
    });
    // Nada do que foi escrito se perde, e o aviso explica.
    expect(textarea().value).toBe("{ quebrado");
    expect(screen.getByRole("alert").textContent).toContain("não pôde ser convertido");
  });

  it("um 422 vira a lista de issues, apontando o step pela chave", async () => {
    client.GET.mockResolvedValue(ok({ items: [], page: 1, pageSize: 100, total: 0 }) as never);
    client.POST.mockResolvedValue(
      problem(422, {
        type: "https://dungeon-master.local/problems/validation-error",
        title: "Definição inválida",
        status: 422,
        detail: "A definição quebra uma regra estrutural.",
        instance: "/api/v1/workflows",
        errors: [
          {
            path: "steps.1.dependsOn.0",
            message: 'O step "check" depende de "analyse", que não existe na definição.',
            code: "custom",
          },
        ],
      }) as never,
    );

    renderInRouter(<WorkflowEditorDialog onOpenChange={vi.fn()} open />);

    fireEvent.change(textarea(), {
      target: { value: YAML.replace("dependsOn: [analyze]", "dependsOn: [analyse]") },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("recusou a definição (1)");

    const issue = alert.querySelector('[data-definition-issue="check"]');
    expect(issue).not.toBeNull();
    expect(issue?.textContent).toContain("check · dependsOn.0");
    expect(issue?.textContent).toContain('depende de "analyse"');
  });

  it("um texto ilegível não chega à API", () => {
    client.GET.mockResolvedValue(ok({ items: [], page: 1, pageSize: 100, total: 0 }) as never);
    renderInRouter(<WorkflowEditorDialog onOpenChange={vi.fn()} open />);

    fireEvent.change(textarea(), { target: { value: "name: x\nsteps: [\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    expect(screen.getByRole("alert").textContent).toContain("não pôde ser lido");
    expect(client.POST).not.toHaveBeenCalled();
  });

  it("na edição, abre com a definição vigente e salva por PUT", async () => {
    client.GET.mockResolvedValue(
      ok({ items: [WORKFLOW], page: 1, pageSize: 100, total: 1 }) as never,
    );
    client.PUT.mockResolvedValue(ok(WORKFLOW) as never);

    renderInRouter(<WorkflowEditorDialog onOpenChange={vi.fn()} open workflow={WORKFLOW} />);

    expect(textarea().value).toContain(`name: ${WORKFLOW.name}`);
    expect(screen.getByRole("heading").textContent).toContain(`Editar ${dnd["entity.workflow"]}`);

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(client.PUT).toHaveBeenCalledWith("/api/v1/workflows/{id}", {
        params: { path: { id: WORKFLOW.id } },
        body: WORKFLOW.definition,
      });
    });
  });

  it("o exemplo preenche o texto e pode ser salvo como está", async () => {
    client.GET.mockResolvedValue(ok({ items: [], page: 1, pageSize: 100, total: 0 }) as never);
    client.POST.mockResolvedValue(ok(WORKFLOW) as never);

    renderInRouter(<WorkflowEditorDialog onOpenChange={vi.fn()} open />);

    fireEvent.click(screen.getByRole("button", { name: "Usar o exemplo" }));
    expect(textarea().value).toContain("key: approve-plan");
    expect(textarea().value).toContain(`name: ${dnd["entity.run"]} guiada (cópia)`);

    fireEvent.click(screen.getByRole("button", { name: "Criar" }));
    await waitFor(() => {
      expect(client.POST).toHaveBeenCalled();
    });
    const call = client.POST.mock.calls[0]?.[1] as unknown as { body: { steps: unknown[] } };
    expect(call.body.steps).toHaveLength(5);
  });
});
