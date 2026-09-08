import { dnd } from "@dungeon-master/glossary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { KnowledgeSection } from "@/components/settings/knowledge";
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { HARNESS, LOADOUT, ok } from "@/test/execution-fixtures";

/**
 * O bloco do Grimório em Settings: hidrata do servidor, valida as cadências
 * antes de gravar, grava só o que mudou (uma chave por `PUT`) e manda `null`
 * de verdade quando o Loadout volta ao semeado.
 */

const mocks = vi.hoisted(() => ({
  fetchSettings: vi.fn(),
  updateSetting: vi.fn(),
}));

vi.mock("@dungeon-master/api-client", () => ({
  createApiClient: () => ({}),
  EVENTS_STREAM_PATH: "/api/v1/events/stream",
  fetchSettings: mocks.fetchSettings,
  updateSetting: mocks.updateSetting,
}));

vi.mock("@/lib/api", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}));

const client = vi.mocked(api);

/** O Switch do Radix mede o botão com `ResizeObserver`, que o jsdom não tem. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  // O Select do Radix usa captura de ponteiro e `scrollIntoView`, que o jsdom não tem.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const SETTINGS = {
  "ui.theme": "dnd",
  "execution.hostAcknowledged": true,
  "knowledge.humanReview": true,
  "knowledge.loadoutId": LOADOUT.id,
  "knowledge.distillEveryMinutes": 10,
  "achievements.forgeEveryNRuns": 20,
};

function Wrapper({ children }: { readonly children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}

function montar(settings = SETTINGS) {
  mocks.fetchSettings.mockResolvedValue(settings);
  mocks.updateSetting.mockImplementation((_client: unknown, key: string, value: unknown) =>
    Promise.resolve({ ...settings, [key]: value }),
  );
  client.GET.mockImplementation(((path: string) => {
    switch (path) {
      case "/api/v1/loadouts":
        return Promise.resolve(ok({ items: [LOADOUT] }));
      case "/api/v1/harnesses":
        return Promise.resolve(ok({ items: [HARNESS] }));
      default:
        return Promise.resolve(ok({}));
    }
  }) as never);

  return render(
    <Wrapper>
      <KnowledgeSection />
    </Wrapper>,
  );
}

const field = (name: string) =>
  document.querySelector(`[data-knowledge-field="${name}"]`) as HTMLInputElement;
const saveButton = () => document.querySelector("[data-knowledge-save]") as HTMLButtonElement;

/** As chaves gravadas, na ordem, sem o cliente. */
const writes = () => mocks.updateSetting.mock.calls.map((call) => call.slice(1));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("bloco do Grimório em Settings", () => {
  it("hidrata os quatro campos e só habilita salvar quando algo muda", async () => {
    montar();

    await waitFor(() => {
      expect(field("every").value).toBe("10");
    });
    expect(field("forge-every").value).toBe("20");
    expect(screen.getByRole("switch").getAttribute("data-state")).toBe("checked");
    expect(screen.getByText(dnd["settings.knowledge.title"])).toBeTruthy();
    expect(saveButton().disabled).toBe(true);

    fireEvent.change(field("every"), { target: { value: "15" } });
    expect(saveButton().disabled).toBe(false);
  });

  it("recusa uma cadência fora do intervalo antes de gravar", async () => {
    montar();
    await waitFor(() => {
      expect(field("every").value).toBe("10");
    });

    fireEvent.change(field("every"), { target: { value: "0" } });
    expect(document.querySelector('[data-knowledge-field-error="every"]')).not.toBeNull();
    expect(saveButton().disabled).toBe(true);

    fireEvent.change(field("forge-every"), { target: { value: "99999" } });
    expect(document.querySelector('[data-knowledge-field-error="forge-every"]')).not.toBeNull();

    fireEvent.change(field("every"), { target: { value: "30" } });
    fireEvent.change(field("forge-every"), { target: { value: "5" } });
    expect(document.querySelector("[data-knowledge-field-error]")).toBeNull();
    expect(saveButton().disabled).toBe(false);
    expect(mocks.updateSetting).not.toHaveBeenCalled();
  });

  it("grava só as chaves que mudaram, uma por PUT", async () => {
    montar();
    await waitFor(() => {
      expect(field("every").value).toBe("10");
    });

    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(field("every"), { target: { value: "30" } });
    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(writes()).toEqual([
        ["knowledge.humanReview", false],
        ["knowledge.distillEveryMinutes", 30],
      ]);
    });
    expect(await screen.findByText(dnd["settings.knowledge.saved"])).toBeTruthy();
  });

  it("voltar ao Loadout semeado grava null, e não string vazia", async () => {
    montar();
    await waitFor(() => {
      expect(field("every").value).toBe("10");
    });

    // O seletor do Radix mostra o Loadout gravado; escolher "o semeado" volta a `null`.
    const trigger = document.querySelector("[data-knowledge-loadout]") as HTMLElement;
    await waitFor(() => {
      expect(trigger.textContent).toContain(LOADOUT.name);
    });
    // Radix abre no teclado; é o caminho estável no jsdom.
    fireEvent.keyDown(trigger, { key: "Enter" });
    const option = await screen.findByRole("option", {
      name: dnd["settings.knowledge.loadout.default"].replace("{name}", dnd["knowledge.scribe"]),
    });
    fireEvent.click(option);

    await waitFor(() => {
      expect(saveButton().disabled).toBe(false);
    });
    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(writes()).toEqual([["knowledge.loadoutId", null]]);
    });
  });
});
