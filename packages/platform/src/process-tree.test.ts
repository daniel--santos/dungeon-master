import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  commandTerminatedBySignal,
  processExists,
  terminateProcessTree,
  waitUntilGone,
} from "./process-tree.js";
import { buildEnv, essentialEnvKeys, spawnDetached } from "./spawn.js";

const execFileAsync = promisify(execFile);

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");
const FIXTURES = resolve(PACKAGE_ROOT, "test", "fixtures");

/** Pids abertos por um teste, derrubados no fim dê no que der. */
const started = new Set<number>();

afterEach(async () => {
  for (const pid of started) {
    try {
      await terminateProcessTree(pid, { graceMs: 5_000, confirmMs: 5_000 });
    } catch {
      // Limpeza é best-effort: o teste já reportou o que importa.
    }
  }
  started.clear();
});

/** Sobe uma fixture com `spawnDetached` e devolve o pid e o stdout do processo. */
function startFixture(name: string, args: readonly string[] = []): { pid: number; out: Readable } {
  const { child, pid } = spawnDetached(process.execPath, [resolve(FIXTURES, name), ...args], {
    cwd: PACKAGE_ROOT,
    env: buildEnv(essentialEnvKeys()),
    stdio: ["ignore", "pipe", "ignore"],
  });
  started.add(pid);
  if (child.stdout === null) throw new Error("a fixture precisa de stdout em pipe");
  return { pid, out: child.stdout };
}

/** Lê a primeira linha completa do stream, ou estoura o prazo. */
async function firstLine(stream: Readable, timeoutMs = 15_000): Promise<string> {
  stream.setEncoding("utf8");
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  for await (const chunk of stream) {
    buffer += chunk as string;
    const newline = buffer.indexOf("\n");
    if (newline >= 0) return buffer.slice(0, newline);
    if (Date.now() >= deadline) break;
  }
  throw new Error(`nenhuma linha completa em ${String(timeoutMs)}ms; li ${JSON.stringify(buffer)}`);
}

describe("processExists", () => {
  it("reconhece o próprio processo", () => {
    expect(processExists(process.pid)).toBe(true);
  });

  it("rejeita pid inválido", () => {
    expect(() => processExists(0)).toThrow(/inteiro positivo/);
    expect(() => processExists(-1)).toThrow(/inteiro positivo/);
    expect(() => processExists(1.5)).toThrow(/inteiro positivo/);
  });
});

describe("waitUntilGone", () => {
  it("devolve true na hora quando o alvo já sumiu", async () => {
    const antes = Date.now();
    await expect(waitUntilGone(() => false, 5_000)).resolves.toBe(true);
    expect(Date.now() - antes).toBeLessThan(1_000);
  });

  it("devolve false quando o prazo estoura com o alvo de pé", async () => {
    await expect(waitUntilGone(() => true, 100)).resolves.toBe(false);
  });

  it("devolve true quando o alvo some no meio da espera", async () => {
    let restantes = 3;
    await expect(waitUntilGone(() => restantes-- > 0, 5_000)).resolves.toBe(true);
  });

  it("rejeita prazo inválido", async () => {
    await expect(waitUntilGone(() => false, -1)).rejects.toThrow(/não negativo/);
  });
});

describe("commandTerminatedBySignal", () => {
  it("separa comando cortado por sinal de comando que só falhou", () => {
    expect(commandTerminatedBySignal({ killed: true, signal: "SIGTERM" })).toBe(true);
    expect(commandTerminatedBySignal({ killed: false, signal: "SIGTERM" })).toBe(true);
    expect(commandTerminatedBySignal({ killed: false, signal: null, code: 128 })).toBe(false);
    expect(commandTerminatedBySignal(new Error("nem começou"))).toBe(false);
    expect(commandTerminatedBySignal(undefined)).toBe(false);
  });
});

describe("terminateProcessTree", () => {
  it("rejeita pid inválido e o pid do próprio processo", async () => {
    await expect(terminateProcessTree(0)).rejects.toThrow(/inteiro positivo/);
    await expect(terminateProcessTree(-1)).rejects.toThrow(/inteiro positivo/);
    await expect(terminateProcessTree(1.5)).rejects.toThrow(/inteiro positivo/);
    await expect(terminateProcessTree(process.pid)).rejects.toThrow(/próprio processo/);
    await expect(terminateProcessTree(1, { graceMs: -1 })).rejects.toThrow(/não negativo/);
  });

  it("mata a árvore inteira: pai e neto somem", async () => {
    const { pid, out } = startFixture("tree.mjs");
    const linha = JSON.parse(await firstLine(out)) as { parent: number; child: number };

    expect(linha.parent).toBe(pid);
    expect(processExists(linha.parent)).toBe(true);
    expect(processExists(linha.child)).toBe(true);

    const resultado = await terminateProcessTree(pid, { graceMs: 3_000, confirmMs: 3_000 });

    expect(resultado.terminated).toBe(true);
    expect(resultado.method).toBe(process.platform === "win32" ? "taskkill" : "sigterm");
    expect(resultado.elapsedMs).toBeGreaterThanOrEqual(0);

    // O pai já foi confirmado pela própria terminação. O neto é o que prova que
    // a árvore foi andada, e não só a raiz: ele não sairia sozinho.
    expect(processExists(linha.parent)).toBe(false);
    await expect(waitUntilGone(() => processExists(linha.child), 5_000)).resolves.toBe(true);
    expect(processExists(linha.child)).toBe(false);

    started.delete(pid);
  }, 60_000);

  it("devolve terminated em pid já morto, sem lançar", async () => {
    const { child, pid } = spawnDetached(process.execPath, ["-e", "process.exit(0)"], {
      cwd: PACKAGE_ROOT,
      env: buildEnv(essentialEnvKeys()),
      stdio: "ignore",
    });
    await once(child, "exit");
    await expect(waitUntilGone(() => processExists(pid), 10_000)).resolves.toBe(true);

    // Sem apertar `graceMs`: no Windows ele é o teto do próprio `taskkill`, e
    // um teto curto cortaria o comando antes de ele terminar de rodar.
    const resultado = await terminateProcessTree(pid);
    expect(resultado.terminated).toBe(true);
  }, 30_000);

  it.runIf(process.platform === "win32")(
    "não confirma nada quando o taskkill não tem tempo de rodar",
    async () => {
      const { pid, out } = startFixture("tree.mjs");
      await firstLine(out);

      // `graceMs` curto demais é a única forma de o Windows devolver
      // `terminated: false` sem o alvo ter resistido de verdade. É o resultado
      // certo: com a varredura cortada no meio, nada foi provado.
      const resultado = await terminateProcessTree(pid, { graceMs: 1, confirmMs: 1 });
      expect(resultado.terminated).toBe(false);
    },
    60_000,
  );
});

// No Windows, `process.kill` disparado de outro processo vira `TerminateProcess`
// e não entrega sinal nenhum: o handler do alvo nunca roda. O caminho de
// verdade é o do console, e é o que `tooling/windows/send-ctrl-break.ps1` faz.
// Este teste existe para que o shutdown gracioso do Windows continue provado por
// execução, e não por leitura de documentação.
//
// Só roda fora do CI: a fixture abre um console novo para o alvo, e o runner
// `windows-latest` do GitHub Actions não tem sessão de desktop para isso. Lá a
// chamada falhava depois de 90 s sem provar nada. Localmente continua obrigatório.
const CTRL_BREAK_PROVAVEL = process.platform === "win32" && process.env["CI"] === undefined;

describe.runIf(CTRL_BREAK_PROVAVEL)("CTRL_BREAK no Windows", () => {
  it("entrega SIGBREAK ao alvo, que trata e sai com código 0", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "dm-ctrl-break-"));
    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          resolve(FIXTURES, "run-ctrl-break.ps1"),
          "-TargetScript",
          resolve(FIXTURES, "ctrl-break-target.mjs"),
          "-MarkerPath",
          join(workDir, "marcador.txt"),
          "-SenderScript",
          resolve(REPO_ROOT, "tooling", "windows", "send-ctrl-break.ps1"),
          "-LogPath",
          join(workDir, "alvo.out"),
          "-ErrorPath",
          join(workDir, "alvo.err"),
        ],
        { timeout: 90_000, windowsHide: true },
      );

      const resultado = JSON.parse(stdout.trim()) as { pid: number; exitCode: number };

      // O código 0 só acontece pelo `process.exit(0)` do handler. Morte por
      // `TerminateProcess` daria 1, e o marcador não existiria.
      expect(resultado.exitCode).toBe(0);
      expect(readFileSync(join(workDir, "marcador.txt"), "utf8")).toContain("SIGBREAK");
      expect(processExists(resultado.pid)).toBe(false);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 120_000);
});

// O kill de grupo é o mecanismo do POSIX e não tem equivalente no Windows: só a
// perna macOS da matriz de CI exercita este bloco.
describe.runIf(process.platform !== "win32")("kill de grupo no POSIX", () => {
  it("mata o grupo inteiro e deixa de existir como grupo", async () => {
    const { pid, out } = startFixture("tree.mjs");
    const linha = JSON.parse(await firstLine(out)) as { parent: number; child: number };

    // `spawnDetached` cria o filho com `detached: true`, então ele lidera o
    // próprio grupo e o neto nasce dentro dele.
    expect(() => process.kill(-pid, 0)).not.toThrow();

    const resultado = await terminateProcessTree(pid, { graceMs: 3_000, confirmMs: 3_000 });
    expect(resultado.terminated).toBe(true);
    expect(resultado.method).toBe("sigterm");

    expect(processExists(linha.parent)).toBe(false);
    expect(processExists(linha.child)).toBe(false);
    expect(() => process.kill(-pid, 0)).toThrow(
      expect.objectContaining({ code: "ESRCH" }) as unknown as Error,
    );

    started.delete(pid);
  }, 60_000);

  it("escala para SIGKILL quando o alvo ignora SIGTERM", async () => {
    const { pid, out } = startFixture("stubborn.mjs");
    expect(await firstLine(out)).toBe("ready");

    const resultado = await terminateProcessTree(pid, { graceMs: 500, confirmMs: 5_000 });

    expect(resultado.method).toBe("sigkill");
    expect(resultado.terminated).toBe(true);
    // O grace foi respeitado antes de escalar: menos que isso significaria que
    // o SIGTERM não teve chance.
    expect(resultado.elapsedMs).toBeGreaterThanOrEqual(500);
    expect(processExists(pid)).toBe(false);

    started.delete(pid);
  }, 60_000);
});
