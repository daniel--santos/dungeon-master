import { dnd } from "@dungeon-master/glossary";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewRunDialog } from "@/components/run/new-run-dialog";
import { api } from "@/lib/api";
import {
  BREAKER,
  BREAKER_ADMISSION_REFUSED,
  BUDGET_BREACH,
  GLOBAL_DENY_POLICY,
  POLICY_DENIED_DECISION,
  refused,
  SUGGESTIONS,
} from "@/test/autonomy-fixtures";
import {
  AGENT,
  DOCKER_PROFILE,
  HARNESS,
  HOST_PROFILE,
  LOADOUT,
  TASK,
  ok,
} from "@/test/execution-fixtures";
import {
  DOCKER_BLOCKER,
  MCP_WARNING,
  PREFLIGHT_BLOCKED,
  PREFLIGHT_OK,
  PREFLIGHT_WARNINGS,
  RUN_CREATED,
} from "@/test/registry-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * A Expedição não parte sem o aceite do modo host.
 *
 * É a exigência da Fase 2B — "aceite explícito para execução host" — e ela vale
 * mesmo quando tudo o mais já está escolhido. O teste também prende o texto do
 * aceite: ele precisa dizer o que vai acontecer, e não repetir o nome do modo.
 *
 * Desde a Fase 9C o diálogo pede as sugestões ao abrir, num `POST` sem
 * escrita; por isso os testes contam só as chamadas ao caminho da partida.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

const RUNS_PATH = "/api/v1/tasks/{id}/runs";
const SUGGESTIONS_PATH = "/api/v1/tasks/{id}/suggestions";

/** As respostas de que o diálogo depende, por caminho. */
const RESPONSES: Record<string, unknown> = {
  "/api/v1/loadouts": { items: [LOADOUT] },
  "/api/v1/agents": { items: [AGENT] },
  "/api/v1/harnesses": { items: [HARNESS] },
  "/api/v1/models": { items: [] },
  "/api/v1/execution-profiles": { items: [HOST_PROFILE, DOCKER_PROFILE] },
  "/api/v1/settings": { "ui.theme": "dnd", "execution.hostAcknowledged": false },
  // O preflight do Equipamento roda antes de partir (Fase 8C): sem ele a
  // partida ficaria esperando a verificação.
  "/api/v1/loadouts/{id}/preflight": PREFLIGHT_OK,
  "/api/v1/circuit-breakers/{id}": BREAKER,
  "/api/v1/approval-policies/{id}": GLOBAL_DENY_POLICY,
};

/** Quantas vezes a partida foi pedida, ignorando o `POST` das sugestões. */
function runPosts(): number {
  // O `POST` do cliente é genérico por caminho, e o Vitest tipa as chamadas
  // do espião como `never`; a lista é lida como pares `[caminho, opções]`.
  const calls = client.POST.mock.calls as unknown as readonly (readonly [string, unknown])[];
  return calls.filter(([path]) => path === RUNS_PATH).length;
}

/**
 * O `POST` por caminho: as sugestões ao abrir, e a partida com a resposta que
 * cada teste escolhe. Sem resposta para a partida, ela nem é esperada.
 */
function mockPost(runs: unknown = ok(RUN_CREATED), suggestions: unknown = ok(SUGGESTIONS)): void {
  client.POST.mockImplementation(((path: string) =>
    Promise.resolve(path === SUGGESTIONS_PATH ? suggestions : runs)) as never);
}

afterEach(() => {
  cleanup();
});

/**
 * Monta o diálogo e espera o Equipamento padrão aparecer.
 *
 * O `mockImplementation` fica aqui e não num `beforeEach` porque a
 * configuração da suíte usa `restoreMocks`, que devolve os espiões ao estado
 * original antes de cada teste — inclusive antes dos ganchos do arquivo.
 */
async function abrir(runs?: unknown): Promise<void> {
  client.GET.mockImplementation(((path: string) =>
    Promise.resolve(ok(RESPONSES[path] ?? {}))) as never);
  mockPost(runs);

  renderInRouter(<NewRunDialog onOpenChange={vi.fn()} open task={TASK} />);
  // O nome aparece duas vezes: no valor do seletor e no cartão de resumo.
  await screen.findAllByText(LOADOUT.name);
}

describe("diálogo Nova Expedição", () => {
  it("não deixa partir sem o aceite do modo host", async () => {
    await abrir();

    const depart = screen.getByRole("button", { name: "Partir" });
    expect((depart as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(depart);
    expect(runPosts()).toBe(0);
  });

  it("o aceite explica o que vai acontecer, e não só o nome do modo", async () => {
    await abrir();

    const acceptance = document.querySelector("[data-host-acknowledgement]");
    expect(acceptance).not.toBeNull();
    expect(acceptance?.textContent).toContain("acesso ao disco e à rede");
    expect(acceptance?.textContent).toContain(dnd["env.host.warning"]);
    // A diferença entre política pedida e política imposta, que é o que a
    // seção 15 do documento técnico manda a interface comunicar.
    expect(acceptance?.textContent).toContain("harness-native");
  });

  it("com o aceite marcado, parte com o prompt montado da Task", async () => {
    client.PUT.mockResolvedValue(
      ok({ "ui.theme": "dnd", "execution.hostAcknowledged": true }) as never,
    );

    await abrir(ok(RUN_CREATED));

    fireEvent.click(screen.getByLabelText(`Aceito executar ${dnd["env.host.warning"]}`));

    const depart = screen.getByRole("button", { name: "Partir" });
    await waitFor(() => {
      expect((depart as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(depart);

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith(RUNS_PATH, {
        params: { path: { id: TASK.id } },
        body: {
          loadoutId: LOADOUT.id,
          prompt: `${TASK.title}\n\n${TASK.description ?? ""}`,
        },
      });
    });
  });

  it("lembra o aceite em user_setting, para não perguntar de novo", async () => {
    client.PUT.mockResolvedValue(
      ok({ "ui.theme": "dnd", "execution.hostAcknowledged": true }) as never,
    );

    await abrir(ok(RUN_CREATED));

    fireEvent.click(screen.getByLabelText(`Aceito executar ${dnd["env.host.warning"]}`));
    fireEvent.click(screen.getByRole("button", { name: "Partir" }));

    await waitFor(() => {
      expect(client.PUT).toHaveBeenCalledWith("/api/v1/settings/{key}", {
        params: { path: { key: "execution.hostAcknowledged" } },
        body: { value: true },
      });
    });
  });

  it("o prompt reescrito sobrevive à recusa da partida", async () => {
    client.PUT.mockResolvedValue(
      ok({ "ui.theme": "dnd", "execution.hostAcknowledged": true }) as never,
    );
    // A primeira partida da máquina costuma esbarrar num `409`: Campanha sem
    // workspace, dependência pendente, perfil desligado.
    await abrir({
      data: undefined,
      error: {
        type: "about:blank",
        title: "Conflito",
        status: 409,
        detail: "A Campanha não tem workspace configurado.",
      },
      response: new Response(null, { status: 409 }),
    });

    const prompt = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
    fireEvent.change(prompt, { target: { value: "Reescrevi o prompt inteiro." } });
    fireEvent.click(screen.getByLabelText(`Aceito executar ${dnd["env.host.warning"]}`));
    fireEvent.click(screen.getByRole("button", { name: "Partir" }));

    // O aceite é gravado antes do POST: a resposta do `PUT` vira `settings` no
    // cache e `execution.hostAcknowledged` passa de false a true.
    await waitFor(() => {
      expect(client.PUT).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(runPosts()).toBe(1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(prompt.value).toBe("Reescrevi o prompt inteiro.");
  });

  it("a masmorra selada fica desabilitada enquanto nenhum perfil dela está ligado", async () => {
    await abrir();

    const docker = document.querySelector('[data-mode-option="DOCKER"] input');
    expect(docker).not.toBeNull();
    expect((docker as HTMLInputElement).disabled).toBe(true);

    // O nome do tema não some, e o texto canônico viaja com ele.
    const option = document.querySelector('[data-mode-option="DOCKER"]');
    expect(option?.textContent).toContain(dnd["env.docker"]);
    expect(option?.textContent).toContain(dnd["env.docker.canonical"]);
    // O motivo é dito, em vez de a opção só ficar apagada sem explicação.
    expect(option?.textContent).toContain("sem perfil");
  });

  it("com o perfil ligado, a masmorra selada pode ser escolhida", async () => {
    client.GET.mockImplementation(((path: string) =>
      Promise.resolve(
        ok(
          path === "/api/v1/execution-profiles"
            ? { items: [HOST_PROFILE, { ...DOCKER_PROFILE, enabled: true }] }
            : (RESPONSES[path] ?? {}),
        ),
      )) as never);
    mockPost();

    renderInRouter(<NewRunDialog onOpenChange={vi.fn()} open task={TASK} />);
    await screen.findAllByText(LOADOUT.name);

    const docker = await waitFor(() => {
      const input = document.querySelector('[data-mode-option="DOCKER"] input');
      expect((input as HTMLInputElement | null)?.disabled).toBe(false);
      return input as HTMLInputElement;
    });

    fireEvent.click(docker);

    // Escolher a masmorra selada dispensa o aceite: o aceite é do modo host.
    await waitFor(() => {
      expect(document.querySelector("[data-host-acknowledgement]")).toBeNull();
    });
    expect(document.querySelector('[data-mode-option="DOCKER"]')?.textContent).not.toContain(
      "sem perfil",
    );
  });
});

/**
 * O preflight antes de partir (Fase 8C): um bloqueio desabilita "Partir" com
 * a lista, um aviso deixa partir, e o `409` da API com `blockers[]` fica no
 * diálogo em vez de virar toast.
 */
describe("o preflight do Equipamento antes de partir", () => {
  async function abrirCom(preflight: unknown, runs?: unknown): Promise<void> {
    client.GET.mockImplementation(((path: string) =>
      Promise.resolve(
        ok(path === "/api/v1/loadouts/{id}/preflight" ? preflight : (RESPONSES[path] ?? {})),
      )) as never);
    client.PUT.mockResolvedValue(
      ok({ "ui.theme": "dnd", "execution.hostAcknowledged": true }) as never,
    );
    mockPost(runs);
    renderInRouter(<NewRunDialog onOpenChange={vi.fn()} open task={TASK} />);
    await screen.findAllByText(LOADOUT.name);
    fireEvent.click(screen.getByLabelText(`Aceito executar ${dnd["env.host.warning"]}`));
  }

  it("um bloqueio desabilita a partida e lista o motivo pelo código", async () => {
    await abrirCom(PREFLIGHT_BLOCKED);

    const block = await waitFor(() => {
      const element = document.querySelector('[data-run-preflight="blocked"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(block.textContent).toContain(dnd["run.preflight.blocked"]);

    const issue = block.querySelector(`[data-capability-issue="${DOCKER_BLOCKER.code}"]`);
    expect(issue).not.toBeNull();
    expect(issue?.getAttribute("data-capability-severity")).toBe("BLOCKER");
    expect(issue?.textContent).toContain(dnd["capability.code.dockerUnsupported"]);
    expect(issue?.textContent).toContain(DOCKER_BLOCKER.message);

    const depart = screen.getByRole("button", { name: "Partir" }) as HTMLButtonElement;
    expect(depart.disabled).toBe(true);
    fireEvent.click(depart);
    expect(runPosts()).toBe(0);
  });

  it("um aviso aparece e deixa partir", async () => {
    await abrirCom(PREFLIGHT_WARNINGS, ok(RUN_CREATED));

    const block = await waitFor(() => {
      const element = document.querySelector('[data-run-preflight="warnings"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(block.textContent).toContain(dnd["run.preflight.warnings"]);
    expect(
      block
        .querySelector(`[data-capability-issue="${MCP_WARNING.code}"]`)
        ?.getAttribute("data-capability-severity"),
    ).toBe("WARNING");

    const depart = screen.getByRole("button", { name: "Partir" }) as HTMLButtonElement;
    await waitFor(() => {
      expect(depart.disabled).toBe(false);
    });
    fireEvent.click(depart);
    await waitFor(() => {
      expect(runPosts()).toBe(1);
    });
  });

  it("o 409 com blockers da API fica no diálogo, com os mesmos itens", async () => {
    await abrirCom(PREFLIGHT_OK, {
      data: undefined,
      error: {
        type: "about:blank",
        title: "O Harness não sustenta o que o Loadout pede",
        status: 409,
        detail: DOCKER_BLOCKER.message,
        blockers: [DOCKER_BLOCKER],
      },
      response: new Response(null, { status: 409 }),
    });

    await waitFor(() => {
      expect(document.querySelector('[data-run-preflight="ready"]')).not.toBeNull();
    });
    const depart = screen.getByRole("button", { name: "Partir" }) as HTMLButtonElement;
    await waitFor(() => {
      expect(depart.disabled).toBe(false);
    });
    fireEvent.click(depart);

    const block = await waitFor(() => {
      const element = document.querySelector('[data-run-preflight="rejected"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(block.textContent).toContain(dnd["run.preflight.rejected"]);
    expect(block.querySelector(`[data-capability-issue="${DOCKER_BLOCKER.code}"]`)).not.toBeNull();
    // O diálogo continua aberto e a partida, desabilitada.
    expect(depart.disabled).toBe(true);
  });
});

/**
 * As sugestões da rédea (Fase 9C): o Equipamento sugerido é pré-selecionado
 * com o motivo ao lado, o seletor continua livre, e o nível 0 é dito.
 */
describe("as sugestões na Nova Expedição", () => {
  async function abrirSugerido(suggestions: unknown): Promise<void> {
    client.GET.mockImplementation(((path: string) =>
      Promise.resolve(ok(RESPONSES[path] ?? {}))) as never);
    mockPost(ok(RUN_CREATED), suggestions);
    renderInRouter(<NewRunDialog onOpenChange={vi.fn()} open task={TASK} />);
    await screen.findAllByText(LOADOUT.name);
  }

  it("pede as sugestões ao abrir e pré-seleciona o Equipamento com o motivo", async () => {
    await abrirSugerido(ok(SUGGESTIONS));

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith(SUGGESTIONS_PATH, {
        params: { path: { id: TASK.id } },
      });
    });

    const block = await waitFor(() => {
      const element = document.querySelector('[data-run-suggestions="ready"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(block.textContent).toContain(dnd["suggestion.title"]);

    const loadout = block.querySelector('[data-run-suggestion="loadout"]') as HTMLElement;
    expect(loadout.getAttribute("data-run-suggestion-selected")).toBe(LOADOUT.id);
    expect(loadout.textContent).toContain(LOADOUT.name);
    // O motivo: a regra que casou, pelo nome do Encaminhamento, e a frase.
    expect(loadout.textContent).toContain(dnd["entity.routingRule"]);
    expect(loadout.textContent).toContain("casou e o alvo preferido serviu");
    expect(loadout.querySelector("[data-run-suggestion-applied]")).not.toBeNull();

    // O Ritual e o Patrono sem sugestão dizem que vale o padrão.
    const workflow = block.querySelector('[data-run-suggestion="workflow"]') as HTMLElement;
    expect(workflow.textContent).toContain(dnd["suggestion.none"]);
    expect(workflow.textContent).toContain(dnd["autonomy.decidedBy.default"]);
    const model = block.querySelector('[data-run-suggestion="model"]') as HTMLElement;
    expect(model.textContent).toContain(dnd["suggestion.model.note"]);

    // A pressão de orçamento, como fato.
    expect(block.querySelector("[data-run-suggestions-pressure]")?.textContent).toContain("85%");
  });

  it("abaixo do nível 1 diz que a rédea não sugere nada", async () => {
    await abrirSugerido(
      refused(
        "AUTOMATION_NOT_ALLOWED",
        { autonomyLevel: 0 },
        "O Project está no nível 0, que não libera SUGGEST.",
      ),
    );

    const block = await waitFor(() => {
      const element = document.querySelector('[data-run-suggestions="disabled"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(block.textContent).toContain(dnd["suggestion.disabled"]);
  });
});

/**
 * As três recusas da autonomia controlada (Fase 9A) ficam no diálogo com o
 * detalhe: o orçamento com consumo e teto, o disjuntor com o motivo e quando
 * reabre, a política que negou pelo nome.
 */
describe("as recusas da autonomia na Nova Expedição", () => {
  async function partirContra(runs: unknown): Promise<HTMLButtonElement> {
    client.GET.mockImplementation(((path: string) =>
      Promise.resolve(ok(RESPONSES[path] ?? {}))) as never);
    client.PUT.mockResolvedValue(
      ok({ "ui.theme": "dnd", "execution.hostAcknowledged": true }) as never,
    );
    mockPost(runs);
    renderInRouter(<NewRunDialog onOpenChange={vi.fn()} open task={TASK} />);
    await screen.findAllByText(LOADOUT.name);
    fireEvent.click(screen.getByLabelText(`Aceito executar ${dnd["env.host.warning"]}`));
    const depart = screen.getByRole("button", { name: "Partir" }) as HTMLButtonElement;
    await waitFor(() => {
      expect(depart.disabled).toBe(false);
    });
    fireEvent.click(depart);
    return depart;
  }

  it("BUDGET_EXCEEDED mostra o Tesouro, o teto e o consumo", async () => {
    await partirContra(refused("BUDGET_EXCEEDED", { budget: BUDGET_BREACH }, BUDGET_BREACH.reason));

    const block = await waitFor(() => {
      const element = document.querySelector('[data-run-refusal="budget"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(block.textContent).toContain(dnd["budget.exceeded.title"]);
    expect(block.textContent).toContain(BUDGET_BREACH.name);
    expect(block.textContent).toContain(dnd["budget.limit.maxRuns"]);
    expect(block.textContent).toContain("11 de 10");
    expect(block.querySelector('[data-budget-limit="maxRuns"]')).not.toBeNull();
    expect(
      block.querySelector("[data-budget-exceeded]")?.getAttribute("data-budget-exceeded"),
    ).toBe("maxRuns");
    expect(block.querySelector("[data-run-refusal-open]")).not.toBeNull();
  });

  it("BREAKER_OPEN mostra a Sentinela, o motivo e quando reabre", async () => {
    await partirContra(
      refused(
        "BREAKER_OPEN",
        { breaker: BREAKER_ADMISSION_REFUSED },
        `O disjuntor "${BREAKER.name}" não deixa o Run partir.`,
      ),
    );

    const block = await waitFor(() => {
      const element = document.querySelector('[data-run-refusal="breaker"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(block.textContent).toContain(dnd["breaker.open.title"]);
    expect(block.textContent).toContain(BREAKER.name);
    expect(block.textContent).toContain(BREAKER_ADMISSION_REFUSED.reason);
    // Quando reabre vem do próprio disjuntor: `openedAt` mais o cooldown.
    await waitFor(() => {
      expect(
        block.querySelector("[data-run-refusal-reopens]")?.getAttribute("data-run-refusal-reopens"),
      ).toBe("2026-09-14T10:30:00.000Z");
    });
  });

  it("POLICY_DENIED nomeia o Édito que recusou", async () => {
    await partirContra(
      refused(
        "POLICY_DENIED",
        { policyDecision: POLICY_DENIED_DECISION },
        POLICY_DENIED_DECISION.reason,
      ),
    );

    const block = await waitFor(() => {
      const element = document.querySelector('[data-run-refusal="policy"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(block.textContent).toContain(dnd["run.refused.policy"]);
    expect(block.textContent).toContain(POLICY_DENIED_DECISION.reason);
    // `POLICY:<id>` vira o nome da política, lido da API.
    await waitFor(() => {
      expect(block.textContent).toContain(`${dnd["entity.policy"]} ${GLOBAL_DENY_POLICY.name}`);
    });
  });
});
