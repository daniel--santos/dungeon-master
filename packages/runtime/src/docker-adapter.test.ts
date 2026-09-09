import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NO_CAPABILITIES } from "./capabilities.js";
import type { DockerCli } from "./docker.js";
import type { HarnessEvent } from "./harness.js";
import {
  createDockerAdapter,
  defaultContainerUser,
  dockerNetworkFor,
  type DockerHarnessDefinition,
} from "./docker-adapter.js";

/** Cliente Docker falso: guarda todo argv e todo env extra que recebeu. */
function fakeDocker(
  responder: (args: readonly string[]) => { code: number | null; stdout?: string; stderr?: string },
) {
  const calls: (readonly string[])[] = [];
  const envs: (Readonly<Record<string, string>> | undefined)[] = [];
  const cli: DockerCli = (args, options) => {
    calls.push(args);
    envs.push(options?.env);
    const r = responder(args);
    return Promise.resolve({ code: r.code, stdout: r.stdout ?? "", stderr: r.stderr ?? "" });
  };
  return { cli, calls, envs };
}

const definicao: DockerHarnessDefinition = {
  id: "fake@docker",
  key: "PI",
  capabilities: NO_CAPABILITIES,
  binary: "pi",
  versionArgs: ["--version"],
  parseVersion: (stdout) => (stdout.trim() === "" ? undefined : stdout.trim()),
  buildArgs: () => ({ args: ["-p"], stdin: "prompt" }),
  parseLine: () => [],
  containerEnvKeys: ["GEMINI_API_KEY"],
  authCheck: {
    args: ["auth", "check", "--json"],
    interpret: ({ code }) => code === 0,
  },
};

/** Responde ao roteiro feliz: daemon no ar, imagem presente, versão e auth OK. */
function roteiroFeliz(args: readonly string[]) {
  if (args[0] === "version") return { code: 0, stdout: "29.7.2\n" };
  if (args[0] === "image") return { code: 0, stdout: "1000:1000\n" };
  if (args.includes("--version")) return { code: 0, stdout: "0.85.1\n" };
  return { code: 0, stdout: '{"status":"ready"}' };
}

describe("dockerNetworkFor", () => {
  it("só `NONE` desliga a rede", () => {
    expect(dockerNetworkFor({ access: "NONE", allowedHosts: [], enforced: true })).toBe("none");
    expect(dockerNetworkFor({ access: "ALL", allowedHosts: [], enforced: true })).toBe("bridge");
  });

  it("`ALLOWLIST` cai em bridge, porque o Docker não filtra por host", () => {
    // O rebaixamento é anunciado pelo `AgentRuntime` como `Diagnostic`, e
    // `enforced: false` é o que impede a interface de prometer o que não existe.
    expect(
      dockerNetworkFor({ access: "ALLOWLIST", allowedHosts: ["api.x"], enforced: false }),
    ).toBe("bridge");
  });

  it("sem política, a rede fica como o Docker a entrega", () => {
    expect(dockerNetworkFor(undefined)).toBe("bridge");
  });
});

describe("defaultContainerUser", () => {
  it("é `UID:GID` no POSIX e o contrato 1000:1000 no Windows", () => {
    // No Windows `process.getuid` não existe, e a imagem é construída para
    // 1000:1000 — o mesmo número que o `docker:build` deixa como padrão.
    const esperado =
      process.getuid === undefined
        ? "1000:1000"
        : `${String(process.getuid())}:${String(process.getgid?.())}`;

    expect(defaultContainerUser()).toBe(esperado);
  });
});

describe("createDockerAdapter", () => {
  it("declara o modo DOCKER, que é o que o registry usa para escolher", () => {
    const { cli } = fakeDocker(roteiroFeliz);
    const adapter = createDockerAdapter(definicao, { docker: cli });

    expect(adapter.executionMode).toBe("DOCKER");
    expect(adapter.key).toBe("PI");
  });

  it("o preflight pergunta daemon, imagem, versão e autenticação", async () => {
    const { cli, calls } = fakeDocker(roteiroFeliz);
    // `hostUid: 1000` casa com o UID que o roteiro feliz devolve para a imagem;
    // sem isso o teste dependeria do usuário da máquina (501 no runner do macOS).
    const adapter = createDockerAdapter(definicao, { docker: cli, image: "img:1", hostUid: 1000 });

    const r = await adapter.preflight({ mode: "DOCKER", env: { GEMINI_API_KEY: "k" } });

    expect(r.installed).toBe(true);
    expect(r.version).toBe("0.85.1");
    expect(r.authenticated).toBe(true);
    expect(r.problems).toEqual([]);
    expect(calls[0]).toEqual(["version", "--format", "{{.Server.Version}}"]);
    expect(calls[1]).toEqual(["image", "inspect", "img:1", "--format", "{{.Config.User}}"]);
    // A versão e a autenticação são medidas **dentro** da imagem: é a CLI que o
    // Run vai usar, e não a que por acaso está no PATH do host.
    expect(calls[2]).toContain("img:1");
    expect(calls[2]).toContain("--version");
  });

  it("o preflight avisa quando o UID do worker não é o da imagem", async () => {
    const { cli } = fakeDocker(roteiroFeliz);
    const adapter = createDockerAdapter(definicao, { docker: cli, image: "img:1", hostUid: 501 });

    const r = await adapter.preflight({ mode: "DOCKER", env: { GEMINI_API_KEY: "k" } });

    // Não é fatal: o Run ainda sobe, mas os arquivos sairiam com o dono errado.
    expect(r.installed).toBe(true);
    expect(r.problems.map((p) => p.code)).toEqual(["UNSUPPORTED_MODE"]);
    expect(r.problems[0]?.fatal).toBe(false);
    expect(r.problems[0]?.message).toContain("501");
  });

  it("o preflight também não põe segredo no argv", async () => {
    const { cli, calls, envs } = fakeDocker(roteiroFeliz);
    const adapter = createDockerAdapter(definicao, { docker: cli });

    await adapter.preflight({ mode: "DOCKER", env: { GEMINI_API_KEY: "segredo-do-usuario" } });

    const auth = calls.at(-1) ?? [];
    expect(auth).toContain("-e");
    expect(auth).toContain("GEMINI_API_KEY");
    expect(auth.join(" ")).not.toContain("segredo-do-usuario");
    // O valor viaja pelo ambiente do processo cliente do Docker.
    expect(envs.at(-1)).toEqual({ GEMINI_API_KEY: "segredo-do-usuario" });
  });

  it("sem daemon o preflight é fatal e não fica em cache", async () => {
    // Subir o Docker Desktop precisa valer no Run seguinte, sem reiniciar o
    // worker; um preflight negativo cacheado esconderia a correção do usuário.
    let tentativas = 0;
    const { cli } = fakeDocker((args) => {
      if (args[0] === "version") {
        tentativas += 1;
        return tentativas === 1 ? { code: 1, stderr: "daemon" } : { code: 0, stdout: "29.7.2" };
      }
      return roteiroFeliz(args);
    });
    const adapter = createDockerAdapter(definicao, { docker: cli });

    const primeiro = await adapter.preflight({ mode: "DOCKER" });
    expect(primeiro.installed).toBe(false);

    const segundo = await adapter.preflight({ mode: "DOCKER" });
    expect(segundo.installed).toBe(true);
  });

  it("versão ilegível é problema não fatal", async () => {
    const { cli } = fakeDocker((args) =>
      args.includes("--version") ? { code: 1, stdout: "" } : roteiroFeliz(args),
    );
    const adapter = createDockerAdapter(definicao, { docker: cli });

    const r = await adapter.preflight({ mode: "DOCKER" });

    expect(r.installed).toBe(true);
    expect(r.problems.map((p) => p.code)).toContain("VERSION_UNREADABLE");
    expect(r.problems.every((p) => !p.fatal)).toBe(true);
  });

  it("CLI sem credencial vira NOT_AUTHENTICATED antes de queimar o timeout", async () => {
    // Sem isso, uma CLI mal autenticada repete o 401 em laço até o teto de
    // ociosidade — o comportamento que o ADR 0001 registrou no Codex.
    const { cli } = fakeDocker((args) =>
      args.includes("auth") ? { code: 1, stdout: "not_ready" } : roteiroFeliz(args),
    );
    const adapter = createDockerAdapter(definicao, { docker: cli });

    const r = await adapter.preflight({ mode: "DOCKER" });

    expect(r.authenticated).toBe(false);
    expect(r.problems.map((p) => p.code)).toContain("NOT_AUTHENTICATED");
  });

  it("cancelar uma execução que nunca subiu ainda confirma que não há container", async () => {
    // Nenhum processo cliente vivo não quer dizer nenhum container vivo: o
    // `docker run` pode ter morrido sem levar o container junto.
    const { cli, calls } = fakeDocker((args) =>
      args[0] === "rm" ? { code: 1, stderr: "No such container: dm-run-x" } : { code: 0 },
    );
    const adapter = createDockerAdapter(definicao, { docker: cli });

    const r = await adapter.cancel("x");

    expect(r.terminated).toBe(true);
    expect(calls.some((c) => c[0] === "rm" && c.includes("dm-run-x"))).toBe(true);
  });

  it("o aviso do preparo do container sai mesmo quando o desfecho é o primeiro evento", async () => {
    // Um checkout cujo `.git` o runtime não reconheceu roda, mas `git status`
    // falha lá dentro e o agente não commita. Se a CLI morre logo — imagem sem
    // credencial, `docker run` recusado —, o único evento é o `HarnessFinished`,
    // e o Run terminaria "com sucesso aparente e espólio nenhum" sem a linha que
    // explica por quê.
    const checkout = await mkdtemp(join(tmpdir(), "dm-docker-adapter-"));
    await writeFile(join(checkout, ".git"), "isto não é a linha gitdir:\n");
    try {
      const { cli } = fakeDocker(roteiroFeliz);
      const adapter = createDockerAdapter(
        {
          ...definicao,
          // Recusar o argv derruba `buildCommand`, e o adapter de host devolve
          // o `HarnessFinished` de erro como primeiro e único evento.
          buildArgs: () => {
            throw new Error("argv recusado");
          },
        },
        { docker: cli },
      );

      const eventos: HarnessEvent[] = [];
      for await (const evento of adapter.execute({
        executionId: "aviso",
        cwd: checkout,
        prompt: "irrelevante",
        env: {},
        permission: { mode: "DEFAULT", enforcement: "ADVISORY" },
      })) {
        eventos.push(evento);
        // O `break` é o que o `runAttempt` faz ao ver o desfecho; sem ele o
        // teste consumiria o gerador até o fim e não veria o defeito.
        if (evento.type === "HarnessFinished") break;
      }

      const aviso = eventos.find((evento) => evento.type === "Diagnostic");
      expect(aviso, "o aviso do preparo do container sumiu").toBeDefined();
      if (aviso?.type === "Diagnostic") {
        expect(aviso.code).toBe("DOCKER_CONTAINER_PREPARATION");
        expect(aviso.message).toContain("gitdir");
      }
      expect(eventos.at(-1)?.type).toBe("HarnessFinished");
    } finally {
      await rm(checkout, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("o teto de confirmação do pedido ganha do padrão do adapter", async () => {
    // O container que não some é o caso em que o número importa: com o padrão
    // de 10 s, um Run que pediu 30 ms esperaria dez segundos para descobrir o
    // mesmo `terminated: false`.
    const { cli, calls } = fakeDocker((args) =>
      args[0] === "ps" ? { code: 0, stdout: "dm-run-x\n" } : { code: 0 },
    );
    const adapter = createDockerAdapter(definicao, { docker: cli });

    const r = await adapter.cancel("x", { confirmMs: 30 });

    expect(r.terminated).toBe(false);
    // Duas perguntas: a primeira dentro do teto, a segunda já fora dele. Com os
    // 10 s do padrão seriam cinquenta.
    expect(calls.filter((c) => c[0] === "ps")).toHaveLength(2);
  });
});
