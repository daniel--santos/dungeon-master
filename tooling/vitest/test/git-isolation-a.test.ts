import { describe } from "vitest";

import { provaDeIsolamento } from "./isolation-suite.js";

describe("isolamento de gitconfig — arquivo A", () => {
  provaDeIsolamento("arquivo-a", "arquivo-b");
});
