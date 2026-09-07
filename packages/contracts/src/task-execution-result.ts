import { z } from "zod";

import { RunResultStatusSchema } from "./run.js";

/**
 * `TaskExecutionResult` — o que o agente devolve no bloco `<result>`.
 *
 * "Resultado de uma execução não é apenas texto" (documento técnico, seção 39):
 * o desfecho precisa ser estruturado para que o orquestrador transforme saída
 * de IA em estado de domínio controlado, em vez de reler um parágrafo em busca
 * da palavra "pronto".
 *
 * Este é o schema que o worker passa como `outputSchema` do `ExecutionRequest`,
 * e é ele que o runtime valida antes de emitir `RunCompleted`. Só `status` é
 * obrigatório: um agente que não descobriu tarefa nenhuma não precisa escrever
 * uma lista vazia, e exigir campos que quase sempre são vazios só aumenta a
 * chance de o bloco sair inválido.
 *
 * Os campos além de `status` e `summary` são o vocabulário das Fases 5 e 6
 * (`artifacts`, `discoveredTasks`, `knowledgeCandidates`, `decisions`). Eles
 * chegam aqui agora porque quem escreve o bloco é o agente, e mudar o schema
 * depois significaria mudar o prompt de todo Loadout: aceitar o campo e ainda
 * não consumi-lo custa uma coluna de JSON; não aceitar custa uma migração de
 * prompt.
 */

export const TaskExecutionArtifactSchema = z
  .object({
    path: z.string().describe("Caminho relativo ao workspace do Run."),
    kind: z.string().optional().describe("Classificação livre: `file`, `patch`, `report`."),
    summary: z.string().optional().describe("O que este arquivo é, em uma linha."),
  })
  .meta({ id: "TaskExecutionArtifact", description: "Um arquivo que a execução produziu." });

export type TaskExecutionArtifact = z.infer<typeof TaskExecutionArtifactSchema>;

export const DiscoveredTaskSchema = z
  .object({
    title: z.string().describe("Título da Task proposta."),
    description: z.string().optional(),
    rationale: z.string().optional().describe("Por que o agente acha que ela precisa existir."),
  })
  .meta({
    id: "DiscoveredTask",
    description: "Trabalho que o agente encontrou pelo caminho e não fez. Vira Task na Fase 5.",
  });

export type DiscoveredTask = z.infer<typeof DiscoveredTaskSchema>;

export const KnowledgeCandidateInputSchema = z
  .object({
    title: z.string().describe("Título do que foi aprendido."),
    content: z.string().describe("O aprendizado, escrito para ser lido depois."),
    kind: z.string().optional().describe("Classificação livre: `convention`, `gotcha`, `howto`."),
  })
  .meta({
    id: "KnowledgeCandidateInput",
    description: "Candidato a item do Grimório do Project. Destilado na Fase 6.",
  });

export type KnowledgeCandidateInput = z.infer<typeof KnowledgeCandidateInputSchema>;

export const ExecutionDecisionSchema = z
  .object({
    summary: z.string().describe("A decisão, em uma linha."),
    rationale: z.string().optional().describe("Por que ela foi tomada."),
  })
  .meta({
    id: "ExecutionDecision",
    description: "Uma escolha que o agente fez e que alguém precisará entender depois.",
  });

export type ExecutionDecision = z.infer<typeof ExecutionDecisionSchema>;

export const TaskExecutionResultSchema = z
  .object({
    status: RunResultStatusSchema.describe(
      "O veredito do agente sobre a Task: `completed`, `blocked` ou `failed`. " +
        "É diferente de o processo ter terminado bem.",
    ),
    summary: z.string().optional().describe("O que foi feito, escrito pelo agente."),
    artifacts: z.array(TaskExecutionArtifactSchema).optional(),
    discoveredTasks: z.array(DiscoveredTaskSchema).optional(),
    knowledgeCandidates: z.array(KnowledgeCandidateInputSchema).optional(),
    decisions: z.array(ExecutionDecisionSchema).optional(),
    warnings: z.array(z.string()).optional().describe("Ressalvas sobre o que ficou pronto."),
  })
  .meta({
    id: "TaskExecutionResult",
    description: "O resultado estruturado que o agente devolve no bloco `<result>`.",
  });

export type TaskExecutionResult = z.infer<typeof TaskExecutionResultSchema>;

/**
 * A instrução que acompanha o schema no prompt.
 *
 * Escrita aqui, e não montada pelo runtime, porque ela é parte do contrato: o
 * campo que o agente precisa escrever e o que cada valor de `status` significa
 * são a mesma informação que o schema declara, e mantê-las em dois arquivos
 * faria uma envelhecer sem a outra.
 *
 * **Ela começa com uma linha em branco e um separador**, porque quem a aplica
 * concatena direto no fim do prompt (`prompt + instruction`). Sem isso a
 * primeira frase daqui gruda na última linha do pedido do usuário, e o que o
 * agente lê é uma linha só com as duas coisas misturadas.
 */
export const TASK_EXECUTION_RESULT_INSTRUCTION = [
  "",
  "",
  "---",
  "",
  "Ao terminar, feche a resposta com um bloco <result> contendo APENAS um JSON com o resultado:",
  "",
  "<result>",
  '{"status":"completed","summary":"o que você fez, em uma ou duas frases"}',
  "</result>",
  "",
  "Campos aceitos:",
  '- status (obrigatório): "completed" se a tarefa ficou pronta, "blocked" se você não',
  '  conseguiu prosseguir e alguém precisa desbloquear, "failed" se você tentou e não deu.',
  "- summary: o que foi feito.",
  "- artifacts: [{ path, kind?, summary? }] — arquivos relevantes que você produziu.",
  "- discoveredTasks: [{ title, description?, rationale? }] — trabalho que você encontrou e não fez.",
  "- knowledgeCandidates: [{ title, content, kind? }] — o que vale registrar para a próxima vez.",
  "- decisions: [{ summary, rationale? }] — escolhas que alguém precisará entender depois.",
  "- warnings: [texto] — ressalvas sobre o que ficou pronto.",
  "",
  "O bloco <result> é obrigatório e precisa ser a última coisa da sua resposta.",
].join("\n");
