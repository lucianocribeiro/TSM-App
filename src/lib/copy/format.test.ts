import { describe, expect, it } from "vitest";
import { formatCopy } from "./format";

describe("formatCopy", () => {
  it("fills every occurrence and leaves unknown placeholders visible", () => {
    expect(formatCopy("Hola {email}, {email}.", { email: "ana@mitsm.test" })).toBe("Hola ana@mitsm.test, ana@mitsm.test.");
    expect(formatCopy("Hola {nombre}", {})).toBe("Hola {nombre}");
  });
});
