import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CliResolutionError, resolveCli } from "./resolve-cli.js";

let sandbox: string;
let binDir: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "dm-cli-"));
  binDir = join(sandbox, "bin");
  await mkdir(binDir, { recursive: true });
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { PATH: [binDir, "/nao/existe"].join(delimiter), ...extra };
}

describe("resolveCli", () => {
  it("devolve undefined quando não está no PATH", async () => {
    // Ausência é informação de preflight, não erro.
    await expect(resolveCli("ferramenta-que-nao-existe", { env: env() })).resolves.toBeUndefined();
  });

  it("aceita um caminho absoluto existente e recusa um inexistente", async () => {
    const target = join(binDir, "coisa.exe");
    await writeFile(target, "binário");

    const resolved = await resolveCli(target, { env: env(), platform: "win32" });
    expect(resolved?.command).toBe(target);
    expect(resolved?.kind).toBe("EXECUTABLE");

    await expect(
      resolveCli(join(binDir, "nao-existe.exe"), { env: env(), platform: "win32" }),
    ).resolves.toBeUndefined();
  });

  describe.runIf(process.platform === "win32")("no Windows", () => {
    it("resolve um `.exe` pelo PATHEXT", async () => {
      await writeFile(join(binDir, "claude.exe"), "binário");

      const resolved = await resolveCli("claude", {
        env: env({ PATHEXT: ".COM;.EXE;.BAT;.CMD" }),
        platform: "win32",
      });

      expect(resolved?.kind).toBe("EXECUTABLE");
      expect(resolved?.command).toBe(join(binDir, "claude.exe"));
      expect(resolved?.argsPrefix).toEqual([]);
    });

    it("transforma o shim `.cmd` do npm em `node <script.js>`", async () => {
      // É a razão de este módulo existir: desde a correção do CVE-2024-27980 o
      // Node recusa executar `.cmd` sem shell, e este projeto não usa shell.
      await mkdir(join(binDir, "node_modules", "@openai", "codex", "bin"), { recursive: true });
      const script = join(binDir, "node_modules", "@openai", "codex", "bin", "codex.js");
      await writeFile(script, "// cli");
      await writeFile(
        join(binDir, "codex.cmd"),
        [
          "@ECHO off",
          "SET dp0=%~dp0",
          'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
        ].join("\r\n"),
      );

      const resolved = await resolveCli("codex", {
        env: env({ PATHEXT: ".COM;.EXE;.BAT;.CMD" }),
        platform: "win32",
        nodePath: "C:\\Program Files\\nodejs\\node.exe",
      });

      expect(resolved?.kind).toBe("NODE_SCRIPT");
      expect(resolved?.command).toBe("C:\\Program Files\\nodejs\\node.exe");
      expect(resolved?.argsPrefix).toEqual([script]);
      expect(resolved?.resolvedPath).toBe(join(binDir, "codex.cmd"));
    });

    it("prefere o `.cmd` ao arquivo sem extensão de mesmo nome", async () => {
      // O npm instala os dois lado a lado: `pi` (script `sh`, para o Git Bash)
      // e `pi.cmd`. No Windows o primeiro não é executável, e escolhê-lo
      // produziria um erro de spawn sem explicação.
      await mkdir(join(binDir, "node_modules", "p", "dist"), { recursive: true });
      const script = join(binDir, "node_modules", "p", "dist", "cli.js");
      await writeFile(script, "// cli");
      await writeFile(join(binDir, "pi"), "#!/bin/sh\nexec node cli.js\n");
      await writeFile(
        join(binDir, "pi.cmd"),
        '@echo off\n"%dp0%\\node_modules\\p\\dist\\cli.js" %*',
      );

      const resolved = await resolveCli("pi", {
        env: env({ PATHEXT: ".COM;.EXE;.BAT;.CMD" }),
        platform: "win32",
        nodePath: "node.exe",
      });

      expect(resolved?.resolvedPath).toBe(join(binDir, "pi.cmd"));
      expect(resolved?.argsPrefix).toEqual([script]);
    });

    it("um shim que não aponta para um script existente falha com explicação", async () => {
      await writeFile(join(binDir, "quebrado.cmd"), '@echo off\n"%dp0%\\sumiu.js" %*');

      await expect(
        resolveCli("quebrado", { env: env({ PATHEXT: ".CMD" }), platform: "win32" }),
      ).rejects.toBeInstanceOf(CliResolutionError);
    });

    it("um shim só de PowerShell é recusado, e não silenciado", async () => {
      await writeFile(join(binDir, "so-ps.ps1"), "# shim");

      await expect(
        resolveCli("so-ps", { env: env({ PATHEXT: ".PS1" }), platform: "win32" }),
      ).rejects.toThrow(/PowerShell/);
    });
  });

  describe.runIf(process.platform !== "win32")("no POSIX", () => {
    it("exige o bit de execução", async () => {
      const target = join(binDir, "pi");
      await writeFile(target, "#!/bin/sh\necho oi\n");

      await expect(resolveCli("pi", { env: env() })).resolves.toBeUndefined();

      await chmod(target, 0o755);
      const resolved = await resolveCli("pi", { env: env() });
      expect(resolved?.command).toBe(target);
      expect(resolved?.kind).toBe("EXECUTABLE");
    });
  });
});
