import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // A suíte de contrato com a CLI real sobe processos e fala com a rede; os
    // tetos são generosos porque a alternativa é um teste intermitente.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // Um único worker: dois Runs de CLI ao mesmo tempo disputam o mesmo limite
    // de taxa e transformam falha de quota em falha de teste.
    fileParallelism: false,
  },
});
