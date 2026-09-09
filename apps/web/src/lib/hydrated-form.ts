import { useCallback, useEffect, useState } from "react";

/**
 * Um formulário que nasce do servidor e não é sobrescrito enquanto se digita.
 *
 * O padrão que este hook substitui aparecia em cinco telas: um `useEffect` que
 * copiava `query.data` para `useState` a cada mudança de identidade do dado.
 * Como o React Query devolve um objeto novo a cada releitura — e qualquer
 * invalidação provoca uma —, o efeito reescrevia por cima do que o usuário
 * estava digitando. As guardas locais não davam conta: `mutation.isPending` só
 * conhece a mutação de quem a criou, e `[open, project]` reage à identidade do
 * objeto, não à abertura do diálogo.
 *
 * A regra aqui é uma só, e vale para os cinco casos:
 *
 * 1. sem valor local ainda, hidrata;
 * 2. `resetKey` mudou (o diálogo abriu, ou abriu sobre outro registro),
 *    hidrata e descarta a edição — é uma tela nova;
 * 3. o servidor mudou de verdade **e** o formulário está como veio, hidrata:
 *    uma edição feita em outra aba chega sem recarregar;
 * 4. o servidor mudou e há edição pendente, **não** hidrata: o que está na
 *    tela é do usuário, e some sem aviso e sem toast se for sobrescrito.
 *
 * "Mudou de verdade" é comparação campo a campo, e não de identidade: uma
 * releitura que devolve o mesmo conteúdo não é notícia, e tratá-la como tal
 * devolveria o problema pela porta dos fundos.
 *
 * O valor do servidor entra já na forma do formulário (`string` para campo de
 * texto, e não `number`), memoizado por quem chama. Isso mantém a comparação
 * rasa e deixa a conversão perto da tela que a usa.
 */
export interface HydratedForm<T> {
  /** `null` só enquanto o servidor não respondeu. */
  readonly value: T | null;
  /** O que o formulário tem de diferente do que veio do servidor. */
  readonly dirty: boolean;
  readonly set: (next: T | ((current: T) => T)) => void;
}

interface Snapshot<T> {
  /** O que está na tela. */
  readonly value: T;
  /** O valor do servidor de onde `value` nasceu. */
  readonly from: T;
  readonly key: unknown;
}

/** Igualdade campo a campo, com `Object.is` em cada valor. */
function shallowEqual<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) =>
    Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/**
 * @param server O valor do servidor, na forma do formulário. `undefined`
 * enquanto a leitura não voltou.
 * @param resetKey Trocar esta chave descarta a edição e hidrata de novo. Nos
 * diálogos é a abertura (`open ? id : "closed"`); nas seções de Settings, que
 * não abrem nem fecham, não é usada.
 */
export function useHydratedForm<T extends object>(
  server: T | undefined,
  resetKey: unknown = null,
): HydratedForm<T> {
  const [snapshot, setSnapshot] = useState<Snapshot<T> | null>(null);

  useEffect(() => {
    if (server === undefined) return;
    setSnapshot((current) => {
      if (current === null || current.key !== resetKey) {
        return { value: server, from: server, key: resetKey };
      }
      // Nada de novo do servidor: releitura com o mesmo conteúdo.
      if (shallowEqual(current.from, server)) return current;
      // post-mortem #15 (08/09/2026): em Settings, salvar um bloco (ou receber
      // o `settings.changed` do próprio hook) devolvia o objeto inteiro, e o
      // efeito de hidratação de outro bloco reescrevia os campos que estavam
      // sendo digitados. A edição pendente agora ganha da releitura.
      if (!shallowEqual(current.value, current.from)) return current;
      return { value: server, from: server, key: resetKey };
    });
  }, [server, resetKey]);

  const set = useCallback((next: T | ((current: T) => T)) => {
    setSnapshot((current) => {
      if (current === null) return current;
      const value = typeof next === "function" ? next(current.value) : next;
      return { ...current, value };
    });
  }, []);

  return {
    value: snapshot?.value ?? null,
    dirty: snapshot !== null && !shallowEqual(snapshot.value, snapshot.from),
    set,
  };
}
