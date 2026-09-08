/**
 * Constrói a imagem de referência do agente (`docker/agent.Dockerfile`).
 *
 * Existe como script Node, e não como uma linha no `package.json`, por causa do
 * contrato de UID/GID: no Linux e no macOS a imagem precisa ser construída para
 * o UID **deste** usuário, senão os arquivos que o agente escrever no bind mount
 * saem com o dono errado — e no Linux ele nem consegue escrever. No Windows não
 * existe UID, e o contrato é o padrão 1000:1000, o mesmo que o worker usa em
 * `--user`. Uma linha de shell que resolvesse isso não seria a mesma nos dois
 * sistemas, e o projeto trata Windows e macOS como primeira classe.
 *
 * Uso:
 *   pnpm docker:build                       # tag padrão
 *   pnpm docker:build -- --image outra:tag  # outra tag
 *   pnpm docker:build -- --no-cache
 */

import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Precisa bater com `DEFAULT_AGENT_IMAGE` de `packages/runtime/src/docker.ts`. */
const DEFAULT_IMAGE = "dungeon-master-agent:0.1.0";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dockerfile = join(raiz, "docker", "agent.Dockerfile");

const argv = process.argv.slice(2);
const imageIndex = argv.indexOf("--image");
const image = imageIndex === -1 ? DEFAULT_IMAGE : (argv[imageIndex + 1] ?? DEFAULT_IMAGE);
const extras = argv.filter((arg, i) => i !== imageIndex && i !== imageIndex + 1);

const uid = process.getuid?.();
const gid = process.getgid?.();

const buildArgs = [];
if (uid !== undefined && gid !== undefined) {
  buildArgs.push("--build-arg", `AGENT_UID=${String(uid)}`);
  buildArgs.push("--build-arg", `AGENT_GID=${String(gid)}`);
}

const args = [
  "build",
  "--tag",
  image,
  "--file",
  dockerfile,
  ...buildArgs,
  ...extras,
  // O contexto é o diretório do Dockerfile, e não a raiz do repositório: a
  // imagem não copia nada do projeto, e um contexto grande só faria o daemon
  // ler o monorepo inteiro à toa.
  join(raiz, "docker"),
];

console.warn(`[docker:build] docker ${args.join(" ")}`);
const inicio = Date.now();

// Sem `shell: true` (CLAUDE.md, seção 8): o argv vai como array.
const filho = spawn("docker", args, { stdio: "inherit" });

filho.on("error", (error) => {
  console.error(
    `[docker:build] não consegui executar o cliente Docker: ${error.message}\n` +
      "Confira se o Docker Desktop está aberto e se `docker` está no PATH.",
  );
  process.exitCode = 1;
});

filho.on("exit", (code) => {
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  if (code === 0) {
    console.warn(`[docker:build] ${image} pronta em ${segundos}s`);
  } else {
    console.error(`[docker:build] falhou com código ${String(code)} depois de ${segundos}s`);
  }
  process.exitCode = code ?? 1;
});
