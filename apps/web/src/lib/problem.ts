import type { ProblemDetails } from "@dungeon-master/api-client";

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
