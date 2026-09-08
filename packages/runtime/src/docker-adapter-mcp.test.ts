import { describe, expect, it } from "vitest";

import { NO_CAPABILITIES } from "./capabilities.js";
import { buildDockerRunArgs, type DockerCli } from "./docker.js";
import {
  buildDockerRunCommand,
  createDockerAdapter,
  prepareContainerMcp,
  type DockerHarnessDefinition,
} from "./docker-adapter.js";
import type { HarnessExecutionRequest } from "./harness.js";
import type { McpServerSpec } from "./mcp.js";

/**
 * Os servidores MCP dentro do container.
 *
 * O que estes testes protegem é o argv do `docker run`: o arquivo do servidor
 * montado read-only, `-e DATABASE_URL` **sem** valor, o `--add-host` que faz o
 * container alcançar o PostgreSQL do host, e o comando reescrito para o de
 * dentro da imagem. O valor reescrito da URL do banco viaja pelo ambiente do
 * cliente Docker, como qualquer segredo (ADR 0001).
 */

function fakeDocker(
  responder: (args: readonly string[]) => { code: number | null; stdout?: string; stderr?: string },
) {
  const cli: DockerCli = (args) => {
    const r = responder(args);
    return Promise.resolve({ code: r.code, stdout: r.stdout ?? "", stderr: r.stderr ?? "" });
  };
  return { cli };
}

function roteiroFeliz(args: readonly string[]) {
  if (args[0] === "version") return { code: 0, stdout: "29.7.2\n" };
  if (args[0] === "image") return { code: 0, stdout: "1000:1000\n" };
  if (args.includes("--version")) return { code: 0, stdout: "2.1.263\n" };
  // O `docker run` do Run: o cliente falso "sai" com 0 sem stdout, e o adapter
  // encerra o stream com `HarnessFinished`.
  return { code: 0, stdout: "" };
}

const knowledge: McpServerSpec = {
  name: "knowledge",
  transport: "STDIO",
  command: "C:\\node\\node.exe",
  args: ["C:\\dm\\knowledge-mcp.mjs", "--project", "p1", "--user", "u1"],
  envKeys: ["DATABASE_URL"],
  container: {
    command: "node",
    args: ["/opt/dm/knowledge-mcp.mjs", "--project", "p1", "--user", "u1"],
    mounts: [{ hostPath: "C:\\dm\\knowledge-mcp.mjs", containerPath: "/opt/dm/knowledge-mcp.mjs" }],
    env: { DATABASE_URL: "postgresql://u:senha-do-banco@host.docker.internal:5433/dm" },
  },
};

const doLoadout: McpServerSpec = {
  name: "filesystem",
  transport: "STDIO",
  command: "npx",
  args: ["-y", "servidor"],
};

describe("prepareContainerMcp", () => {
  it("monta o arquivo read-only, reescreve o ambiente e pede o host", () => {
    const r = prepareContainerMcp([knowledge, doLoadout]);

    expect(r.mounts).toEqual([
      {
        hostPath: "C:\\dm\\knowledge-mcp.mjs",
        containerPath: "/opt/dm/knowledge-mcp.mjs",
        readOnly: true,
      },
    ]);
    expect(r.env).toEqual({
      DATABASE_URL: "postgresql://u:senha-do-banco@host.docker.internal:5433/dm",
    });
    expect(r.reachHost).toBe(true);
    expect(r.servers?.map((s) => (s.transport === "STDIO" ? s.command : s.url))).toEqual([
      "node",
      "npx",
    ]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("filesystem");
  });

  it("sem servidores, nada é montado e o host não é ligado", () => {
    expect(prepareContainerMcp(undefined)).toEqual({
      servers: undefined,
      mounts: [],
      env: {},
      reachHost: false,
      warnings: [],
    });
  });
});

describe("buildDockerRunArgs com --add-host", () => {
  const base = {
    image: "img:1",
    containerName: "dm-run-x",
    workdir: "/w",
    mounts: [],
    envKeys: [],
  };

  it("liga o host quando um servidor de dentro precisa alcançá-lo", () => {
    const args = buildDockerRunArgs(
      { ...base, extraHosts: ["host.docker.internal:host-gateway"] },
      ["claude"],
    );
    expect(args[args.indexOf("--add-host") + 1]).toBe("host.docker.internal:host-gateway");
  });

  it("sem extraHosts não há --add-host", () => {
    expect(buildDockerRunArgs(base, ["claude"])).not.toContain("--add-host");
  });
});

describe("buildDockerRunCommand com servidores MCP", () => {
  const request: HarnessExecutionRequest = {
    executionId: "run-mcp",
    cwd: "D:\\repo",
    prompt: "oi",
    env: {
      DATABASE_URL: "postgresql://u:senha-do-banco@127.0.0.1:5433/dm",
      CLAUDE_CODE_OAUTH_TOKEN: "token",
    },
    permission: { mode: "DEFAULT", enforcement: "SANDBOX_ENFORCED" },
    mcpServers: [knowledge, doLoadout],
  };

  function definicaoQueGuarda(guardar: (request: HarnessExecutionRequest) => void) {
    const definicao: DockerHarnessDefinition = {
      id: "fake@docker",
      key: "CLAUDE_CODE",
      capabilities: { ...NO_CAPABILITIES, mcpServers: true },
      binary: "claude",
      versionArgs: ["--version"],
      parseVersion: (stdout) => stdout.trim(),
      buildArgs: (r) => {
        guardar(r);
        return { args: ["--print"], stdin: "prompt" };
      },
      parseLine: () => [],
      containerEnvKeys: ["CLAUDE_CODE_OAUTH_TOKEN"],
    };
    return definicao;
  }

  it("o docker run leva o mount, o `-e DATABASE_URL` sem valor, o add-host e o comando de dentro", () => {
    let recebido: HarnessExecutionRequest | undefined;

    const { command, warnings } = buildDockerRunCommand({
      definition: definicaoQueGuarda((r) => {
        recebido = r;
      }),
      request,
      image: "img:1",
      containerName: "dm-run-run-mcp",
      workspaceDir: "/home/agent/workspace",
      user: "1000:1000",
      workspaceMounts: [{ hostPath: "D:\\repo", containerPath: "/home/agent/workspace" }],
    });

    const argv = command.args;
    expect(command.command).toBe("docker");
    expect(argv[argv.indexOf("--add-host") + 1]).toBe("host.docker.internal:host-gateway");
    expect(argv).toContain("C:/dm/knowledge-mcp.mjs:/opt/dm/knowledge-mcp.mjs:ro");
    expect(argv).toContain("DATABASE_URL");
    // O valor reescrito viaja pelo ambiente do cliente, nunca pelo argv.
    expect(argv.join(" ")).not.toContain("senha-do-banco");
    expect(command.env?.["DATABASE_URL"]).toBe(
      "postgresql://u:senha-do-banco@host.docker.internal:5433/dm",
    );
    // A imagem continua imediatamente antes do comando do agente.
    expect(argv[argv.indexOf("claude") - 1]).toBe("img:1");

    // O `buildArgs` da definição recebeu a lista já reescrita para o container.
    expect(recebido?.mcpServers?.[0]).toMatchObject({ name: "knowledge", command: "node" });
    expect(recebido?.mcpServers?.[1]).toMatchObject({ name: "filesystem", command: "npx" });

    // E o servidor do Loadout sem comando de container vira aviso.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("filesystem");
  });

  it("sem servidores, nem add-host nem mount extra", () => {
    const { command, warnings } = buildDockerRunCommand({
      definition: definicaoQueGuarda(() => undefined),
      request: { ...request, mcpServers: undefined },
      image: "img:1",
      containerName: "dm-run-x",
      workspaceDir: "/home/agent/workspace",
      user: "1000:1000",
      workspaceMounts: [],
    });

    expect(command.args).not.toContain("--add-host");
    expect(command.args.some((arg) => arg.includes("knowledge-mcp"))).toBe(false);
    expect(command.env?.["DATABASE_URL"]).toBe("postgresql://u:senha-do-banco@127.0.0.1:5433/dm");
    expect(warnings).toEqual([]);
  });

  it("o adapter completo continua declarando o modo DOCKER", () => {
    const { cli } = fakeDocker(roteiroFeliz);
    const adapter = createDockerAdapter(
      definicaoQueGuarda(() => undefined),
      { docker: cli },
    );
    expect(adapter.executionMode).toBe("DOCKER");
    expect(adapter.capabilities.mcpServers).toBe(true);
  });
});
