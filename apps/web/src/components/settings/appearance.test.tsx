import { DEFAULT_THEME } from "@dungeon-master/glossary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppearanceSection } from "@/components/settings/appearance";
import { useGlossaryStore } from "@/lib/glossary";

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

function Wrapper({ children }: { readonly children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function theSwitch(): HTMLButtonElement {
  return screen.getByRole("switch") as HTMLButtonElement;
}

/**
 * Espera a primeira leitura de `GET /settings` chegar.
 *
 * O interruptor nasce ligado, que é o padrão, e fica desabilitado até saber o
 * valor gravado — sem isso o teste clicaria num controle desabilitado e
 * passaria a impressão de que a mutação não é chamada.
 */
async function waitForSettings(): Promise<void> {
  await waitFor(() => {
    expect(theSwitch().disabled).toBe(false);
  });
}

afterEach(() => {
  cleanup();
  act(() => {
    useGlossaryStore.getState().setTheme(DEFAULT_THEME);
  });
});

describe("interruptor de tema", () => {
  it("reflete o valor que veio de GET /settings", async () => {
    mocks.fetchSettings.mockResolvedValue({ "ui.theme": "plain" });

    render(
      <Wrapper>
        <AppearanceSection />
      </Wrapper>,
    );

    await waitForSettings();
    expect(theSwitch().dataset["state"]).toBe("unchecked");
    expect(useGlossaryStore.getState().theme).toBe("plain");
  });

  it("desligar chama a mutação e troca o tema na hora", async () => {
    mocks.fetchSettings.mockResolvedValue({ "ui.theme": "dnd" });
    mocks.updateSetting.mockResolvedValue({ "ui.theme": "plain" });

    render(
      <Wrapper>
        <AppearanceSection />
      </Wrapper>,
    );

    await waitForSettings();
    expect(theSwitch().dataset["state"]).toBe("checked");

    fireEvent.click(theSwitch());

    // Otimista: a store já mudou antes de a escrita voltar.
    expect(useGlossaryStore.getState().theme).toBe("plain");
    await waitFor(() => {
      expect(theSwitch().dataset["state"]).toBe("unchecked");
    });

    expect(mocks.updateSetting).toHaveBeenCalledTimes(1);
    expect(mocks.updateSetting.mock.calls[0]?.slice(1)).toEqual(["ui.theme", "plain"]);
  });

  it("desfaz a troca quando a escrita falha", async () => {
    mocks.fetchSettings.mockResolvedValue({ "ui.theme": "dnd" });
    mocks.updateSetting.mockRejectedValue(new Error("a API recusou"));

    render(
      <Wrapper>
        <AppearanceSection />
      </Wrapper>,
    );

    await waitForSettings();
    expect(theSwitch().dataset["state"]).toBe("checked");

    fireEvent.click(theSwitch());
    expect(useGlossaryStore.getState().theme).toBe("plain");

    await waitFor(() => {
      expect(useGlossaryStore.getState().theme).toBe("dnd");
    });
    expect(theSwitch().dataset["state"]).toBe("checked");
    expect(await screen.findByText("a API recusou")).toBeDefined();
  });
});
