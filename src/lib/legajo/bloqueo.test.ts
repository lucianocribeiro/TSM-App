import { describe, expect, it } from "vitest";
import { grupoBloqueado } from "./bloqueo";

describe("grupoBloqueado (pending change request lock)", () => {
  it("locks groups A to D only while a request is pending", () => {
    for (const grupo of ["A", "B", "C", "D"] as const) {
      expect(grupoBloqueado(grupo, true), grupo).toBe(true);
      expect(grupoBloqueado(grupo, false), grupo).toBe(false);
    }
  });

  it("never locks group E", () => {
    expect(grupoBloqueado("E", true)).toBe(false);
    expect(grupoBloqueado("E", false)).toBe(false);
  });
});
