import {
  DEFAULT_THEME,
  format,
  getGlossary,
  isThemeId,
  type FormatParams,
  type GlossaryKey,
  type ThemeId,
} from "@dungeon-master/glossary";
import { useCallback, useEffect, useMemo } from "react";
import { create } from "zustand";

import { useSettings } from "@/lib/settings";

/**
 * O glossário ativo da interface, em um único lugar.
 *
 * Nenhum componente escreve "Campanha" ou "Projeto" no JSX: o label vem daqui
 * (CLAUDE.md, seção 2). Um teste de varredura em `src/labels.test.ts` falha se
 * um valor de glossário aparecer literalmente em qualquer arquivo de `src`,
 * menos neste, que é a fronteira.
 *
 * O tema mora numa store Zustand, e não só na query de configurações, porque
 * trocá-lo precisa redesenhar a árvore inteira na hora — sem recarregar a
 * página, que é a regra da seção 47.1 do documento técnico.
 */

interface GlossaryState {
  /** Tema ativo. Começa em `dnd` e é hidratado por `GET /settings`. */
  readonly theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

export const useGlossaryStore = create<GlossaryState>((set) => ({
  theme: DEFAULT_THEME,
  setTheme: (theme) => {
    set((state) => (state.theme === theme ? state : { ...state, theme }));
  },
}));

export interface UseGlossary {
  /** Tema ativo, para as poucas decisões que dependem dele (a fonte do título). */
  readonly theme: ThemeId;
  /** Resolve um label no tema ativo. Chave fora da união é erro de compilação. */
  readonly t: (key: GlossaryKey) => string;
  /** Interpola `{placeholders}` num label já resolvido. */
  readonly format: (template: string, params?: FormatParams) => string;
}

/** O hook único de glossário da web. */
export function useGlossary(): UseGlossary {
  const theme = useGlossaryStore((state) => state.theme);

  return useMemo(() => {
    const glossary = getGlossary(theme);
    return { theme, t: (key: GlossaryKey) => glossary[key], format };
  }, [theme]);
}

export interface TermProps {
  /** A chave do glossário. */
  readonly k: GlossaryKey;
  /** Valores dos `{placeholders}`, quando o label tiver algum. */
  readonly params?: FormatParams;
}

/**
 * Um label do glossário dentro do JSX: `<Term k="entity.task" />`.
 *
 * Devolve texto puro, sem elemento em volta, para poder aparecer no meio de
 * uma frase sem mudar o layout.
 */
export function Term({ k, params }: TermProps): string {
  const { t, format: interpolate } = useGlossary();
  const label = t(k);
  return params === undefined ? label : interpolate(label, params);
}

export interface ThemeSetting {
  readonly theme: ThemeId;
  /** Troca o tema na hora e persiste em `PUT /settings/ui.theme`. */
  readonly change: (theme: ThemeId) => void;
  /** `true` enquanto a primeira leitura de `GET /settings` não voltou. */
  readonly isLoading: boolean;
  /** `true` enquanto a escrita está em voo. */
  readonly isSaving: boolean;
  readonly error: Error | null;
}

/**
 * Liga a store de glossário às configurações do usuário.
 *
 * Hidrata o tema na primeira leitura, aceita a troca de forma otimista e
 * desfaz se o `PUT` falhar. A atualização vinda de outra aba chega de graça:
 * `useSettings` invalida a query no evento SSE `settings.changed`, a query
 * volta com o valor novo e o efeito daqui o aplica na store.
 */
export function useThemeSetting(): ThemeSetting {
  const { query, mutation } = useSettings();
  const theme = useGlossaryStore((state) => state.theme);
  const setTheme = useGlossaryStore((state) => state.setTheme);

  const persisted = query.data?.["ui.theme"];

  useEffect(() => {
    if (persisted !== undefined && isThemeId(persisted)) setTheme(persisted);
  }, [persisted, setTheme]);

  const { mutate } = mutation;

  const change = useCallback(
    (next: ThemeId) => {
      const previous = useGlossaryStore.getState().theme;
      if (previous === next) return;

      // Otimista: o texto troca antes da ida ao servidor, senão o interruptor
      // fica com meio segundo de atraso em cada clique.
      setTheme(next);
      mutate(
        { key: "ui.theme", value: next },
        {
          onError: () => {
            setTheme(previous);
          },
        },
      );
    },
    [mutate, setTheme],
  );

  return {
    theme,
    change,
    isLoading: query.isPending,
    isSaving: mutation.isPending,
    error: mutation.error,
  };
}
