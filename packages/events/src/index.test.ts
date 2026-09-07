import { describe, expect, it } from "vitest";

import { EVENTS_PACKAGE } from "./index.js";

describe("@dungeon-master/events", () => {
  it("está fiado no workspace", () => {
    expect(EVENTS_PACKAGE).toBe("@dungeon-master/events");
  });
});
