import {
  PROBLEM_TYPE_BASE_URI,
  type ProblemDetails,
  type ValidationIssue,
} from "@dungeon-master/contracts";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodError } from "zod";

export const PROBLEM_CONTENT_TYPE = "application/problem+json" as const;

/** Tipos de problema que a API já emite. Cada um vira um URI estável. */
export const ProblemType = {
  validation: `${PROBLEM_TYPE_BASE_URI}/validation-error`,
  notFound: `${PROBLEM_TYPE_BASE_URI}/not-found`,
  internal: `${PROBLEM_TYPE_BASE_URI}/internal-error`,
  /**
   * A requisição está bem formada, mas contraria uma regra de domínio: uma
   * transição que a máquina de estados não tem, um ciclo de dependências, um
   * Project arquivado. É `409`, e não `400`: nada no corpo precisa ser
   * corrigido — o estado do sistema é que não comporta a operação agora.
   */
  conflict: `${PROBLEM_TYPE_BASE_URI}/domain-conflict`,
} as const;

/**
 * Erro que a aplicação lança quando já sabe qual resposta HTTP quer.
 * Qualquer outro erro vira 500 sem vazar detalhes internos.
 */
export class HttpProblem extends Error {
  readonly status: ContentfulStatusCode;
  readonly type: string;
  readonly title: string;
  readonly errors: ValidationIssue[] | undefined;

  constructor(init: {
    status: ContentfulStatusCode;
    title: string;
    detail: string;
    type?: string;
    errors?: ValidationIssue[];
  }) {
    super(init.detail);
    this.name = "HttpProblem";
    this.status = init.status;
    this.title = init.title;
    this.type = init.type ?? "about:blank";
    this.errors = init.errors;
  }
}

/**
 * O tipo de problema que combina com um código de status.
 *
 * Existe para o erro que chega **de fora** do nosso código — uma `HTTPException`
 * do Hono, lançada pelo parser de corpo antes de qualquer handler nosso rodar.
 * Ele já sabe o status; o que falta é o URI estável que o RFC 9457 pede, e
 * escolhê-lo por status é a única tradução possível sem inventar informação.
 */
export function problemTypeForStatus(status: number): string {
  if (status === 404) return ProblemType.notFound;
  if (status === 409) return ProblemType.conflict;
  if (status >= 500) return ProblemType.internal;
  // 400, 413, 415, 422 e o resto da família 4xx: o corpo da requisição é que
  // precisa mudar, que é o que `validation-error` diz.
  if (status >= 400) return ProblemType.validation;
  return "about:blank";
}

/** Título curto para um status sem título próprio. */
export function problemTitleForStatus(status: number): string {
  if (status === 404) return "Não encontrado";
  if (status === 409) return "Conflito";
  if (status === 413) return "Corpo grande demais";
  if (status === 415) return "Tipo de mídia não suportado";
  if (status >= 500) return "Erro interno";
  return "Requisição inválida";
}

/** Converte os issues do Zod na lista `errors[]` do problem details. */
export function toValidationIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
    code: issue.code,
  }));
}

export interface BuildProblemInput {
  status: ContentfulStatusCode;
  title: string;
  detail: string;
  instance: string;
  type?: string;
  requestId?: string | undefined;
  errors?: ValidationIssue[] | undefined;
}

export function buildProblem(input: BuildProblemInput): ProblemDetails {
  const problem: ProblemDetails = {
    type: input.type ?? "about:blank",
    title: input.title,
    status: input.status,
    detail: input.detail,
    instance: input.instance,
  };

  if (input.requestId !== undefined) {
    problem.requestId = input.requestId;
  }
  if (input.errors !== undefined && input.errors.length > 0) {
    problem.errors = input.errors;
  }

  return problem;
}

/**
 * Serializa o problema com `content-type: application/problem+json`.
 * `c.json` não serve porque fixaria `application/json`.
 */
export function problemResponse(c: Context, problem: ProblemDetails): Response {
  return c.body(JSON.stringify(problem), problem.status as ContentfulStatusCode, {
    "content-type": PROBLEM_CONTENT_TYPE,
  });
}
