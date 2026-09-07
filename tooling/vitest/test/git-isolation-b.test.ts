import { describe } from "vitest";

import { provaDeIsolamento } from "./isolation-suite.js";

describe("isolamento de gitconfig — arquivo B", () => {
  provaDeIsolamento("arquivo-b", "arquivo-a");
});
