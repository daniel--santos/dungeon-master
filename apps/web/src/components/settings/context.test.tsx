import { dnd } from "@dungeon-master/glossary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ContextSection } from "@/components/settings/context";
import { Toaster } from "@/components/ui/sonner";

/**
 * O bloco das provisões em Settings (Fase 7C): hidrata do servidor, valida o
 * orçamento e os tetos antes de gravar, grava só o que mudou (uma chave por
 * `PUT`) e aceita `0` num teto, que é o valor que desliga a seção.
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

/** O Switch do Radix mede o botão com `ResizeObserver`, que o jsdom não tem. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const SETTINGS = {
  "ui.theme": "dnd",
  "execution.hostAcknowledged": true,
  "knowledge.humanReview": true,
  "knowledge.loadoutId": null,
  "knowledge.distillEveryMinutes": 10,
  "achievements.forgeEveryNRuns": 20,
  "context.enabled": true,
  "context.budgetTokens": 6000,
  "context.maxKnowledgeItems": 8,
  "context.maxDecisions": 5,
  "context.maxArtifacts": 10,
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

  return render(
    <Wrapper>
      <ContextSection />
    </Wrapper>,
  );
}

const field = (name: string) =>
  document.querySelector(`[data-context-field="${name}"]`) as HTMLInputElement;
const fieldError = (name: string) => document.querySelector(`[data-context-field-error="${name}"]`);
const saveButton = () => document.querySelector("[data-context-save]") as HTMLButtonElement;

/** As chaves gravadas, na ordem, sem o cliente. */
const writes = () => mocks.updateSetting.mock.calls.map((call) => call.slice(1));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("bloco das provisões em Settings", () => {
  it("hidrata os cinco campos e só habilita salvar quando algo muda", async () => {
    montar();

    await waitFor(() => {
      expect(field("budget-tokens").value).toBe("6000");
    });
    expect(field("max-knowledge-items").value).toBe("8");
    expect(field("max-decisions").value).toBe("5");
    expect(field("max-artifacts").value).toBe("10");
    expect(screen.getByRole("switch").getAttribute("data-state")).toBe("checked");
    expect(screen.getByText(dnd["settings.context.title"])).toBeTruthy();
    expect(saveButton().disabled).toBe(true);

    fireEvent.change(field("budget-tokens"), { target: { value: "8000" } });
    expect(saveButton().disabled).toBe(false);
  });

  it("recusa orçamento abaixo de 1000, teto acima do máximo e texto que não é inteiro", async () => {
    montar();
    await waitFor(() => {
      expect(field("budget-tokens").value).toBe("6000");
    });

    fireEvent.change(field("budget-tokens"), { target: { value: "999" } });
    expect(fieldError("budget-tokens")).not.toBeNull();
    expect(fieldError("budget-tokens")?.textContent).toContain("1000");
    expect(saveButton().disabled).toBe(true);

    fireEvent.change(field("max-decisions"), { target: { value: "51" } });
    expect(fieldError("max-decisions")).not.toBeNull();

    fireEvent.change(field("max-artifacts"), { target: { value: "-1" } });
    expect(fieldError("max-artifacts")).not.toBeNull();

    fireEvent.change(field("budget-tokens"), { target: { value: "1000" } });
    fireEvent.change(field("max-decisions"), { target: { value: "50" } });
    fireEvent.change(field("max-artifacts"), { target: { value: "0" } });
    expect(document.querySelector("[data-context-field-error]")).toBeNull();
    expect(saveButton().disabled).toBe(false);
    expect(mocks.updateSetting).not.toHaveBeenCalled();
  });

  it("grava só as chaves que mudaram, uma por PUT, e avisa pelo toast", async () => {
    montar();
    await waitFor(() => {
      expect(field("budget-tokens").value).toBe("6000");
    });

    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(field("max-knowledge-items"), { target: { value: "0" } });
    fireEvent.change(field("max-artifacts"), { target: { value: "25" } });
    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(writes()).toEqual([
        ["context.enabled", false],
        ["context.maxKnowledgeItems", 0],
        ["context.maxArtifacts", 25],
      ]);
    });
    expect(await screen.findByText(dnd["settings.context.saved"])).toBeTruthy();
  });

  it("mostra o erro do servidor sem perder o que foi digitado", async () => {
    montar();
    await waitFor(() => {
      expect(field("budget-tokens").value).toBe("6000");
    });
    mocks.updateSetting.mockRejectedValue(new Error("O schema da chave recusou o valor."));

    fireEvent.change(field("budget-tokens"), { target: { value: "7000" } });
    fireEvent.click(saveButton());

    expect(await screen.findAllByText("O schema da chave recusou o valor.")).not.toHaveLength(0);
    expect(field("budget-tokens").value).toBe("7000");
  });
});
