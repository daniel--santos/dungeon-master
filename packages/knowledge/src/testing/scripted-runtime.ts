import type { UsageSummary } from "@dungeon-master/contracts";

import type {
  KnowledgeAgentRequest,
  KnowledgeAgentResult,
  KnowledgeAgentRuntime,
} from "../ports.js";
import type { LlmProvenance } from "../types.js";

/**
 * O modelo roteirizado: uma resposta por finalidade (`distill`, `summary`,
 * `forge`), dada como valor ou como função do pedido.
 *
 * O que ele grava é o que os testes olham: cada prompt recebido, na ordem.
 * `hang` segura a chamada até `release()`, para provar que o lock de um
 * Project recusa um segundo lote enquanto o primeiro espera o modelo.
 */

export type ScriptedAnswer<T = unknown> =
  | { readonly kind: "ok"; readonly output: T; readonly provenance?: Partial<LlmProvenance> }
  | { readonly kind: "error"; readonly error: string; readonly provenance?: Partial<LlmProvenance> }
  | { readonly kind: "hang" };

export type ScriptedAnswerOrFn<T = unknown> =
  ScriptedAnswer<T> | ((request: KnowledgeAgentRequest<T>) => ScriptedAnswer<T>);

export interface ScriptedRuntimeOptions {
  readonly distill?: ScriptedAnswerOrFn;
  readonly summary?: ScriptedAnswerOrFn;
  readonly forge?: ScriptedAnswerOrFn;
  /** Proveniência padrão de toda resposta. */
  readonly provenance?: Partial<LlmProvenance>;
}

export interface ScriptedKnowledgeRuntime extends KnowledgeAgentRuntime {
  readonly requests: KnowledgeAgentRequest<unknown>[];
  /** Solta toda chamada em `hang`. */
  release(): void;
  /** Resolve quando uma chamada entra em `hang`. */
  readonly hanging: Promise<void>;
}

export const SCRIPTED_USAGE: UsageSummary = {
  inputTokens: 100,
  outputTokens: 20,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

const DEFAULTS: Record<KnowledgeAgentRequest<unknown>["purpose"], ScriptedAnswer> = {
  // Sem decisão nenhuma: o fail-open promove tudo.
  distill: { kind: "ok", output: { decisions: [] } },
  summary: {
    kind: "ok",
    output: {
      title: "Resumo roteirizado",
      content: "# Resumo\n\nEscrito pelo roteiro.",
      coveredItems: [],
    },
  },
  forge: {
    kind: "ok",
    output: {
      name: "Carta roteirizada",
      description: "Condição cumprida. A arquibancada anotou.",
      flavor: "Dez seguidas. A câmera lenta mostrou cada uma. Anota: previsível.",
    },
  },
};

export function createScriptedKnowledgeRuntime(
  options: ScriptedRuntimeOptions = {},
): ScriptedKnowledgeRuntime {
  const requests: KnowledgeAgentRequest<unknown>[] = [];
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let notifyHanging!: () => void;
  const hanging = new Promise<void>((resolve) => {
    notifyHanging = resolve;
  });

  const provenanceOf = (partial: Partial<LlmProvenance> | undefined): LlmProvenance => ({
    harnessSessionId:
      partial?.harnessSessionId ?? options.provenance?.harnessSessionId ?? "scripted-session",
    usage: partial?.usage ?? options.provenance?.usage ?? SCRIPTED_USAGE,
  });

  return {
    requests,
    release: () => {
      release();
    },
    hanging,

    async execute<T>(request: KnowledgeAgentRequest<T>): Promise<KnowledgeAgentResult<T>> {
      requests.push(request as KnowledgeAgentRequest<unknown>);
      const roteiro = options[request.purpose] ?? DEFAULTS[request.purpose];
      const answer =
        typeof roteiro === "function"
          ? roteiro(request as KnowledgeAgentRequest<unknown>)
          : roteiro;

      if (answer.kind === "hang") {
        notifyHanging();
        await released;
        return { ok: false, error: "solto pelo teste", provenance: provenanceOf(undefined) };
      }

      if (answer.kind === "error") {
        return { ok: false, error: answer.error, provenance: provenanceOf(answer.provenance) };
      }

      // O roteiro passa pelo mesmo schema que a resposta de um modelo real
      // passaria no runtime: um roteiro torto falha aqui, e não em silêncio.
      const parsed = request.schema.safeParse(answer.output);
      if (!parsed.success) {
        return {
          ok: false,
          error: `roteiro fora do schema: ${parsed.error.message}`,
          provenance: provenanceOf(answer.provenance),
        };
      }
      return { ok: true, output: parsed.data, provenance: provenanceOf(answer.provenance) };
    },
  };
}
