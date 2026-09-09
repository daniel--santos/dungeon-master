import { Link } from "@tanstack/react-router";
import { ArrowRight, KeyRound } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import type { ProviderAuthRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";

/**
 * O último estado de credencial visto de cada Provider (Fase 8C).
 *
 * A API não tem "o estado do Provider": ela tem o preflight de um Loadout,
 * que traz o Provider do Model efetivo com o estado da credencial medido na
 * chamada. Toda leitura de preflight — o painel de compatibilidade, o diálogo
 * de partida, o botão da tela de Providers — grava aqui o que viu, e a tela
 * de Providers mostra a última foto, com a data, em vez de "desconhecido".
 *
 * A transição para `CLI_NOT_AUTHENTICATED` a partir de um estado conhecido e
 * bom é o único fato que vira toast: uma credencial que caiu entre duas
 * verificações. A primeira observação não é uma queda, e não avisa.
 */

export interface ProviderAuthEntry {
  readonly auth: ProviderAuthRecord;
  /** O `checkedAt` do preflight que trouxe o estado. */
  readonly checkedAt: string;
}

export interface ProviderAuthLost {
  readonly providerId: string;
  readonly name: string;
  readonly checkedAt: string;
  /** Cresce a cada queda, para o toast sair mesmo que o mesmo Provider caia duas vezes. */
  readonly sequence: number;
}

interface ProviderAuthState {
  readonly entries: Readonly<Record<string, ProviderAuthEntry>>;
  readonly lost: ProviderAuthLost | null;
  record: (auth: ProviderAuthRecord, checkedAt: string) => void;
  reset: () => void;
}

const LOST_STATUS = "CLI_NOT_AUTHENTICATED";

export const useProviderAuthStore = create<ProviderAuthState>((set) => ({
  entries: {},
  lost: null,
  record: (auth, checkedAt) => {
    set((state) => {
      const previous = state.entries[auth.providerId];
      const fell =
        previous !== undefined &&
        previous.auth.status !== LOST_STATUS &&
        previous.auth.status !== "UNKNOWN" &&
        auth.status === LOST_STATUS;
      return {
        entries: { ...state.entries, [auth.providerId]: { auth, checkedAt } },
        lost: fell
          ? {
              providerId: auth.providerId,
              name: auth.name,
              checkedAt,
              sequence: (state.lost?.sequence ?? 0) + 1,
            }
          : state.lost,
      };
    });
  },
  reset: () => {
    set({ entries: {}, lost: null });
  },
}));

/** O último estado visto de um Provider, ou `undefined` se nenhum preflight o trouxe. */
export function useProviderAuth(providerId: string): ProviderAuthEntry | undefined {
  return useProviderAuthStore((state) => state.entries[providerId]);
}

const AMBER = "oklch(0.72 0.13 75)";
const tint = (percent: number) => `color-mix(in oklab, ${AMBER} ${String(percent)}%, transparent)`;

function ProviderLostToast({ lost, onOpen }: { lost: ProviderAuthLost; onOpen: () => void }) {
  const { t, theme, format } = useGlossary();

  return (
    <div
      className="bg-card flex w-full items-start gap-3 rounded-[12px] p-3.5"
      data-provider-lost-toast={lost.providerId}
      style={{
        border: `1px solid ${tint(55)}`,
        boxShadow: `0 0 0 1px ${tint(18)}, 0 10px 30px -12px ${tint(40)}`,
      }}
    >
      <span
        className="flex size-9 flex-none items-center justify-center rounded-full"
        style={{ border: `1px solid ${tint(40)}`, background: tint(12), color: AMBER }}
      >
        <KeyRound aria-hidden className="size-4.5" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={
            theme === "dnd"
              ? "font-display text-[14.5px] leading-5 font-semibold tracking-[0.03em]"
              : "text-[14.5px] leading-5 font-semibold"
          }
        >
          {format(t("provider.toast.lost"), { name: lost.name })}
        </span>
        <span className="text-muted-foreground text-[12.5px] leading-4.5">
          {t("provider.toast.lost.body")}
        </span>
        <Link
          className="text-muted-foreground hover:text-foreground mt-0.5 flex w-fit items-center gap-1 text-[11.5px] underline-offset-2 hover:underline"
          onClick={onOpen}
          to="/providers"
        >
          <span>{t("entity.provider.plural")}</span>
          <ArrowRight aria-hidden className="size-3" />
        </Link>
      </div>
    </div>
  );
}

/** Anuncia, em qualquer tela, um Provider cuja credencial caiu entre dois preflights. */
export function useProviderAuthToasts(): void {
  const lost = useProviderAuthStore((state) => state.lost);

  useEffect(() => {
    if (lost === null) return;
    const current = lost;
    toast.custom(
      (id) => (
        <ProviderLostToast
          lost={current}
          onOpen={() => {
            toast.dismiss(id);
          }}
        />
      ),
      { id: `provider-lost:${current.providerId}:${String(current.sequence)}`, duration: 12_000 },
    );
  }, [lost]);
}
