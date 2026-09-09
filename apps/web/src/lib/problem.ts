import type { ProblemDetails } from "@dungeon-master/api-client";
import type { CapabilityIssue, ValidationIssue } from "@dungeon-master/contracts";

/**
 * A mensagem que a tela mostra quando a API recusa alguma coisa.
 *
 * Todo erro da API sai em `application/problem+json` (RFC 9457), e o `detail` é
 * a explicação daquela ocorrência: "a Task já está concluída", "o ciclo passa
 * por estas três". Mostrar o `detail` é o que faz um `409` virar informação em
 * vez de um "algo deu errado". O `status` entra só como último recurso.
 */
export function problemMessage(problem: unknown, status: number, fallback: string): string {
  if (typeof problem === "object" && problem !== null) {
    const detail = (problem as Partial<ProblemDetails>).detail;
    if (typeof detail === "string" && detail !== "") return detail;
  }
  return `${fallback} (HTTP ${String(status)})`;
}

/**
 * Um erro de API já com a mensagem pronta e o `status` preservado.
 *
 * O `status` sobrevive porque quem chama às vezes decide pelo código: um `409`
 * de transição recusada é aviso, um `500` é falha.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Lança um `ApiError` com o `detail` do problem details. */
export function fail(problem: unknown, status: number, fallback: string): never {
  throw new ApiError(problemMessage(problem, status, fallback), status);
}

/**
 * Os `errors[]` de um problem details de validação, quando existirem.
 *
 * Um `422` de definição de Workflow aponta o step e o campo em cada issue;
 * sem esta leitura o editor só teria o `detail` genérico para mostrar.
 */
export function problemIssues(problem: unknown): readonly ValidationIssue[] {
  if (typeof problem !== "object" || problem === null) return [];
  const errors = (problem as Partial<ProblemDetails>).errors;
  if (!Array.isArray(errors)) return [];
  return errors.filter(
    (issue): issue is ValidationIssue =>
      typeof issue === "object" &&
      issue !== null &&
      typeof (issue as ValidationIssue).path === "string" &&
      typeof (issue as ValidationIssue).message === "string",
  );
}

/**
 * Os `blockers[]` do `409` de `POST /runs` (Fase 8A), quando existirem.
 *
 * É um membro de extensão do problem details, fora do contrato de
 * `ProblemDetails`, e por isso lido com cuidado: cada item precisa de
 * `code`, `severity` e `message`, senão não é um descompasso de capability.
 */
export function problemBlockers(problem: unknown): readonly CapabilityIssue[] {
  if (typeof problem !== "object" || problem === null) return [];
  const blockers = (problem as { blockers?: unknown }).blockers;
  if (!Array.isArray(blockers)) return [];
  return blockers.filter(
    (issue): issue is CapabilityIssue =>
      typeof issue === "object" &&
      issue !== null &&
      typeof (issue as CapabilityIssue).code === "string" &&
      typeof (issue as CapabilityIssue).severity === "string" &&
      typeof (issue as CapabilityIssue).message === "string",
  );
}
