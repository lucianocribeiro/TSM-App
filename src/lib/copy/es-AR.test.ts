import { describe, expect, it } from "vitest";
import { copy } from "./es-AR";

describe("es-AR copy", () => {
  it("defines non-empty app strings", () => {
    expect(copy.app.name.trim()).not.toBe("");
    expect(copy.app.placeholder.trim()).not.toBe("");
  });
});
