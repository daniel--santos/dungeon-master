import { z } from "zod";

/**
 * A escada de autonomia por Project (documento técnico, seção 40; planejamento
 * v0.4, Fase 9).
 *
 * ```text
 * 0  o usuário cria Task e executa à mão; nada é sugerido
 * 1  o sistema sugere Loadout, Workflow e Model
 * 2  o agente propõe subtarefas; o humano aprova (o padrão)
 * 3  políticas autoaprovam propostas e concedem gates; auto-despacho liberado
 * 4  delegação Agent-to-Agent e workflows dinâmicos
 * ```
 *
 * O nível 5 (orquestração de projetos altamente autônoma) fica fora do
 * contrato de propósito: não começar por ele é decisão intencional.
 *
 * O que cada nível libera é verdade do **domínio** (`allowsAutomation` em
 * `@dungeon-master/domain`), e não deste arquivo: aqui só o vocabulário e a
 * forma da resposta. Uma política com `AUTO_APPROVE` só produz efeito se o
 * nível do Project permitir — fail-closed em tudo que autoriza.
 */

export const AUTONOMY_LEVEL_VALUES = [0, 1, 2, 3, 4] as const;

// Uma união de literais, e não `z.literal([0, 1, 2, 3, 4])`: o conversor
// OpenAPI do Hono emite `enum: [0]` para a forma com lista — só o primeiro
// valor —, e o cliente gerado tiparia o nível como `0`. A união sai como
// `anyOf` de `const` e vira `0 | 1 | 2 | 3 | 4` no `schema.d.ts`.
export const AutonomyLevelSchema = z
  .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
  .meta({
    id: "AutonomyLevel",
    description:
      "0 manual, 1 sugere, 2 propõe e o humano aprova, 3 políticas autoaprovam e auto-despacho, " +
      "4 delegação Agent-to-Agent.",
  });

export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;

/** O nível com que todo Project nasce: propor sim, decidir não. */
export const DEFAULT_AUTONOMY_LEVEL: AutonomyLevel = 2;

/**
 * As automações que a escada regula.
 *
 * `SUGGEST` é `POST /tasks/{id}/suggestions`; `AUTO_APPROVE_PROPOSAL` é a
 * política criando a Task sem passar pela proposta; `AUTO_APPROVE_GATE` é a
 * política concedendo um ApprovalGate (9B); `AUTO_DISPATCH` é o Worker
 * enfileirando por conta própria (9B); `DELEGATE` é a ferramenta de delegação
 * Agent-to-Agent (9B).
 */
export const AUTOMATION_KIND_VALUES = [
  "SUGGEST",
  "AUTO_APPROVE_PROPOSAL",
  "AUTO_APPROVE_GATE",
  "AUTO_DISPATCH",
  "DELEGATE",
] as const;

export const AutomationKindSchema = z.enum(AUTOMATION_KIND_VALUES).meta({
  id: "AutomationKind",
  description: "Uma automação que o nível de autonomia do Project libera ou não.",
});

export type AutomationKind = z.infer<typeof AutomationKindSchema>;

export const ProjectAutonomySchema = z
  .object({
    projectId: z.uuid(),
    autonomyLevel: AutonomyLevelSchema,
    allows: z
      .object({
        SUGGEST: z.boolean(),
        AUTO_APPROVE_PROPOSAL: z.boolean(),
        AUTO_APPROVE_GATE: z.boolean(),
        AUTO_DISPATCH: z.boolean(),
        DELEGATE: z.boolean(),
      })
      .describe("O que o nível atual libera, calculado pelo domínio."),
    updatedAt: z.iso.datetime().describe("Última escrita do Project, em UTC."),
  })
  .meta({
    id: "ProjectAutonomy",
    description: "O nível de autonomia de um Project e o que ele libera.",
  });

export type ProjectAutonomy = z.infer<typeof ProjectAutonomySchema>;

export const UpdateProjectAutonomySchema = z
  .object({
    autonomyLevel: AutonomyLevelSchema,
  })
  .meta({
    id: "UpdateProjectAutonomy",
    description: "Corpo de `PATCH /api/v1/projects/{id}/autonomy`.",
  });

export type UpdateProjectAutonomy = z.infer<typeof UpdateProjectAutonomySchema>;
