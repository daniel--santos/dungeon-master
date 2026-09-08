import { DockerPreflightSchema } from "@dungeon-master/contracts";
import type {
  DockerCli,
  HarnessAdapter,
  HarnessCapabilities,
  HarnessContext,
  PreflightResult,
} from "@dungeon-master/runtime";
import { describe, expect, it } from "vitest";

import { createDockerPreflightPort } from "./docker-preflight.js";

/**
 * O preflight do Docker sem Docker: cliente falso e adapters falsos.
 *
 * O que está sob prova é a montagem do resultado — o que vira problema, o que
 * vira linha por harness, quando os harnesses nem são consultados — e o teto
 * de tempo, que é a única coisa que este módulo acrescenta às peças do Worker.
 */

const CAPABILITIES: HarnessCapabilities = {
  streaming: true,
  structuredOutput: true,
  resume: true,
  forkSession: false,
  multiTurnProcess: false,
  toolEvents: true,
  tokenUsage: true,
  modelSelection: true,
  agentSelection: false,
  nativePermissions: true,
  hostExecution: true,
  dockerExecution: true,
  mcpServers: true,
};

interface FakeAdapterOptions {
  readonly id: string;
  readonly key: HarnessAdapter["key"];
  readonly executionMode?: "HOST" | "DOCKER";
  readonly preflight: (context: HarnessContext) => Promise<PreflightResult>;
}

function adapter(options: FakeAdapterOptions): HarnessAdapter & { calls: HarnessContext[] } {
  const calls: HarnessContext[] = [];
  return {
    id: options.id,
    key: options.key,
    executionMode: options.executionMode ?? "DOCKER",
    capabilities: CAPABILITIES,
    calls,
    preflight: (context) => {
      calls.push(context);
      return options.preflight(context);
    },
    execute: () => {
      throw new Error("não usado neste teste");
    },
    cancel: () => {
      throw new Error("não usado neste teste");
    },
  };
}

/** Um cliente Docker que responde por comando. */
function docker(input: {
  readonly daemon?: boolean;
  readonly image?: boolean;
  readonly user?: string;
}): DockerCli & { calls: readonly (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const cli: DockerCli = (args) => {
    calls.push(args);
    if (args[0] === "version") {
      return Promise.resolve(
        input.daemon === false
          ? { code: 1, stdout: "", stderr: "error during connect: open //./pipe/dockerDesktop" }
          : { code: 0, stdout: "27.1.1\n", stderr: "" },
      );
    }
    if (args[0] === "image" && args[1] === "inspect") {
      return Promise.resolve(
        input.image === false
          ? { code: 1, stdout: "", stderr: "No such image" }
          : { code: 0, stdout: `${input.user ?? "1000:1000"}\n`, stderr: "" },
      );
    }
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  };
  return Object.assign(cli, { calls });
}

const NOW = new Date("2026-09-08T10:00:00.000Z");

describe("preflight do Docker", () => {
  it("sem daemon, devolve o problema e não consulta nenhum harness", async () => {
    const claude = adapter({
      id: "claude-code@docker",
      key: "CLAUDE_CODE",
      preflight: () => Promise.reject(new Error("não devia ser chamado")),
    });
    const port = createDockerPreflightPort({
      adapters: [claude],
      docker: docker({ daemon: false }),
      timeoutMs: 200,
      env: {},
      hostUid: 1000,
      now: () => NOW,
    });

    const result = DockerPreflightSchema.parse(await port.check());

    expect(result.checkedAt).toBe(NOW.toISOString());
    expect(result.timeoutMs).toBe(200);
    expect(result.daemon).toEqual({ reachable: false, serverVersion: null });
    expect(result.image.present).toBe(false);
    expect(result.problems.map((problem) => problem.code)).toEqual(["UNSUPPORTED_MODE"]);
    expect(result.problems[0]?.message).toContain("Docker Desktop");
    expect(result.harnesses).toEqual([
      {
        harnessKey: "CLAUDE_CODE",
        adapterId: "claude-code@docker",
        installed: false,
        version: null,
        authenticated: null,
        timedOut: false,
        problems: [],
      },
    ]);
    expect(claude.calls).toHaveLength(0);
  });

  it("sem a imagem, diz como construir e também não consulta os harnesses", async () => {
    const pi = adapter({
      id: "pi@docker",
      key: "PI",
      preflight: () => Promise.reject(new Error("não devia ser chamado")),
    });
    const port = createDockerPreflightPort({
      adapters: [pi],
      docker: docker({ image: false }),
      image: "dungeon-master-agent:9.9.9",
      env: {},
      hostUid: 1000,
    });

    const result = await port.check();

    expect(result.daemon).toEqual({ reachable: true, serverVersion: "27.1.1" });
    expect(result.image).toEqual({
      name: "dungeon-master-agent:9.9.9",
      present: false,
      user: null,
    });
    expect(result.problems[0]?.message).toContain("pnpm docker:build");
    expect(result.harnesses[0]?.installed).toBe(false);
    expect(pi.calls).toHaveLength(0);
  });

  it("com daemon e imagem, mede cada harness de container com o teto no contexto", async () => {
    const claude = adapter({
      id: "claude-code@docker",
      key: "CLAUDE_CODE",
      preflight: () =>
        Promise.resolve({
          installed: true,
          version: "claude 2.1.263",
          executablePath: "dungeon-master-agent:0.2.0:claude",
          authenticated: true,
          problems: [],
        }),
    });
    const pi = adapter({
      id: "pi@docker",
      key: "PI",
      preflight: () =>
        Promise.resolve({
          installed: true,
          authenticated: false,
          problems: [
            { code: "VERSION_UNREADABLE", message: "sem versão", fatal: false },
            { code: "NOT_AUTHENTICATED", message: "sem credencial", fatal: false },
          ],
        }),
    });
    const host = adapter({
      id: "claude-code@host",
      key: "CLAUDE_CODE",
      executionMode: "HOST",
      preflight: () => Promise.reject(new Error("host não entra no preflight do Docker")),
    });
    const port = createDockerPreflightPort({
      adapters: [host, claude, pi],
      docker: docker({ user: "1000:1000" }),
      timeoutMs: 300,
      env: { CLAUDE_CODE_OAUTH_TOKEN: "segredo" },
      hostUid: 1000,
    });

    const result = DockerPreflightSchema.parse(await port.check());

    expect(result.image).toEqual({
      name: "dungeon-master-agent:0.2.0",
      present: true,
      user: "1000:1000",
    });
    expect(result.problems).toEqual([]);
    expect(result.harnesses.map((item) => item.adapterId)).toEqual([
      "claude-code@docker",
      "pi@docker",
    ]);
    expect(result.harnesses[0]).toMatchObject({
      installed: true,
      version: "claude 2.1.263",
      authenticated: true,
      timedOut: false,
      problems: [],
    });
    expect(result.harnesses[1]).toMatchObject({
      installed: true,
      version: null,
      authenticated: false,
      timedOut: false,
    });
    expect(result.harnesses[1]?.problems.map((problem) => problem.code)).toEqual([
      "VERSION_UNREADABLE",
      "NOT_AUTHENTICATED",
    ]);
    expect(host.calls).toHaveLength(0);

    // O contexto leva o modo, o ambiente de onde a credencial sai e o teto.
    expect(claude.calls[0]).toMatchObject({
      mode: "DOCKER",
      timeoutMs: 300,
      env: { CLAUDE_CODE_OAUTH_TOKEN: "segredo" },
    });
  });

  it("um harness que não responde no teto sai como timedOut, sem segurar os outros", async () => {
    const lento = adapter({
      id: "pi@docker",
      key: "PI",
      preflight: () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({ installed: true, version: "tarde demais", problems: [] });
          }, 400);
        }),
    });
    const rapido = adapter({
      id: "claude-code@docker",
      key: "CLAUDE_CODE",
      preflight: () =>
        Promise.resolve({ installed: true, version: "claude 2.1.263", problems: [] }),
    });
    const port = createDockerPreflightPort({
      adapters: [lento, rapido],
      docker: docker({}),
      timeoutMs: 50,
      env: {},
      hostUid: 1000,
    });

    const result = await port.check();

    expect(result.harnesses[0]).toMatchObject({
      adapterId: "pi@docker",
      installed: false,
      version: null,
      timedOut: true,
      problems: [],
    });
    expect(result.harnesses[1]).toMatchObject({ adapterId: "claude-code@docker", installed: true });
    expect(result.durationMs).toBeLessThan(400);
  });

  it("um adapter que estoura vira uma linha com o erro, e não um 500", async () => {
    const quebrado = adapter({
      id: "claude-code@docker",
      key: "CLAUDE_CODE",
      preflight: () => Promise.reject(new Error("credencial ilegível")),
    });
    const port = createDockerPreflightPort({
      adapters: [quebrado],
      docker: docker({}),
      env: {},
      hostUid: 1000,
    });

    const result = await port.check();

    expect(result.harnesses[0]).toMatchObject({
      installed: false,
      timedOut: false,
      problems: [{ code: "UNSUPPORTED_MODE", message: "credencial ilegível", fatal: true }],
    });
  });

  it("aplica o teto a todo comando do cliente Docker", async () => {
    const tetos: (number | undefined)[] = [];
    const cli: DockerCli = (args, options) => {
      tetos.push(options?.timeoutMs);
      return Promise.resolve(
        args[0] === "version"
          ? { code: 0, stdout: "27.1.1", stderr: "" }
          : { code: 0, stdout: "1000:1000", stderr: "" },
      );
    };
    const port = createDockerPreflightPort({
      adapters: [],
      docker: cli,
      timeoutMs: 123,
      env: {},
      hostUid: 1000,
    });

    await port.check();

    expect(tetos).toEqual([123, 123]);
  });
});
