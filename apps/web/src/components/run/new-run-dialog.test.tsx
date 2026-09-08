import { dnd } from "@dungeon-master/glossary";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewRunDialog } from "@/components/run/new-run-dialog";
import { api } from "@/lib/api";
import {
  AGENT,
  DOCKER_PROFILE,
  HARNESS,
  HOST_PROFILE,
  LOADOUT,
  RUN,
  TASK,
  ok,
} from "@/test/execution-fixtures";
import { renderInRouter } from "@/test/router";

/**
 * A Expedição não parte sem o aceite do modo host.
 *
 * É a exigência da Fase 2B — "aceite explícito para execução host" — e ela vale
 * mesmo quando tudo o mais já está escolhido. O teste também prende o texto do
 * aceite: ele precisa dizer o que vai acontecer, e não repetir o nome do modo.
 */

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

/** As respostas de que o diálogo depende, por caminho. */
const RESPONSES: Record<string, unknown> = {
  "/api/v1/loadouts": { items: [LOADOUT] },
  "/api/v1/agents": { items: [AGENT] },
  "/api/v1/harnesses": { items: [HARNESS] },
  "/api/v1/models": { items: [] },
  "/api/v1/execution-profiles": { items: [HOST_PROFILE, DOCKER_PROFILE] },
  "/api/v1/settings": { "ui.theme": "dnd", "execution.hostAcknowledged": false },
};

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
async function abrir(): Promise<void> {
  client.GET.mockImplementation(((path: string) =>
    Promise.resolve(ok(RESPONSES[path] ?? {}))) as never);

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
    expect(client.POST).not.toHaveBeenCalled();
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
    client.POST.mockResolvedValue(ok(RUN) as never);
    client.PUT.mockResolvedValue(
      ok({ "ui.theme": "dnd", "execution.hostAcknowledged": true }) as never,
    );

    await abrir();

    fireEvent.click(screen.getByLabelText(`Aceito executar ${dnd["env.host.warning"]}`));

    const depart = screen.getByRole("button", { name: "Partir" });
    await waitFor(() => {
      expect((depart as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(depart);

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith("/api/v1/tasks/{id}/runs", {
        params: { path: { id: TASK.id } },
        body: {
          loadoutId: LOADOUT.id,
          prompt: `${TASK.title}\n\n${TASK.description ?? ""}`,
        },
      });
    });
  });

  it("lembra o aceite em user_setting, para não perguntar de novo", async () => {
    client.POST.mockResolvedValue(ok(RUN) as never);
    client.PUT.mockResolvedValue(
      ok({ "ui.theme": "dnd", "execution.hostAcknowledged": true }) as never,
    );

    await abrir();

    fireEvent.click(screen.getByLabelText(`Aceito executar ${dnd["env.host.warning"]}`));
    fireEvent.click(screen.getByRole("button", { name: "Partir" }));

    await waitFor(() => {
      expect(client.PUT).toHaveBeenCalledWith("/api/v1/settings/{key}", {
        params: { path: { key: "execution.hostAcknowledged" } },
        body: { value: true },
      });
    });
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
