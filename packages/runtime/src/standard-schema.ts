/**
 * A parte do Standard Schema que o runtime precisa, declarada aqui.
 *
 * O structured output aceita qualquer validador que implemente a interface —
 * Zod, Valibot, ArkType. Declarar a forma mínima em vez de depender de
 * `@standard-schema/spec` evita mais uma dependência para três campos que não
 * mudam desde a versão 1 da especificação.
 *
 * @see https://standardschema.dev
 */

export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
}

export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaIssue[] };

export interface StandardSchemaLike<Output = unknown> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
  };
}

/** O valor implementa a interface? Usado antes de validar, para falhar claro. */
export function isStandardSchema(value: unknown): value is StandardSchemaLike {
  if (typeof value !== "object" || value === null) return false;
  const standard = (value as { "~standard"?: unknown })["~standard"];
  if (typeof standard !== "object" || standard === null) return false;
  return typeof (standard as { validate?: unknown }).validate === "function";
}

/** Formata as issues numa linha por problema, com o caminho do campo. */
export function formatIssues(issues: readonly StandardSchemaIssue[]): string {
  return issues
    .map((issue) => {
      const path = (issue.path ?? [])
        .map((segment) =>
          typeof segment === "object" && segment !== null && "key" in segment
            ? String(segment.key)
            : String(segment),
        )
        .join(".");
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join("\n");
}
