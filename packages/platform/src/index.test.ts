import { describe, expect, it } from "vitest";

import { PLATFORM_PACKAGE } from "./index.js";

describe("@dungeon-master/platform", () => {
  it("está fiado no workspace", () => {
    expect(PLATFORM_PACKAGE).toBe("@dungeon-master/platform");
  });
});
