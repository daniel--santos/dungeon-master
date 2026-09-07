import { describe, expect, it } from "vitest";

import { DOMAIN_PACKAGE } from "./index.js";

describe("@dungeon-master/domain", () => {
  it("está fiado no workspace", () => {
    expect(DOMAIN_PACKAGE).toBe("@dungeon-master/domain");
  });
});
