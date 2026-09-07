// Ecoa em JSON o que chegou de verdade ao processo filho, para
// `src/spawn.test.ts`.
//
// `argv` sai sem `execPath` e sem o caminho deste arquivo: sobra exatamente a
// lista que quem chamou passou. `env` sai inteiro, porque o teste da allow-list
// precisa provar ausência, não presença.

process.stdout.write(
  JSON.stringify({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
  }),
);
