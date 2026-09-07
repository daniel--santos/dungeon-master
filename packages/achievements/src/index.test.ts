import { describe, expect, it } from "vitest";

import { ACHIEVEMENTS_PACKAGE } from "./index.js";

describe("@dungeon-master/achievements", () => {
  it("está fiado no workspace", () => {
    expect(ACHIEVEMENTS_PACKAGE).toBe("@dungeon-master/achievements");
  });
});
