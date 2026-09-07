import { describe, expect, it } from "vitest";

import * as platform from "./index.js";

describe("@dungeon-master/platform", () => {
  it("exporta pelo barril tudo que os outros pacotes consomem", () => {
    expect(Object.keys(platform).sort()).toEqual([
      "buildEnv",
      "commandTerminatedBySignal",
      "essentialEnvKeys",
      "isInside",
      "isPathWithinRoot",
      "normalizeAbsolutePath",
      "processExists",
      "samePath",
      "spawnDetached",
      "terminateProcessTree",
      "validateAndResolvePath",
      "waitUntilGone",
    ]);
  });
});
