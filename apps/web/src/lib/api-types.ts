import type { components } from "@dungeon-master/api-client";

/**
 * Os tipos do contrato que a web usa, apelidados uma vez só.
 *
 * Este arquivo é uma fronteira, como `lib/glossary.ts`, e pelo mesmo motivo:
 * alguns nomes canônicos do contrato são, letra por letra, labels do glossário
 * `plain` — `Loadout` e `Harness` são os dois casos. A varredura de
 * `labels.test.ts` não consegue distinguir `components["schemas"]["Loadout"]`,
 * que é uma chave de tipo e nunca chega à tela, de um `<span>Loadout</span>`,
 * que é o que a regra da seção 2 do CLAUDE.md proíbe. Concentrar os apelidos
 * aqui mantém a varredura estrita no resto de `src`, em vez de afrouxá-la para
 * o app inteiro.
 *
 * O sufixo dos apelidos não é decoração: `AgentRecord` é o registro que a API
 * devolve, e o nome diferente evita que alguém escreva o label sem perceber.
 */

export type AgentRecord = components["schemas"]["Agent"];
export type AgentListRecord = components["schemas"]["AgentList"];
export type CreateAgentBody = components["schemas"]["CreateAgent"];
export type UpdateAgentBody = components["schemas"]["UpdateAgent"];

export type HarnessRecord = components["schemas"]["Harness"];
export type HarnessKeyRecord = components["schemas"]["HarnessKey"];

export type ModelRecord = components["schemas"]["Model"];
export type CreateModelBody = components["schemas"]["CreateModel"];
export type UpdateModelBody = components["schemas"]["UpdateModel"];

export type ExecutionProfileRecord = components["schemas"]["ExecutionProfile"];
export type UpdateExecutionProfileBody = components["schemas"]["UpdateExecutionProfile"];

export type LoadoutRecord = components["schemas"]["Loadout"];
export type CreateLoadoutBody = components["schemas"]["CreateLoadout"];
export type UpdateLoadoutBody = components["schemas"]["UpdateLoadout"];
export type LoadoutSnapshotRecord = components["schemas"]["LoadoutSnapshot"];
export type ExecutionProfileSnapshotRecord = components["schemas"]["ExecutionProfileSnapshot"];
export type McpServerRecord = components["schemas"]["McpServerRef"];

export type RunRecord = components["schemas"]["Run"];
export type RunListItemRecord = components["schemas"]["RunListItem"];
export type RunPageRecord = components["schemas"]["RunPage"];
export type RunEventRecord = components["schemas"]["RunEvent"];
export type RunEventListRecord = components["schemas"]["RunEventList"];
export type RunResultRecord = components["schemas"]["RunResult"];

export type TaskRecord = components["schemas"]["Task"];
export type TaskDetailRecord = components["schemas"]["TaskDetail"];
export type ProjectRecord = components["schemas"]["Project"];

export type WorkflowRecord = components["schemas"]["Workflow"];
export type WorkflowPageRecord = components["schemas"]["WorkflowPage"];
export type WorkflowDefinitionBody = components["schemas"]["WorkflowDefinition"];
export type WorkflowStepDefinitionRecord = components["schemas"]["WorkflowStepDefinition"];
export type WorkflowVersionRecord = components["schemas"]["WorkflowVersion"];
export type WorkflowVersionPageRecord = components["schemas"]["WorkflowVersionPage"];
export type WorkflowVersionDetailRecord = components["schemas"]["WorkflowVersionDetail"];

export type RunStepRecord = components["schemas"]["RunStep"];
export type RunStepListRecord = components["schemas"]["RunStepList"];
// O gerador acrescenta `| null` à união porque `RunStep.result` é anulável;
// o resultado em si, quando existe, é a união discriminada por `kind`.
export type RunStepResultRecord = NonNullable<components["schemas"]["RunStepResult"]>;

export type ApprovalGateRecord = components["schemas"]["ApprovalGate"];
export type ApprovalGateListRecord = components["schemas"]["ApprovalGateList"];
export type ApprovalGateListItemRecord = components["schemas"]["ApprovalGateListItem"];
export type ApprovalGatePageRecord = components["schemas"]["ApprovalGatePage"];
export type ResolveApprovalGateBody = components["schemas"]["ResolveApprovalGate"];
