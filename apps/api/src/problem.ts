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
