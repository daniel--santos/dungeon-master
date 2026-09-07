import { describe, expect, it } from "vitest";

import { GLOSSARY_PACKAGE } from "./index.js";

describe("@dungeon-master/glossary", () => {
  it("está fiado no workspace", () => {
    expect(GLOSSARY_PACKAGE).toBe("@dungeon-master/glossary");
  });
});
