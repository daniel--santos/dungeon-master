import { createApp } from "./app.js";
import { createSpecPorts } from "./ports.js";

/**
 * Gera o documento OpenAPI sem subir servidor e sem tocar o banco.
 *
 * As dependências são portas inertes porque a geração da spec só percorre as
 * rotas declaradas; nenhum handler é executado. Se algum dia um handler for
 * executado aqui, a porta lança e a falha aparece em vez de virar uma spec
 * silenciosamente errada.
 */
export function buildOpenApiDocument(): Record<string, unknown> {
  const app = createApp(createSpecPorts());

  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Dungeon Master API",
      version: "0.0.0",
      description:
        "Control Plane do Dungeon Master. Erros seguem a RFC 9457 " +
        "(`application/problem+json`). Todos os instantes são UTC.",
      license: { name: "MIT", url: "https://opensource.org/licenses/MIT" },
    },
    servers: [{ url: "http://127.0.0.1:3333", description: "Desenvolvimento local" }],
    tags: [
      { name: "system", description: "Saúde, versão e documentação." },
      { name: "events", description: "Stream SSE de eventos de dashboard." },
      { name: "settings", description: "Configurações do usuário local." },
      { name: "projects", description: "Projects: a unidade persistente de contexto." },
      { name: "tasks", description: "Tasks, subtarefas e dependências." },
      { name: "inbox", description: "Captura de intenção: as Tasks em INBOX." },
      {
        name: "execution",
        description: "Cadastros de execução: Harness, Model, Agent, ExecutionProfile e Loadout.",
      },
      {
        name: "registry",
        description:
          "Registros versionados da Fase 8A: Skill (com versões), Tool, servidor MCP e Provider.",
      },
      { name: "runs", description: "Runs: as tentativas concretas de realizar uma Task." },
      { name: "workflows", description: "Workflows: o processo de uma execução, como dados." },
      { name: "approvals", description: "ApprovalGates: as pausas humanas de um Run." },
      {
        name: "proposals",
        description: "ProposedTasks: o trabalho que os Runs encontraram e não fizeram.",
      },
      {
        name: "knowledge",
        description:
          "O Grimório: candidatos, itens de conhecimento com revisão humana, o resumo e as " +
          "decisões do Project, e os lotes do Distiller.",
      },
      {
        name: "achievements",
        description:
          "O catálogo versionado de Conquistas, a projeção de progresso e as forjadas em revisão.",
      },
    ],
  }) as unknown as Record<string, unknown>;
}
