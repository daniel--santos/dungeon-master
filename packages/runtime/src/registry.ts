/**
 * Resolução de adapter por `HarnessKey`.
 *
 * O registry é a única indireção entre "o Run pediu `CODEX`" e "este objeto
 * sabe rodar o Codex". Sem ele, o worker importaria os três adapters e o
 * `packages/runtime` deixaria de ser independente de quem implementa o quê —
 * que é justamente o que permite a suíte de contrato rodar com um harness
 * falso.
 */

import type { HarnessKey } from "@dungeon-master/contracts";

import type { HarnessAdapter } from "./harness.js";
import { RuntimeRequestError } from "./harness.js";

export interface HarnessRegistry {
  /** O adapter registrado, ou `undefined`. */
  find(key: HarnessKey): HarnessAdapter | undefined;
  /** O adapter registrado. Lança {@link RuntimeRequestError} quando falta. */
  resolve(key: HarnessKey): HarnessAdapter;
  /** As chaves registradas, em ordem de registro. */
  keys(): readonly HarnessKey[];
}

/**
 * Monta um registry a partir de uma lista de adapters.
 *
 * Registrar dois adapters para a mesma chave é erro na hora do registro, e não
 * um "o último vence" que só apareceria em produção com o harness errado
 * rodando.
 */
export function createHarnessRegistry(adapters: readonly HarnessAdapter[]): HarnessRegistry {
  const byKey = new Map<HarnessKey, HarnessAdapter>();

  for (const adapter of adapters) {
    const existing = byKey.get(adapter.key);
    if (existing !== undefined) {
      throw new RuntimeRequestError(
        `Dois adapters registrados para o harness ${adapter.key}: ${existing.id} e ${adapter.id}.`,
        { code: "DUPLICATE_HARNESS_ADAPTER" },
      );
    }
    byKey.set(adapter.key, adapter);
  }

  return {
    find: (key) => byKey.get(key),
    resolve: (key) => {
      const adapter = byKey.get(key);
      if (adapter === undefined) {
        const registered = [...byKey.keys()].join(", ") || "nenhum";
        throw new RuntimeRequestError(
          `Nenhum adapter registrado para o harness ${key}. Registrados: ${registered}.`,
          { code: "HARNESS_NOT_REGISTERED" },
        );
      }
      return adapter;
    },
    keys: () => [...byKey.keys()],
  };
}
