import { describe, expect, it } from "vitest";

import {
  buildContainerEnv,
  buildDockerRunArgs,
  containerExists,
  containerNameFor,
  CONTAINER_PARENT_GIT_DIR,
  CONTAINER_WORKSPACE_DIR,
  dockerPreflight,
  parseGitdirPath,
  removeContainer,
  resolveWorkspaceMounts,
  toDockerHostPath,
  type DockerCli,
} from "./docker.js";

/**
 * Um cliente Docker falso: guarda o argv de cada chamada e responde por roteiro.
 *
 * A suíte inteira roda no CI sem Docker instalado, que é o ponto. O que estes
 * testes protegem não é o daemon — é o **argv**, e o argv é onde moram os erros
 * caros deste backend: um segredo que vaza para a linha de comando, um mount que
 * não é read-only, um `--network` que não chega.
 */
function fakeDocker(
  responder: (args: readonly string[]) => { code: number | null; stdout?: string; stderr?: string },
): DockerCli & {
  readonly calls: readonly (readonly string[])[];
  readonly envs: readonly (Readonly<Record<string, string>> | undefined)[];
} {
  const calls: (readonly string[])[] = [];
  const envs: (Readonly<Record<string, string>> | undefined)[] = [];
  const cli = (args: readonly string[], options?: { env?: Readonly<Record<string, string>> }) => {
    calls.push(args);
    envs.push(options?.env);
    const r = responder(args);
    return Promise.resolve({ code: r.code, stdout: r.stdout ?? "", stderr: r.stderr ?? "" });
  };
  return Object.assign(cli as DockerCli, { calls, envs });
}

describe("buildDockerRunArgs", () => {
  const base = {
    image: "dungeon-master-agent:0.1.0",
    containerName: "dm-run-abc",
    workdir: CONTAINER_WORKSPACE_DIR,
    user: "1000:1000",
    mounts: [],
    envKeys: [],
  };

  it("monta um container descartável com nome, usuário e workdir", () => {
    const args = buildDockerRunArgs(base, ["claude", "--print"]);

    expect(args.slice(0, 6)).toEqual(["run", "--rm", "--name", "dm-run-abc", "-i", "--user"]);
    expect(args).toContain("-w");
    expect(args.at(-2)).toBe("claude");
    expect(args.at(-1)).toBe("--print");
    // A imagem vem imediatamente antes do comando do agente: tudo que estiver
    // depois dela é argumento da CLI, não do Docker.
    expect(args[args.indexOf("claude") - 1]).toBe("dungeon-master-agent:0.1.0");
  });

  it("NUNCA põe o valor de uma variável no argv", () => {
    // É a regra de segurança deste arquivo. O argv de um processo é legível por
    // qualquer processo da máquina; um `-e CLAUDE_CODE_OAUTH_TOKEN=sk-ant-…`
    // deixaria o segredo do Run à mostra na tabela de processos do host durante
    // toda a execução. `-e NOME` sem `=` manda o Docker copiar o valor do
    // ambiente do **cliente**, e é a única forma que não vaza.
    const args = buildDockerRunArgs(
      { ...base, envKeys: ["CLAUDE_CODE_OAUTH_TOKEN", "GEMINI_API_KEY"] },
      ["claude"],
    );

    expect(args).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(args).toContain("GEMINI_API_KEY");
    for (const arg of args) {
      expect(arg).not.toContain("=");
    }
  });

  it("ordena as variáveis e não repete uma chave duplicada", () => {
    const args = buildDockerRunArgs({ ...base, envKeys: ["B_VAR", "A_VAR", "B_VAR"] }, ["pi"]);
    const nomes = args.filter((_, i) => args[i - 1] === "-e");

    expect(nomes).toEqual(["A_VAR", "B_VAR"]);
  });

  // `fixedEnv` nasceu no gate do Antigravity (ADR 0002): a CLI precisa de
  // `AGY_ADC_AUTH=1`, que é um interruptor, e de `GOOGLE_APPLICATION_CREDENTIALS`
  // apontando para o **caminho de montagem dentro do container** — um valor que
  // o ambiente do worker não tem e não poderia ter, porque no host ele seria um
  // caminho do Windows.
  it("escreve o valor de uma variável fixa, que é configuração e não segredo", () => {
    const args = buildDockerRunArgs(
      {
        ...base,
        envKeys: ["CLAUDE_CODE_OAUTH_TOKEN"],
        fixedEnv: {
          GOOGLE_APPLICATION_CREDENTIALS: "/home/agent/.config/gcloud/adc.json",
          AGY_ADC_AUTH: "1",
        },
      },
      ["agy"],
    );
    const nomes = args.filter((_, i) => args[i - 1] === "-e");

    // O segredo continua sem valor no argv; só as fixas levam `=`.
    expect(nomes).toEqual([
      "CLAUDE_CODE_OAUTH_TOKEN",
      "AGY_ADC_AUTH=1",
      "GOOGLE_APPLICATION_CREDENTIALS=/home/agent/.config/gcloud/adc.json",
    ]);
  });

  it("recusa o mesmo nome em envKeys e em fixedEnv", () => {
    // Sem isto o último `-e` do argv venceria, e um valor de configuração
    // sobrescreveria a credencial do Run em silêncio.
    expect(() =>
      buildDockerRunArgs({ ...base, envKeys: ["X_TOKEN"], fixedEnv: { X_TOKEN: "1" } }, ["agy"]),
    ).toThrow(/X_TOKEN/);
  });

  it("traduz mounts, com `:ro` só onde foi pedido", () => {
    const args = buildDockerRunArgs(
      {
        ...base,
        mounts: [
          { hostPath: "D:\\Dev\\repo\\.dm-worktrees\\r1", containerPath: CONTAINER_WORKSPACE_DIR },
          {
            hostPath: "C:\\Users\\ana\\.claude\\.credentials.json",
            containerPath: "/home/agent/.claude/.credentials.json",
            readOnly: true,
          },
        ],
      },
      ["claude"],
    );

    expect(args).toContain("D:/Dev/repo/.dm-worktrees/r1:/home/agent/workspace");
    expect(args).toContain(
      "C:/Users/ana/.claude/.credentials.json:/home/agent/.claude/.credentials.json:ro",
    );
  });

  it("aplica rede e limites de recurso quando existem", () => {
    const args = buildDockerRunArgs(
      { ...base, network: "none", limits: { cpus: 2, memory: "2g", pidsLimit: 256 } },
      ["claude"],
    );

    expect(args).toContain("--network");
    expect(args[args.indexOf("--network") + 1]).toBe("none");
    expect(args[args.indexOf("--cpus") + 1]).toBe("2");
    expect(args[args.indexOf("--memory") + 1]).toBe("2g");
    expect(args[args.indexOf("--pids-limit") + 1]).toBe("256");
  });

  it("omite os limites que o perfil não trouxe", () => {
    const args = buildDockerRunArgs({ ...base, limits: {} }, ["claude"]);

    expect(args).not.toContain("--cpus");
    expect(args).not.toContain("--memory");
    expect(args).not.toContain("--pids-limit");
  });
});

describe("toDockerHostPath", () => {
  it("troca a barra invertida sem mexer na letra de unidade", () => {
    // `/d/Dev` e `//d/Dev` são reescritas de shell MSYS; o cliente Docker no
    // Windows quer a letra de unidade, e o argv nunca passa por shell.
    expect(toDockerHostPath("D:\\Dev\\Claude\\repo")).toBe("D:/Dev/Claude/repo");
    expect(toDockerHostPath("/home/ana/repo")).toBe("/home/ana/repo");
  });
});

describe("containerNameFor", () => {
  it("deriva do runId e sobrevive a caractere estranho", () => {
    expect(containerNameFor("0199-abc")).toBe("dm-run-0199-abc");
    expect(containerNameFor("a/b c:d")).toBe("dm-run-a-b-c-d");
  });
});

describe("parseGitdirPath", () => {
  it("quebra o caminho de um worktree nos dois separadores", () => {
    expect(parseGitdirPath("C:\\Users\\ana\\repo\\.git\\worktrees\\run-1")).toEqual({
      parentGitDir: "C:/Users/ana/repo/.git",
      worktreeName: "run-1",
    });
    expect(parseGitdirPath("/home/ana/repo/.git/worktrees/run-1")).toEqual({
      parentGitDir: "/home/ana/repo/.git",
      worktreeName: "run-1",
    });
  });

  it("devolve undefined em caminho que não é de worktree", () => {
    // A entrada vem de um arquivo no disco do usuário; um `.git` estranho vira
    // aviso, e não exceção que derruba o Run.
    expect(parseGitdirPath("/home/ana/repo/.git")).toBeUndefined();
    expect(parseGitdirPath("")).toBeUndefined();
  });
});

describe("resolveWorkspaceMounts", () => {
  const deps = (over: Partial<Parameters<typeof resolveWorkspaceMounts>[0]["deps"]> = {}) => ({
    statPath: () => Promise.resolve("directory" as const),
    readTextFile: () => Promise.resolve(""),
    writeOverride: () => Promise.resolve({ dir: "/tmp/dm-x", file: "/tmp/dm-x/git-override" }),
    ...over,
  });

  it("um clone comum precisa de um mount só", async () => {
    const r = await resolveWorkspaceMounts({ checkoutPath: "/repo", deps: deps() });

    expect(r.mounts).toEqual([{ hostPath: "/repo", containerPath: CONTAINER_WORKSPACE_DIR }]);
    expect(r.warning).toBeUndefined();
  });

  it("um worktree ganha o .git do pai e o arquivo .git corrigido", async () => {
    const r = await resolveWorkspaceMounts({
      checkoutPath: "D:\\Dev\\repo.dm-worktrees\\run-1",
      deps: deps({
        statPath: () => Promise.resolve("file" as const),
        readTextFile: () => Promise.resolve("gitdir: D:\\Dev\\repo\\.git\\worktrees\\run-1\n"),
      }),
    });

    expect(r.mounts).toHaveLength(3);
    // O `.git` do pai é read-write: é para lá que o `git commit` de dentro do
    // container escreve os objetos, e é o que faz o commit aparecer no host.
    expect(r.mounts[1]).toEqual({
      hostPath: "D:/Dev/repo/.git",
      containerPath: CONTAINER_PARENT_GIT_DIR,
    });
    expect(r.mounts[2]).toEqual({
      hostPath: "/tmp/dm-x/git-override",
      containerPath: `${CONTAINER_WORKSPACE_DIR}/.git`,
      readOnly: true,
    });
    expect(r.tempDir).toBe("/tmp/dm-x");
  });

  it("o .git de sobreposição aponta para um caminho POSIX do container", async () => {
    let escrito = "";
    await resolveWorkspaceMounts({
      checkoutPath: "D:\\Dev\\wt\\run-1",
      deps: deps({
        statPath: () => Promise.resolve("file" as const),
        readTextFile: () => Promise.resolve("gitdir: D:\\Dev\\repo\\.git\\worktrees\\run-1"),
        writeOverride: (content: string) => {
          escrito = content;
          return Promise.resolve({ dir: "/tmp/d", file: "/tmp/d/git-override" });
        },
      }),
    });

    // O caminho do host não pode sobrar aqui: o git do Linux trata
    // `gitdir: D:\...` como relativo e não resolve.
    expect(escrito).toBe(`gitdir: ${CONTAINER_PARENT_GIT_DIR}/worktrees/run-1\n`);
    expect(escrito).not.toMatch(/D:/);
  });

  it("um .git ilegível vira aviso, e o Run continua", async () => {
    const r = await resolveWorkspaceMounts({
      checkoutPath: "/repo",
      deps: deps({
        statPath: () => Promise.resolve("file" as const),
        readTextFile: () => Promise.reject(new Error("EACCES")),
      }),
    });

    expect(r.mounts).toHaveLength(1);
    expect(r.warning).toMatch(/EACCES/);
  });

  it("um .git sem a linha gitdir vira aviso", async () => {
    const r = await resolveWorkspaceMounts({
      checkoutPath: "/repo",
      deps: deps({
        statPath: () => Promise.resolve("file" as const),
        readTextFile: () => Promise.resolve("lixo"),
      }),
    });

    expect(r.mounts).toHaveLength(1);
    expect(r.warning).toMatch(/gitdir/);
  });

  it("um diretório sem .git é montado assim mesmo", async () => {
    const r = await resolveWorkspaceMounts({
      checkoutPath: "/qualquer",
      deps: deps({ statPath: () => Promise.resolve("missing" as const) }),
    });

    expect(r.mounts).toHaveLength(1);
    expect(r.warning).toBeUndefined();
  });
});

describe("buildContainerEnv", () => {
  it("corta o piso do SO e os caminhos que só existem no host", () => {
    // Repassar o `PATH` do Windows e `HOME=C:\Users\…` quebraria o container em
    // vez de configurá-lo.
    const env = buildContainerEnv({
      PATH: "C:\\Windows\\System32",
      HOME: "C:\\Users\\ana",
      USERPROFILE: "C:\\Users\\ana",
      APPDATA: "C:\\Users\\ana\\AppData",
      CLAUDE_CONFIG_DIR: "C:\\Users\\ana\\.claude",
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-x",
    });

    expect(env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-x" });
  });

  it("corta as GIT_CONFIG_* do host, que apontam para arquivos que não existem lá", () => {
    // `AGENT_GIT_ENV_KEYS` entra na allow-list de todo harness para que o agente
    // ache a identidade do git no **host**. Dentro do container, o mesmo valor
    // faz o git ler um caminho do Windows em vez do `/home/agent/.gitconfig` da
    // imagem: some a identidade e `git commit` falha com "Author identity
    // unknown" — a mesma falha que `AGENT_GIT_ENV_KEYS` corrigiu no host.
    const env = buildContainerEnv({
      GIT_CONFIG_GLOBAL: "C:\\Users\\ana\\.gitconfig",
      GIT_CONFIG_SYSTEM: "C:\\Program Files\\Git\\etc\\gitconfig",
      GIT_EXEC_PATH: "C:\\Program Files\\Git\\mingw64\\libexec\\git-core",
      GIT_TEMPLATE_DIR: "C:\\Program Files\\Git\\share\\git-core\\templates",
      GIT_AUTHOR_NAME: "Dungeon Master",
    });

    // O nome do autor é valor, e não caminho: ele atravessa.
    expect(env).toEqual({ GIT_AUTHOR_NAME: "Dungeon Master" });
  });

  it("deixa passar a variável que a política do perfil declarou", () => {
    // `buildContainerEnv` recebe o ambiente **inteiro** que o runtime montou por
    // allow-list, e não só as chaves de credencial do adapter: é assim que uma
    // variável pedida na `environmentPolicy` chega ao container. Filtrar de novo
    // aqui faria o mesmo Run enxergar `MY_VAR` em Campo aberto e não em Masmorra
    // selada, sem nada no diário explicando a diferença.
    const env = buildContainerEnv({
      PATH: "/usr/bin",
      MY_VAR: "declarada-no-perfil",
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-x",
    });

    expect(env).toEqual({
      MY_VAR: "declarada-no-perfil",
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-x",
    });
  });

  it("corta o piso dos dois sistemas, e não só o desta máquina", () => {
    // Senão o teste passaria no Windows e falharia no macOS, que é exatamente o
    // tipo de divergência que a matriz de CI existe para pegar.
    const env = buildContainerEnv({ SHELL: "/bin/zsh", LOGNAME: "ana", GEMINI_API_KEY: "k" });

    expect(env).toEqual({ GEMINI_API_KEY: "k" });
  });
});

describe("dockerPreflight", () => {
  it("daemon fora do ar é fatal e diz o que fazer", async () => {
    const docker = fakeDocker(() => ({ code: 1, stderr: "cannot connect to the daemon" }));

    const r = await dockerPreflight({ docker, image: "img:1" });

    expect(r.daemonReachable).toBe(false);
    expect(r.problems[0]?.fatal).toBe(true);
    expect(r.problems[0]?.message).toMatch(/Docker Desktop/);
  });

  it("imagem ausente é fatal e nomeia o comando que a constrói", async () => {
    const docker = fakeDocker((args) =>
      args[0] === "version"
        ? { code: 0, stdout: "29.7.2\n" }
        : { code: 1, stderr: "No such image" },
    );

    const r = await dockerPreflight({ docker, image: "img:1" });

    expect(r.daemonReachable).toBe(true);
    expect(r.serverVersion).toBe("29.7.2");
    expect(r.imagePresent).toBe(false);
    expect(r.problems[0]?.message).toMatch(/pnpm docker:build/);
  });

  it("imagem construída para outro UID avisa sem impedir", async () => {
    // No Linux o agente nem conseguiria escrever no bind mount; avisar é o que
    // transforma "o Run não commitou nada" em algo diagnosticável.
    const docker = fakeDocker((args) =>
      args[0] === "version" ? { code: 0, stdout: "29.7.2" } : { code: 0, stdout: "1000:1000\n" },
    );

    const r = await dockerPreflight({ docker, image: "img:1", expectedUid: 501 });

    expect(r.imagePresent).toBe(true);
    expect(r.imageUser).toBe("1000:1000");
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]?.fatal).toBe(false);
    expect(r.problems[0]?.message).toMatch(/UID 1000.*UID 501/s);
  });

  it("UID compatível não gera problema nenhum", async () => {
    const docker = fakeDocker((args) =>
      args[0] === "version" ? { code: 0, stdout: "29.7.2" } : { code: 0, stdout: "501:20" },
    );

    const r = await dockerPreflight({ docker, image: "img:1", expectedUid: 501 });

    expect(r.problems).toEqual([]);
  });
});

describe("removeContainer", () => {
  it("confirma o desaparecimento antes de dizer que terminou", async () => {
    // A promessa da seção 13 do documento técnico: o término é confirmado, nunca
    // presumido. O Sandcastle engole o erro de remoção e nunca confere.
    let restantes = 2;
    const docker = fakeDocker((args) => {
      if (args[0] === "rm") return { code: 0 };
      restantes -= 1;
      return { code: 0, stdout: restantes > 0 ? "dm-run-1\n" : "" };
    });

    const r = await removeContainer({
      docker,
      containerName: "dm-run-1",
      sleep: () => Promise.resolve(),
    });

    expect(r.terminated).toBe(true);
    expect(r.method).toBe("docker-rm");
    expect(docker.calls[0]).toEqual(["rm", "--force", "--volumes", "dm-run-1"]);
  });

  it("container que já sumiu é sucesso, com notRunning", async () => {
    const docker = fakeDocker(() => ({ code: 1, stderr: "Error: No such container: dm-run-1" }));

    const r = await removeContainer({ docker, containerName: "dm-run-1" });

    expect(r).toMatchObject({ terminated: true, notRunning: true });
  });

  it("não promete término quando o container insiste em existir", async () => {
    const docker = fakeDocker((args) =>
      args[0] === "rm" ? { code: 0 } : { code: 0, stdout: "dm-run-1\n" },
    );
    let agora = 0;

    const r = await removeContainer({
      docker,
      containerName: "dm-run-1",
      confirmMs: 50,
      now: () => (agora += 30),
      sleep: () => Promise.resolve(),
    });

    expect(r.terminated).toBe(false);
  });
});

describe("containerExists", () => {
  it("não conseguir perguntar não é prova de ausência", async () => {
    // Dizer `false` aqui levaria a um `terminated: true` sem prova, que é
    // exatamente a mentira que a máquina de estados não pode contar.
    const docker = fakeDocker(() => ({ code: 1, stderr: "daemon caiu" }));

    await expect(containerExists(docker, "dm-run-1")).resolves.toBe(true);
  });

  it("casa o nome exato, e não um prefixo", async () => {
    const docker = fakeDocker(() => ({ code: 0, stdout: "dm-run-10\ndm-run-1\n" }));

    await expect(containerExists(docker, "dm-run-1")).resolves.toBe(true);
    await expect(containerExists(docker, "dm-run-2")).resolves.toBe(false);
  });
});
