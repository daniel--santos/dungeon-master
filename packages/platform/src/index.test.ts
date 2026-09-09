import { describe, expect, it } from "vitest";

import * as platform from "./index.js";

describe("@dungeon-master/platform", () => {
  it("exporta pelo barril tudo que os outros pacotes consomem", () => {
    expect(Object.keys(platform).sort()).toEqual([
      "ENV_FILE_NAME",
      "WORKSPACE_ROOT_MARKER",
      "buildEnv",
      "commandTerminatedBySignal",
      "essentialEnvKeys",
      "findWorkspaceRoot",
      "isInside",
      "isPathWithinRoot",
      "loadWorkspaceEnv",
      "normalizeAbsolutePath",
      "processExists",
      "resolveEnvFilePaths",
      "samePath",
      "spawnDetached",
      "terminateProcessTree",
      "validateAndResolvePath",
      "waitUntilGone",
    ]);
  });
});
