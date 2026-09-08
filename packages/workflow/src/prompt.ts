import type { RunStep, RunStepResult, WorkflowStepDefinition } from "@dungeon-master/contracts";

/**
 * O prompt de um step de agente: o literal da definição mais os resumos dos
 * resultados dos steps em `includeOutputsOf`.
 *
 * Texto claro, **sem template engine** (planejamento v0.4, Fase 4: "dados
 * coordenam, código computa, agentes julgam"). O motor não substitui
 * placeholder nenhum: o que ele faz é anexar, depois do prompt, uma seção por
 * step referenciado, com o nome do step e o que sobrou dele. Um step que
 * ainda não tem resultado — pulado, ou falhou sem gravar — aparece dizendo
 * isso, em vez de sumir em silêncio: o agente precisa saber que a análise que
 * deveria ler não existe.
 */

/** Quanto da saída de um comando entra no prompt. O resto fica no RunStep. */
export const OUTPUT_TAIL_IN_PROMPT_CHARS = 4_000;

export interface StepOutputView {
  readonly key: string;
  readonly name: string;
  readonly status: RunStep["status"];
  readonly result: RunStepResult | null;
  readonly error: RunStep["error"];
}

export function buildStepPrompt(prompt: string, outputs: readonly StepOutputView[]): string {
  if (outputs.length === 0) return prompt;

  const secoes = outputs.map(describeStepOutput);
  return [
    prompt.trimEnd(),
    "",
    "---",
    "",
    "Resultados de passos anteriores deste Workflow, para referência:",
    "",
    ...secoes,
  ].join("\n");
}

/** Uma seção do prompt, por step referenciado. */
export function describeStepOutput(view: StepOutputView): string {
  const cabecalho = `## Passo «${view.name}» (${view.key}) — ${view.status}`;
  const linhas: string[] = [cabecalho];

  const { result } = view;
  if (result === null) {
    linhas.push(
      view.error === null
        ? "Este passo não produziu resultado."
        : `Este passo não produziu resultado: ${view.error.message}`,
    );
    linhas.push("");
    return linhas.join("\n");
  }

  switch (result.kind) {
    case "agent": {
      linhas.push(`Veredito do agente: ${result.status}`);
      if (result.summary !== undefined && result.summary.trim().length > 0) {
        linhas.push("", result.summary.trim());
      }
      if (result.artifacts !== undefined && result.artifacts.length > 0) {
        linhas.push("", "Arquivos declarados:");
        for (const artifact of result.artifacts) {
          linhas.push(
            `- ${artifact.path}${artifact.summary === undefined ? "" : `: ${artifact.summary}`}`,
          );
        }
      }
      break;
    }
    case "command":
    case "validation": {
      if (result.kind === "validation") linhas.push(`Veredito: ${result.verdict}`);
      linhas.push(
        `Código de saída: ${result.exitCode === null ? "(morto por sinal)" : String(result.exitCode)}`,
      );
      const stdout = tail(result.stdoutTail ?? "");
      const stderr = tail(result.stderrTail ?? "");
      if (stdout.length > 0) linhas.push("", "Saída padrão:", "```", stdout, "```");
      if (stderr.length > 0) linhas.push("", "Saída de erro:", "```", stderr, "```");
      break;
    }
    case "approval": {
      linhas.push(
        `Decisão humana: ${result.decision === "approve" ? "aprovado" : "recusado"}` +
          (result.note === null ? "" : ` — ${result.note}`),
      );
      break;
    }
    case "knowledge": {
      linhas.push(
        `${String(result.candidates.length)} candidato(s) a conhecimento consolidado(s).`,
      );
      for (const candidate of result.candidates) {
        linhas.push(`- ${candidate.title}: ${candidate.content}`);
      }
      break;
    }
  }

  linhas.push("");
  return linhas.join("\n");
}

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= OUTPUT_TAIL_IN_PROMPT_CHARS
    ? trimmed
    : `…${trimmed.slice(trimmed.length - OUTPUT_TAIL_IN_PROMPT_CHARS)}`;
}

/** Monta as vistas de `includeOutputsOf` a partir dos RunSteps e das definições. */
export function collectStepOutputs(
  keys: readonly string[],
  stepsByKey: ReadonlyMap<string, RunStep>,
  definitionsByKey: ReadonlyMap<string, WorkflowStepDefinition>,
): StepOutputView[] {
  const views: StepOutputView[] = [];
  for (const key of keys) {
    const step = stepsByKey.get(key);
    if (step === undefined) continue;
    const definition = definitionsByKey.get(key);
    views.push({
      key,
      name: definition?.name ?? step.name,
      status: step.status,
      result: step.result,
      error: step.error,
    });
  }
  return views;
}
