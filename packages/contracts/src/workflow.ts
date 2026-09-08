import { z } from "zod";

import { UsageSummarySchema } from "./execution-event.js";
import { PageQuerySchema, paginatedSchema } from "./pagination.js";
import { RUN_PROMPT_MAX_LENGTH, RunErrorSchema, RunResultStatusSchema } from "./run.js";
import {
  KnowledgeCandidateInputSchema,
  TaskExecutionArtifactSchema,
} from "./task-execution-result.js";

/**
 * Workflow é o Ritual: o **processo** de uma execução, separado da inteligência
 * do agente (planejamento v0.4, Fase 4).
 *
 * Três decisões de produto moram neste arquivo e não se negociam:
 *
 * 1. **Workflows são dados.** A definição é JSON validado por este schema, com
 *    vocabulário pequeno e fixo. Não há linguagem de expressão nem template
 *    engine: condições são um conjunto fechado de predicados nomeados, e o
 *    prompt de um step de agente é texto literal ao qual o motor **anexa** o
 *    resultado dos steps listados em `includeOutputsOf`, sem substituição de
 *    placeholder. Regra: dados coordenam, código computa, agentes julgam
 *    (documento técnico, seção 19.1).
 * 2. **Fail-closed na definição.** Referência a step inexistente, ciclo, chave
 *    repetida ou predicado sobre um step que não é dependência são recusados
 *    aqui, com o caminho do campo e o nome do step na mensagem. Uma definição
 *    torta nunca chega ao banco.
 * 3. **Captura congelada.** Ao criar um Run, a definição vigente vira uma
 *    `WorkflowVersion` imutável, e é ela que o Run referencia. Editar o
 *    Workflow depois não afeta Runs em andamento nem retomadas.
 */

// --------------------------------------------------------------------------
// Vocabulário
// --------------------------------------------------------------------------

/**
 * Chave de um step ou de um gate: um slug curto, estável e único na definição.
 *
 * É por ela — e não pelo id da linha — que o motor liga `dependsOn`, `when`,
 * `includeOutputsOf` e o ApprovalGate ao step. Um Run retomado encontra o gate
 * pela chave, então ela precisa sobreviver a uma reescrita da definição.
 */
export const WORKFLOW_KEY_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;

export const WorkflowKeySchema = z
  .string()
  .regex(
    WORKFLOW_KEY_PATTERN,
    "Uma chave começa com letra minúscula e segue com letras minúsculas, dígitos ou hífens, com 2 a 41 caracteres.",
  );

/**
 * Tipos de step. Cada um tem executor próprio no motor (Fase 4B).
 *
 * Minúsculo de propósito, como `RunResultStatus`: é vocabulário de um documento
 * escrito pelo usuário, e não um enum interno da máquina de estados.
 */
export const WORKFLOW_STEP_TYPE_VALUES = [
  "agent",
  "command",
  "validation",
  "approval",
  "knowledge",
] as const;

export const WorkflowStepTypeSchema = z
  .enum(WORKFLOW_STEP_TYPE_VALUES)
  .meta({ id: "WorkflowStepType", description: "Tipo de um step de Workflow." });

export type WorkflowStepType = z.infer<typeof WorkflowStepTypeSchema>;

/** Limite de segurança para nomes, títulos e descrições de definição. */
export const WORKFLOW_NAME_MAX_LENGTH = 120;
export const WORKFLOW_DESCRIPTION_MAX_LENGTH = 5_000;
export const WORKFLOW_STEPS_MAX = 50;

/**
 * Um caminho relativo ao workspace do Run.
 *
 * Absoluto, com raiz ou com `..` é recusado: o step roda **dentro** do checkout
 * do Run, e um caminho que sai dele é um step que age fora do lugar onde o Run
 * tem permissão de agir. A checagem é textual — o contrato não conhece o disco.
 */
export function isWorkspaceRelativePath(value: string): boolean {
  if (value === "" || value.includes("\0")) return false;
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  return value.split(/[\\/]/).every((segment) => segment !== "..");
}

const WorkspaceRelativePathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(isWorkspaceRelativePath, "Um caminho é relativo ao workspace e não contém `..`.");

// --------------------------------------------------------------------------
// Predicados
// --------------------------------------------------------------------------

/**
 * O conjunto fechado de condições de um step.
 *
 * `when` é uma **conjunção**: todos os predicados precisam valer para o step
 * rodar; qualquer um falso pula o step com o motivo gravado. Um predicado
 * sobre um step que ainda não terminou é fail-closed: avalia `false`. Por isso
 * o schema exige que o step referenciado seja dependência, direta ou indireta,
 * do step que pergunta — o motor só avalia `when` quando as dependências já
 * assentaram.
 */
export const PREDICATE_KIND_VALUES = [
  "stepSucceeded",
  "stepFailed",
  "outputStatusIs",
  "validationPassed",
  "artifactExists",
] as const;

export const PredicateKindSchema = z
  .enum(PREDICATE_KIND_VALUES)
  .meta({ id: "PredicateKind", description: "Os predicados que um `when` pode usar." });

export type PredicateKind = z.infer<typeof PredicateKindSchema>;

const stepReference = WorkflowKeySchema.describe("Chave de um step que é dependência deste.");

export const PredicateSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("stepSucceeded"),
        step: stepReference,
      })
      .describe("O step terminou em `SUCCEEDED`."),
    z
      .object({
        kind: z.literal("stepFailed"),
        step: stepReference,
      })
      .describe("O step terminou em `FAILED` ou `TIMED_OUT`."),
    z
      .object({
        kind: z.literal("outputStatusIs"),
        step: stepReference.describe("Chave de um step de agente que é dependência deste."),
        status: RunResultStatusSchema.describe("O veredito que o agente reportou."),
      })
      .describe("O resultado estruturado do step de agente tem este `status`."),
    z
      .object({
        kind: z.literal("validationPassed"),
        step: stepReference.describe("Chave de um step de validação que é dependência deste."),
      })
      .describe("O step de validação saiu com código 0."),
    z
      .object({
        kind: z.literal("artifactExists"),
        path: WorkspaceRelativePathSchema.describe("Caminho relativo ao workspace do Run."),
      })
      .describe("O arquivo existe no workspace quando o step é avaliado."),
  ])
  .meta({ id: "Predicate", description: "Uma condição do conjunto fechado de `when`." });

export type Predicate = z.infer<typeof PredicateSchema>;

// --------------------------------------------------------------------------
// Steps
// --------------------------------------------------------------------------

/** Campos que todo step tem, qualquer que seja o tipo. */
const stepBase = {
  key: WorkflowKeySchema.describe(
    "Chave única na definição. É por ela que o Run acompanha o step.",
  ),
  name: z.string().trim().min(1).max(WORKFLOW_NAME_MAX_LENGTH).describe("Nome para leitura."),
  dependsOn: z
    .array(WorkflowKeySchema)
    .max(WORKFLOW_STEPS_MAX)
    .default([])
    .describe(
      "Steps que precisam ter assentado antes deste rodar. Sem `when`, todos " +
        "precisam ter terminado em `SUCCEEDED`; com `when`, os predicados decidem.",
    ),
  when: z
    .array(PredicateSchema)
    .min(1)
    .max(20)
    .optional()
    .describe("Conjunção de predicados. Qualquer um falso pula o step."),
  retry: z
    .object({
      maxAttempts: z
        .number()
        .int()
        .min(1)
        .max(5)
        .describe("Tentativas no total, incluindo a primeira."),
    })
    .optional()
    .describe("Quantas vezes o step pode rodar antes de contar como `FAILED`."),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(86_400_000)
    .optional()
    .describe("Teto de duração de uma tentativa, em milissegundos."),
};

export const AgentStepDefinitionSchema = z
  .object({
    type: z.literal("agent"),
    ...stepBase,
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(RUN_PROMPT_MAX_LENGTH)
      .describe(
        "Prompt literal do step. Sem placeholders: o que o motor acrescenta vai depois dele.",
      ),
    includeOutputsOf: z
      .array(WorkflowKeySchema)
      .max(WORKFLOW_STEPS_MAX)
      .optional()
      .describe(
        "Steps cujo resumo de resultado o motor anexa ao prompt. Precisam ser " +
          "dependências deste step, diretas ou indiretas.",
      ),
  })
  .meta({ id: "AgentStepDefinition", description: "Um step executado por um agente." });

const commandFields = {
  argv: z
    .array(z.string().min(1))
    .min(1)
    .max(100)
    .describe("Programa e argumentos, um por posição. Spawn sem shell: nada é interpretado."),
  cwd: WorkspaceRelativePathSchema.optional().describe(
    "Diretório de trabalho, relativo ao workspace do Run. Ausente é a raiz do workspace.",
  ),
};

export const CommandStepDefinitionSchema = z
  .object({
    type: z.literal("command"),
    ...stepBase,
    ...commandFields,
  })
  .meta({
    id: "CommandStepDefinition",
    description: "Um processo rodado sem shell. Código de saída diferente de 0 é `FAILED`.",
  });

export const ValidationStepDefinitionSchema = z
  .object({
    type: z.literal("validation"),
    ...stepBase,
    ...commandFields,
  })
  .meta({
    id: "ValidationStepDefinition",
    description:
      "Um processo com semântica de veredito: código 0 é `passed`, outro é `failed`. " +
      "Não derruba o Run por si só; quem decide são os dependentes, via `when`.",
  });

export const ApprovalStepDefinitionSchema = z
  .object({
    type: z.literal("approval"),
    ...stepBase,
    gateKey: WorkflowKeySchema.describe(
      "Chave do ApprovalGate, única na definição. É por ela, e não pelo id do step, " +
        "que um Run retomado reencontra o gate em vez de criar um segundo.",
    ),
    title: z.string().trim().min(1).max(200).describe("O que está sendo pedido, em uma linha."),
    description: z
      .string()
      .max(WORKFLOW_DESCRIPTION_MAX_LENGTH)
      .optional()
      .describe("Contexto para quem decide."),
  })
  .meta({ id: "ApprovalStepDefinition", description: "Uma pausa até um humano decidir." });

export const KnowledgeStepDefinitionSchema = z
  .object({
    type: z.literal("knowledge"),
    ...stepBase,
    mode: z
      .literal("collect")
      .describe(
        "`collect` consolida os `knowledgeCandidates` dos steps de agente anteriores no " +
          "resultado do Run. A destilação em KnowledgeItem é da Fase 6.",
      ),
  })
  .meta({ id: "KnowledgeStepDefinition", description: "Consolida o que os agentes aprenderam." });

export const WorkflowStepDefinitionSchema = z
  .discriminatedUnion("type", [
    AgentStepDefinitionSchema,
    CommandStepDefinitionSchema,
    ValidationStepDefinitionSchema,
    ApprovalStepDefinitionSchema,
    KnowledgeStepDefinitionSchema,
  ])
  .meta({ id: "WorkflowStepDefinition", description: "Um step, discriminado por `type`." });

export type WorkflowStepDefinition = z.infer<typeof WorkflowStepDefinitionSchema>;
export type AgentStepDefinition = z.infer<typeof AgentStepDefinitionSchema>;
export type CommandStepDefinition = z.infer<typeof CommandStepDefinitionSchema>;
export type ValidationStepDefinition = z.infer<typeof ValidationStepDefinitionSchema>;
export type ApprovalStepDefinition = z.infer<typeof ApprovalStepDefinitionSchema>;
export type KnowledgeStepDefinition = z.infer<typeof KnowledgeStepDefinitionSchema>;

// --------------------------------------------------------------------------
// Definição
// --------------------------------------------------------------------------

/** Um step visto pela validação estrutural. Só o que a checagem de grafo lê. */
interface StepShape {
  readonly key: string;
  readonly dependsOn: readonly string[];
}

/**
 * Procura um ciclo em `dependsOn` e devolve o caminho fechado, ou `null`.
 *
 * Busca em profundidade iterativa, como em `@dungeon-master/domain`: a
 * autoridade em tempo de execução é o grafo do domínio, e o teste de paridade
 * de lá garante que as duas concordam. Esta cópia existe porque o contrato não
 * pode importar o domínio — é o domínio que importa os tipos daqui.
 *
 * Só arestas para chaves existentes entram: a referência inexistente já é
 * apontada por outra checagem, e uma aresta para o nada não fecha ciclo.
 */
function findStepCycle(steps: readonly StepShape[]): string[] | null {
  const known = new Set(steps.map((step) => step.key));
  const adjacency = new Map<string, string[]>();
  for (const step of steps) {
    adjacency.set(
      step.key,
      step.dependsOn.filter((dependency) => known.has(dependency) && dependency !== step.key),
    );
  }

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();

  for (const start of adjacency.keys()) {
    if ((color.get(start) ?? WHITE) !== WHITE) continue;

    const path: string[] = [start];
    const stack: Array<{ node: string; next: number }> = [{ node: start, next: 0 }];
    color.set(start, GREY);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const neighbours = adjacency.get(frame.node) ?? [];

      if (frame.next >= neighbours.length) {
        color.set(frame.node, BLACK);
        stack.pop();
        path.pop();
        continue;
      }

      const next = neighbours[frame.next]!;
      frame.next += 1;

      const nextColor = color.get(next) ?? WHITE;
      if (nextColor === GREY) return [...path.slice(path.indexOf(next)), next];
      if (nextColor === BLACK) continue;

      color.set(next, GREY);
      path.push(next);
      stack.push({ node: next, next: 0 });
    }
  }

  return null;
}

/**
 * Todas as dependências, diretas e indiretas, de cada step.
 *
 * Calculado sobre as arestas válidas. Num grafo com ciclo o resultado é
 * parcial, mas o ciclo já foi recusado antes deste cálculo ser lido.
 */
function ancestorsByKey(steps: readonly StepShape[]): Map<string, Set<string>> {
  const known = new Set(steps.map((step) => step.key));
  const direct = new Map(
    steps.map((step) => [step.key, step.dependsOn.filter((key) => known.has(key))] as const),
  );
  const result = new Map<string, Set<string>>();

  for (const step of steps) {
    const seen = new Set<string>();
    const queue = [...(direct.get(step.key) ?? [])];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current)) continue;
      seen.add(current);
      queue.push(...(direct.get(current) ?? []));
    }
    result.set(step.key, seen);
  }

  return result;
}

type DefinitionShape = {
  readonly steps: readonly WorkflowStepDefinition[];
};

/**
 * As regras estruturais que o `z.object` sozinho não expressa.
 *
 * Cada recusa aponta o step pela chave e pelo caminho do campo, para que a
 * mensagem de `422` diga "o step `execute` referencia `aprove-plan`, que não
 * existe" em vez de "definição inválida".
 */
function validateDefinition(definition: DefinitionShape, ctx: z.RefinementCtx): void {
  const { steps } = definition;
  const indexByKey = new Map<string, number>();

  steps.forEach((step, i) => {
    const seen = indexByKey.get(step.key);
    if (seen !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["steps", i, "key"],
        message: `O step "${step.key}" repete a chave do step na posição ${String(seen)}.`,
      });
      return;
    }
    indexByKey.set(step.key, i);
  });

  const gateByKey = new Map<string, string>();
  steps.forEach((step, i) => {
    if (step.type !== "approval") return;
    const owner = gateByKey.get(step.gateKey);
    if (owner !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["steps", i, "gateKey"],
        message: `O step "${step.key}" repete o gateKey "${step.gateKey}" do step "${owner}".`,
      });
      return;
    }
    gateByKey.set(step.gateKey, step.key);
  });

  steps.forEach((step, i) => {
    step.dependsOn.forEach((dependency, j) => {
      if (dependency === step.key) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "dependsOn", j],
          message: `O step "${step.key}" depende de si mesmo.`,
        });
      } else if (!indexByKey.has(dependency)) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "dependsOn", j],
          message: `O step "${step.key}" depende de "${dependency}", que não existe na definição.`,
        });
      }
    });
  });

  const cycle = findStepCycle(steps);
  if (cycle !== null) {
    const first = indexByKey.get(cycle[0]!) ?? 0;
    ctx.addIssue({
      code: "custom",
      path: ["steps", first, "dependsOn"],
      message: `As dependências formam um ciclo: ${cycle.join(" → ")}.`,
    });
  }

  const ancestors = ancestorsByKey(steps);
  const typeByKey = new Map(steps.map((step) => [step.key, step.type] as const));

  const requireAncestor = (
    step: WorkflowStepDefinition,
    i: number,
    path: (string | number)[],
    target: string,
    field: string,
  ): boolean => {
    if (!indexByKey.has(target)) {
      ctx.addIssue({
        code: "custom",
        path: ["steps", i, ...path],
        message: `O step "${step.key}" referencia em ${field} o step "${target}", que não existe na definição.`,
      });
      return false;
    }
    if (!(ancestors.get(step.key)?.has(target) ?? false)) {
      ctx.addIssue({
        code: "custom",
        path: ["steps", i, ...path],
        message:
          `O step "${step.key}" referencia em ${field} o step "${target}", que não é dependência ` +
          "dele, direta ou indireta. O resultado só existe depois que a dependência assenta.",
      });
      return false;
    }
    return true;
  };

  steps.forEach((step, i) => {
    if (step.type === "agent") {
      step.includeOutputsOf?.forEach((target, j) => {
        requireAncestor(step, i, ["includeOutputsOf", j], target, "includeOutputsOf");
      });
    }

    step.when?.forEach((predicate, j) => {
      if (predicate.kind === "artifactExists") return;
      const valid = requireAncestor(step, i, ["when", j, "step"], predicate.step, "when");
      if (!valid) return;

      const targetType = typeByKey.get(predicate.step);
      if (predicate.kind === "validationPassed" && targetType !== "validation") {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "when", j, "step"],
          message: `O predicado validationPassed do step "${step.key}" aponta para "${predicate.step}", que é do tipo ${String(targetType)} e não validation.`,
        });
      }
      if (predicate.kind === "outputStatusIs" && targetType !== "agent") {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "when", j, "step"],
          message: `O predicado outputStatusIs do step "${step.key}" aponta para "${predicate.step}", que é do tipo ${String(targetType)} e não agent.`,
        });
      }
    });
  });
}

export const WorkflowDefinitionSchema = z
  .object({
    name: z.string().trim().min(1).max(WORKFLOW_NAME_MAX_LENGTH).describe("Nome do Workflow."),
    description: z.string().max(WORKFLOW_DESCRIPTION_MAX_LENGTH).optional(),
    steps: z
      .array(WorkflowStepDefinitionSchema)
      .min(1)
      .max(WORKFLOW_STEPS_MAX)
      .describe("Os steps, na ordem de leitura. A ordem de execução vem de `dependsOn`."),
  })
  .superRefine(validateDefinition)
  .meta({
    id: "WorkflowDefinition",
    description:
      "A definição de um Workflow: dados validados, sem linguagem de expressão. " +
      "É o documento que a captura congela em uma WorkflowVersion.",
  });

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

/**
 * `POST /workflows` e `PUT /workflows/{id}` recebem a definição inteira.
 *
 * Os dois nomes são o mesmo schema: criar e substituir validam o mesmo
 * documento, e uma edição parcial não existe de propósito — o que congela em
 * uma versão é a definição completa.
 */
export const CreateWorkflowSchema = WorkflowDefinitionSchema;
export type CreateWorkflow = WorkflowDefinition;
export const UpdateWorkflowSchema = WorkflowDefinitionSchema;
export type UpdateWorkflow = WorkflowDefinition;

// --------------------------------------------------------------------------
// Workflow, WorkflowVersion e WorkflowStep
// --------------------------------------------------------------------------

export const WorkflowSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do Workflow."),
    name: z.string().describe("Nome, igual ao `definition.name`. Único por usuário."),
    description: z.string().nullable(),
    definition: WorkflowDefinitionSchema.describe(
      "A definição vigente, que a próxima captura congela.",
    ),
    latestVersion: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe(
        "Número da última WorkflowVersion capturada. Nulo enquanto nenhum Run usou o Workflow.",
      ),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Workflow", description: "Um Workflow e a definição vigente dele." });

export type Workflow = z.infer<typeof WorkflowSchema>;

export const WorkflowListQuerySchema = PageQuerySchema.meta({ id: "WorkflowListQuery" });
export type WorkflowListQuery = z.infer<typeof WorkflowListQuerySchema>;

export const WorkflowPageSchema = paginatedSchema(
  WorkflowSchema,
  "WorkflowPage",
  "Uma página de Workflows, em ordem alfabética de nome.",
);

export type WorkflowPage = z.infer<typeof WorkflowPageSchema>;

/**
 * A captura congelada de uma definição.
 *
 * Imutável: uma versão nova só nasce quando a definição mudou desde a última,
 * por comparação canônica do JSON. Um Workflow editado e desfeito de volta ao
 * que era reaproveita a versão anterior.
 */
export const WorkflowVersionSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 da versão. É o `workflowVersionId` do Run."),
    workflowId: z.uuid(),
    version: z.number().int().positive().describe("Sequencial por Workflow, começando em 1."),
    definition: WorkflowDefinitionSchema.describe("A definição no instante da captura."),
    createdAt: z.iso.datetime().describe("Instante da captura, em UTC."),
  })
  .meta({ id: "WorkflowVersion", description: "Uma definição congelada, referenciada por Runs." });

export type WorkflowVersion = z.infer<typeof WorkflowVersionSchema>;

/**
 * Um step de uma versão, como linha própria.
 *
 * Existe além do JSON da versão porque o RunStep aponta para ele: é o que
 * permite perguntar ao banco "qual definição de step este RunStep executou"
 * sem reabrir o documento inteiro.
 */
export const WorkflowStepSchema = z
  .object({
    id: z.uuid(),
    workflowVersionId: z.uuid(),
    key: WorkflowKeySchema,
    name: z.string(),
    type: WorkflowStepTypeSchema,
    position: z
      .number()
      .int()
      .nonnegative()
      .describe("Posição na ordem topológica da captura. Começa em 0."),
    definition: WorkflowStepDefinitionSchema,
  })
  .meta({ id: "WorkflowStep", description: "Um step de uma WorkflowVersion." });

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowVersionDetailSchema = WorkflowVersionSchema.extend({
  steps: z.array(WorkflowStepSchema).describe("Os steps, na ordem topológica da captura."),
}).meta({ id: "WorkflowVersionDetail", description: "Uma versão com os steps materializados." });

export type WorkflowVersionDetail = z.infer<typeof WorkflowVersionDetailSchema>;

export const WorkflowVersionListQuerySchema = PageQuerySchema.meta({
  id: "WorkflowVersionListQuery",
});
export type WorkflowVersionListQuery = z.infer<typeof WorkflowVersionListQuerySchema>;

export const WorkflowVersionPageSchema = paginatedSchema(
  WorkflowVersionSchema,
  "WorkflowVersionPage",
  "Uma página de versões, da mais recente para a mais antiga.",
);

export type WorkflowVersionPage = z.infer<typeof WorkflowVersionPageSchema>;

// --------------------------------------------------------------------------
// RunStep
// --------------------------------------------------------------------------

/**
 * Os oito estados de um RunStep.
 *
 * O array vem antes do schema pelo mesmo motivo de `RUN_STATUS_VALUES`: o
 * `pgEnum` do banco e a tabela de transições do domínio precisam do mesmo
 * valor. `SKIPPED` é a diferença para o Run: um step cujo `when` falhou, ou
 * cuja dependência não terminou em `SUCCEEDED`, não roda e o registro diz o
 * motivo.
 */
export const RUN_STEP_STATUS_VALUES = [
  "PENDING",
  "RUNNING",
  "WAITING_APPROVAL",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
  "TIMED_OUT",
  "CANCELLED",
] as const;

export const RunStepStatusSchema = z
  .enum(RUN_STEP_STATUS_VALUES)
  .meta({ id: "RunStepStatus", description: "Estado de um RunStep na máquina de estados." });

export type RunStepStatus = z.infer<typeof RunStepStatusSchema>;

export const VALIDATION_VERDICT_VALUES = ["passed", "failed"] as const;

export const ValidationVerdictSchema = z.enum(VALIDATION_VERDICT_VALUES).meta({
  id: "ValidationVerdict",
  description: "Código 0 é `passed`; qualquer outro é `failed`.",
});

export type ValidationVerdict = z.infer<typeof ValidationVerdictSchema>;

export const APPROVAL_DECISION_VALUES = ["approve", "reject"] as const;

export const ApprovalDecisionSchema = z
  .enum(APPROVAL_DECISION_VALUES)
  .meta({ id: "ApprovalDecision", description: "O que o humano decidiu no gate." });

export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

const processResultFields = {
  exitCode: z
    .number()
    .int()
    .nullable()
    .describe("Código de saída. Nulo quando o processo morreu por sinal."),
  durationMs: z.number().int().nonnegative(),
  stdoutTail: z.string().optional().describe("Fim da saída padrão, truncado e sanitizado."),
  stderrTail: z.string().optional().describe("Fim da saída de erro, truncado e sanitizado."),
};

/**
 * O resultado de um RunStep, discriminado pelo tipo do step.
 *
 * É o que os predicados leem e o que `includeOutputsOf` resume para o prompt
 * do step seguinte. A forma é fechada por tipo para que o motor (Fase 4B) e a
 * interface (Fase 4C) leiam o mesmo campo pelo mesmo nome.
 */
export const RunStepResultSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("agent"),
        status: RunResultStatusSchema.describe(
          "O veredito do agente. É o que `outputStatusIs` lê.",
        ),
        summary: z.string().optional().describe("Resumo escrito pelo agente."),
        output: z.unknown().optional().describe("Structured output validado, quando houver."),
        harnessSessionId: z.string().min(1).optional(),
        artifacts: z
          .array(TaskExecutionArtifactSchema)
          .optional()
          .describe("Arquivos que o agente declarou ter produzido neste step."),
        knowledgeCandidates: z
          .array(KnowledgeCandidateInputSchema)
          .optional()
          .describe("O que o agente aprendeu. O step `knowledge` consolida isto."),
        usage: UsageSummarySchema.optional().describe("Consumo de tokens do step."),
      })
      .describe("Resultado de um step `agent`."),
    z
      .object({
        kind: z.literal("command"),
        ...processResultFields,
      })
      .describe("Resultado de um step `command`."),
    z
      .object({
        kind: z.literal("validation"),
        verdict: ValidationVerdictSchema,
        ...processResultFields,
      })
      .describe("Resultado de um step `validation`."),
    z
      .object({
        kind: z.literal("approval"),
        gateId: z.uuid(),
        decision: ApprovalDecisionSchema,
        note: z.string().nullable(),
        resolvedAt: z.iso.datetime(),
      })
      .describe("Resultado de um step `approval`, escrito na resolução do gate."),
    z
      .object({
        kind: z.literal("knowledge"),
        candidates: z.array(KnowledgeCandidateInputSchema),
      })
      .describe("Resultado de um step `knowledge`."),
  ])
  .meta({ id: "RunStepResult", description: "O resultado de um RunStep, por tipo de step." });

export type RunStepResult = z.infer<typeof RunStepResultSchema>;

export const RunStepSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do RunStep."),
    runId: z.uuid(),
    workflowStepId: z
      .uuid()
      .describe("O WorkflowStep da versão congelada que este RunStep executa."),
    key: WorkflowKeySchema,
    name: z.string(),
    type: WorkflowStepTypeSchema,
    position: z.number().int().nonnegative().describe("Ordem topológica da captura."),
    status: RunStepStatusSchema,
    attempt: z
      .number()
      .int()
      .nonnegative()
      .describe("Quantas vezes o step já rodou. Zero enquanto `PENDING`."),
    startedAt: z.iso.datetime().nullable().describe("Primeira entrada em `RUNNING`, em UTC."),
    finishedAt: z.iso.datetime().nullable().describe("Entrada em estado terminal, em UTC."),
    result: RunStepResultSchema.nullable(),
    error: RunErrorSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "RunStep", description: "Um step de um Run, com estado próprio." });

export type RunStep = z.infer<typeof RunStepSchema>;

export const RunStepListSchema = z
  .object({
    items: z.array(RunStepSchema).describe("Os steps do Run, na ordem topológica."),
  })
  .meta({ id: "RunStepList", description: "Os RunSteps de um Run." });

export type RunStepList = z.infer<typeof RunStepListSchema>;

/**
 * Por que um step foi pulado. Gravado no evento `StepSkipped` e no RunStep.
 *
 * `PREDICATE_FALSE` carrega o predicado que falhou e o motivo; um predicado
 * sobre um step ausente ou um resultado sem o campo esperado é fail-closed e
 * também cai aqui, com `detail` dizendo o que faltou.
 */
export const StepSkipReasonSchema = z
  .discriminatedUnion("code", [
    z.object({
      code: z.literal("PREDICATE_FALSE"),
      predicate: PredicateSchema,
      detail: z.string().describe("Por que o predicado avaliou falso."),
    }),
    z.object({
      code: z.literal("DEPENDENCY_NOT_SUCCEEDED"),
      dependency: WorkflowKeySchema,
      status: RunStepStatusSchema.describe("Estado terminal em que a dependência ficou."),
    }),
  ])
  .meta({ id: "StepSkipReason", description: "Por que um RunStep ficou `SKIPPED`." });

export type StepSkipReason = z.infer<typeof StepSkipReasonSchema>;

// --------------------------------------------------------------------------
// ApprovalGate
// --------------------------------------------------------------------------

export const APPROVAL_GATE_STATUS_VALUES = ["PENDING", "GRANTED", "REJECTED"] as const;

export const ApprovalGateStatusSchema = z
  .enum(APPROVAL_GATE_STATUS_VALUES)
  .meta({ id: "ApprovalGateStatus", description: "Estado de um ApprovalGate." });

export type ApprovalGateStatus = z.infer<typeof ApprovalGateStatusSchema>;

/**
 * Um pedido de aprovação humana dentro de um Run.
 *
 * Identificado por `gateKey`, única dentro do Run, e não pelo id do step: um
 * Run retomado encontra o gate pela chave e não cria um segundo. A resolução é
 * um CAS transacional (documento técnico, seção 26): quem perde a corrida
 * recebe `409` com o estado atual, e nada é sobrescrito.
 */
export const ApprovalGateSchema = z
  .object({
    id: z.uuid().describe("UUIDv7 do gate."),
    runId: z.uuid(),
    runStepId: z.uuid().describe("O RunStep de tipo `approval` que pediu."),
    gateKey: WorkflowKeySchema.describe("Chave estável do gate, vinda da definição."),
    title: z.string(),
    description: z.string().nullable(),
    status: ApprovalGateStatusSchema,
    requestedAt: z.iso.datetime().describe("Quando o Run parou para esperar, em UTC."),
    resolvedAt: z.iso.datetime().nullable().describe("Quando a decisão foi gravada, em UTC."),
    note: z.string().nullable().describe("Justificativa de quem decidiu, sanitizada."),
  })
  .meta({ id: "ApprovalGate", description: "Um pedido de aprovação humana em um Run." });

export type ApprovalGate = z.infer<typeof ApprovalGateSchema>;

/**
 * Um gate na listagem, com a Task e o Workflow por junção.
 *
 * O Workflow vem pelo caminho Run → versão congelada → Workflow, resolvido na
 * leitura: a caixa de entrada mostra "qual Ritual pediu" em toda linha, e sem
 * ele a interface fazia duas leituras por gate para descobrir. Os quatro
 * campos são anuláveis juntos, para o caso de um Run sem Workflow — que hoje
 * não abre gate, mas o contrato não depende disso.
 */
export const ApprovalGateListItemSchema = ApprovalGateSchema.extend({
  taskId: z.uuid().describe("Task do Run. Vem por junção."),
  taskTitle: z.string().describe("Título da Task no momento da leitura. Vem por junção."),
  workflowId: z.uuid().nullable().describe("Workflow do Run. Vem por junção."),
  workflowVersionId: z
    .uuid()
    .nullable()
    .describe("A versão congelada que o Run executa. Vem por junção."),
  workflowName: z
    .string()
    .nullable()
    .describe("Nome atual do Workflow, como o título da Task: acompanha uma renomeação."),
  workflowVersion: z.number().int().positive().nullable().describe("Número da versão congelada."),
}).meta({
  id: "ApprovalGateListItem",
  description: "Um gate na listagem, com a Task e o Workflow junto.",
});

export type ApprovalGateListItem = z.infer<typeof ApprovalGateListItemSchema>;

export const ApprovalGateListSchema = z
  .object({
    items: z.array(ApprovalGateSchema).describe("Os gates do Run, do mais antigo ao mais novo."),
  })
  .meta({ id: "ApprovalGateList", description: "Os ApprovalGates de um Run." });

export type ApprovalGateList = z.infer<typeof ApprovalGateListSchema>;

export const ApprovalGateListQuerySchema = PageQuerySchema.extend({
  status: ApprovalGateStatusSchema.optional().describe("Só os gates neste estado."),
  runId: z.uuid().optional().describe("Só os gates deste Run."),
}).meta({ id: "ApprovalGateListQuery" });

export type ApprovalGateListQuery = z.infer<typeof ApprovalGateListQuerySchema>;

export const ApprovalGatePageSchema = paginatedSchema(
  ApprovalGateListItemSchema,
  "ApprovalGatePage",
  "Uma página de gates, do pedido mais recente para o mais antigo.",
);

export type ApprovalGatePage = z.infer<typeof ApprovalGatePageSchema>;

export const APPROVAL_NOTE_MAX_LENGTH = 5_000;

export const ResolveApprovalGateSchema = z
  .object({
    decision: ApprovalDecisionSchema,
    note: z
      .string()
      .trim()
      .max(APPROVAL_NOTE_MAX_LENGTH)
      .optional()
      .describe("Justificativa. Vai para o evento de auditoria."),
  })
  .meta({
    id: "ResolveApprovalGate",
    description: "Corpo de `POST /api/v1/approval-gates/{id}/resolve`.",
  });

export type ResolveApprovalGate = z.infer<typeof ResolveApprovalGateSchema>;
