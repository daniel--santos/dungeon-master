import { afterEach, describe, expect, it } from "vitest";

import { useProviderAuthStore } from "@/lib/provider-auth";
import { PREFLIGHT_OK } from "@/test/registry-fixtures";

const AUTH = PREFLIGHT_OK.provider!;

afterEach(() => {
  useProviderAuthStore.getState().reset();
});

describe("o estado de credencial dos Patronatos", () => {
  it("guarda a última foto de cada Patronato, com a data", () => {
    useProviderAuthStore.getState().record(AUTH, "2026-09-09T10:00:00.000Z");
    const entry = useProviderAuthStore.getState().entries[AUTH.providerId];
    expect(entry?.auth.status).toBe("CLI_AUTHENTICATED");
    expect(entry?.checkedAt).toBe("2026-09-09T10:00:00.000Z");
    expect(useProviderAuthStore.getState().lost).toBeNull();
  });

  it("só uma queda a partir de um estado bom vira aviso; a primeira observação não", () => {
    const store = useProviderAuthStore.getState();
    store.record({ ...AUTH, status: "CLI_NOT_AUTHENTICATED" }, "t1");
    expect(useProviderAuthStore.getState().lost).toBeNull();

    store.record({ ...AUTH, status: "CLI_AUTHENTICATED" }, "t2");
    expect(useProviderAuthStore.getState().lost).toBeNull();

    store.record({ ...AUTH, status: "CLI_NOT_AUTHENTICATED" }, "t3");
    const lost = useProviderAuthStore.getState().lost;
    expect(lost?.providerId).toBe(AUTH.providerId);
    expect(lost?.name).toBe(AUTH.name);
    expect(lost?.sequence).toBe(1);

    // Continuar sem credencial não repete o aviso; recuperar e cair de novo, sim.
    store.record({ ...AUTH, status: "CLI_NOT_AUTHENTICATED" }, "t4");
    expect(useProviderAuthStore.getState().lost?.sequence).toBe(1);
    store.record({ ...AUTH, status: "ENV_KEY_PRESENT" }, "t5");
    store.record({ ...AUTH, status: "CLI_NOT_AUTHENTICATED" }, "t6");
    expect(useProviderAuthStore.getState().lost?.sequence).toBe(2);
  });

  it("de desconhecido para sem credencial não é uma queda", () => {
    const store = useProviderAuthStore.getState();
    store.record({ ...AUTH, status: "UNKNOWN" }, "t1");
    store.record({ ...AUTH, status: "CLI_NOT_AUTHENTICATED" }, "t2");
    expect(useProviderAuthStore.getState().lost).toBeNull();
  });
});
