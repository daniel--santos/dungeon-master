import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { buildEnv, essentialEnvKeys, spawnDetached } from "./spawn.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = resolve(PACKAGE_ROOT, "test", "fixtures");
const ECHO_ARGV = resolve(FIXTURES, "echo-argv.mjs");

interface EchoedProcess {
  argv: string[];
  env: Record<string, string>;
  cwd: string;
}

/** Roda `echo-argv.mjs` com os argumentos e o ambiente dados e lê o JSON de volta. */
async function echo(args: readonly string[], env: Record<string, string>): Promise<EchoedProcess> {
  const { child } = spawnDetached(process.execPath, [ECHO_ARGV, ...args], {
    cwd: PACKAGE_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));

  const [code] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
  if (code !== 0) throw new Error(`echo-argv saiu com ${String(code)}: ${stderr}`);
  return JSON.parse(stdout) as EchoedProcess;
}

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
});

describe("spawnDetached", () => {
  it("entrega ao filho, intactos, argumentos com espaço e metacaracteres de shell", async () => {
    // Cada um destes vira outra coisa se em algum ponto do caminho existir um
    // shell: expansão, redirecionamento, encadeamento ou substituição de
    // comando. Chegando idênticos, está provado que não existe shell nenhum.
    const args = [
      "com espaço",
      'aspas "duplas"',
      "aspas 'simples'",
      "a & b",
      "a | b",
      "a ; b",
      "a && b",
      "$(echo injetado)",
      "`echo injetado`",
      "${HOME}",
      "%PATH%",
      "> saida.txt",
      "*",
      "?",
      "^ & | < >",
      "!histórico!",
      "novalinha\nde verdade",
      "tabulação\there",
      "barra\\invertida",
      "termina em barra\\",
      "acentuação e emoji 🐉",
      "",
    ];

    const result = await echo(args, buildEnv(essentialEnvKeys()));
    expect(result.argv).toEqual(args);
  }, 30_000);

  it("roda o filho no cwd pedido", async () => {
    const result = await echo(["x"], buildEnv(essentialEnvKeys()));
    expect(resolve(result.cwd)).toBe(PACKAGE_ROOT);
  }, 30_000);

  it("não vaza para o filho variáveis fora da allow-list", async () => {
    process.env["DM_SEGREDO_DE_TESTE"] = "isto-nao-pode-vazar";
    cleanup.push(() => delete process.env["DM_SEGREDO_DE_TESTE"]);

    const env = buildEnv(essentialEnvKeys(), { DM_MARCADOR: "presente" });
    expect(env["DM_SEGREDO_DE_TESTE"]).toBeUndefined();

    const result = await echo(["x"], env);
    expect(result.env["DM_MARCADOR"]).toBe("presente");
    expect(result.env["DM_SEGREDO_DE_TESTE"]).toBeUndefined();
  }, 30_000);

  it("devolve o pid do processo criado", async () => {
    const { child, pid } = spawnDetached(process.execPath, ["-e", "process.exit(0)"], {
      cwd: PACKAGE_ROOT,
      env: buildEnv(essentialEnvKeys()),
      stdio: "ignore",
    });
    expect(pid).toBe(child.pid);
    expect(Number.isInteger(pid)).toBe(true);
    await once(child, "exit");
  }, 30_000);

  it("lança quando o executável não existe, sem deixar erro solto", async () => {
    expect(() =>
      spawnDetached(resolve(FIXTURES, "nao-existe-mesmo.exe"), [], {
        cwd: PACKAGE_ROOT,
        env: buildEnv(essentialEnvKeys()),
        stdio: "ignore",
      }),
    ).toThrow(/Não consegui iniciar/);
  });

  it("rejeita argumento inválido", () => {
    const base = { cwd: PACKAGE_ROOT, env: {}, stdio: "ignore" } as const;
    expect(() => spawnDetached("", [], base)).toThrow(/command precisa ser uma string não vazia/);
    expect(() => spawnDetached(process.execPath, ["a\0b"], base)).toThrow(/byte nulo/);
    expect(() => spawnDetached(process.execPath, [], { ...base, cwd: "relativo" })).toThrow(
      /precisa ser absoluto/,
    );
  });
});

describe("buildEnv", () => {
  const source = {
    PATH: "/usr/bin",
    SEGREDO: "token-do-provedor",
    OUTRO_SEGREDO: "chave-de-api",
    VAZIA: "",
  };

  it("copia só as chaves da allow-list", () => {
    expect(buildEnv(["PATH"], {}, source)).toEqual({ PATH: "/usr/bin" });
  });

  it("não inventa chave que o ambiente de origem não tem", () => {
    expect(buildEnv(["PATH", "NAO_EXISTE"], {}, source)).toEqual({ PATH: "/usr/bin" });
  });

  it("copia valor vazio, que é diferente de ausente", () => {
    expect(buildEnv(["VAZIA"], {}, source)).toEqual({ VAZIA: "" });
  });

  it("injeta 'extra' mesmo fora da allow-list, porque é explícito", () => {
    expect(buildEnv(["PATH"], { DM_RUN_ID: "r1" }, source)).toEqual({
      PATH: "/usr/bin",
      DM_RUN_ID: "r1",
    });
  });

  it("deixa 'extra' ganhar da allow-list na mesma chave", () => {
    expect(buildEnv(["PATH"], { PATH: "/opt/bin" }, source)).toEqual({ PATH: "/opt/bin" });
  });

  it("nunca devolve uma chave que não foi pedida", () => {
    const env = buildEnv(["PATH"], { DM_RUN_ID: "r1" }, source);
    expect(Object.keys(env).sort()).toEqual(["DM_RUN_ID", "PATH"]);
    expect(env["SEGREDO"]).toBeUndefined();
    expect(env["OUTRO_SEGREDO"]).toBeUndefined();
  });

  it("rejeita nome de variável inválido", () => {
    expect(() => buildEnv(["A=B"], {}, source)).toThrow(/inválido/);
    expect(() => buildEnv([""], {}, source)).toThrow(/inválido/);
    expect(() => buildEnv([], { X: "a\0b" }, source)).toThrow(/byte nulo/);
  });

  it("lê do process.env quando nenhuma origem é passada", () => {
    process.env["DM_ORIGEM_PADRAO"] = "sim";
    try {
      expect(buildEnv(["DM_ORIGEM_PADRAO"])).toEqual({ DM_ORIGEM_PADRAO: "sim" });
    } finally {
      delete process.env["DM_ORIGEM_PADRAO"];
    }
  });
});

// No Windows as variáveis de ambiente são case-insensitive: `Path` e `PATH` são
// a mesma variável, e mandar as duas no bloco de ambiente é um bug esperando
// para acontecer.
describe.runIf(process.platform === "win32")("buildEnv no Windows", () => {
  const source = { Path: "C:\\Windows", SEGREDO: "token" };

  it("encontra a variável mesmo com a caixa trocada", () => {
    expect(buildEnv(["PATH"], {}, source)).toEqual({ PATH: "C:\\Windows" });
  });

  it("não duplica a mesma variável escrita de dois jeitos", () => {
    expect(buildEnv(["PATH", "path"], {}, source)).toEqual({ PATH: "C:\\Windows" });
  });

  it("deixa 'extra' substituir a entrada da allow-list mesmo com outra caixa", () => {
    expect(buildEnv(["PATH"], { Path: "C:\\Outro" }, source)).toEqual({ Path: "C:\\Outro" });
  });
});

describe.runIf(process.platform !== "win32")("buildEnv fora do Windows", () => {
  it("diferencia a caixa das letras", () => {
    const source = { Path: "/usr/bin" };
    expect(buildEnv(["PATH"], {}, source)).toEqual({});
    expect(buildEnv(["Path"], {}, source)).toEqual({ Path: "/usr/bin" });
  });
});

describe("essentialEnvKeys", () => {
  it("traz SystemRoot no Windows e PATH no POSIX", () => {
    expect(essentialEnvKeys("win32")).toContain("SystemRoot");
    expect(essentialEnvKeys("darwin")).toContain("PATH");
    expect(essentialEnvKeys("darwin")).not.toContain("SystemRoot");
  });
});
