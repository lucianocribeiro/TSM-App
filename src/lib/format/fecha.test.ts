import { describe, expect, it } from "vitest";
import { formatearFechaHora } from "./fecha";

describe("formatearFechaHora", () => {
  it("formats in es-AR and in Argentina's time zone", () => {
    // 03:30 UTC is 00:30 in Buenos Aires (UTC-3).
    expect(formatearFechaHora("2026-09-27T03:30:00Z")).toBe("27/09/2026, 00:30");
    expect(formatearFechaHora("2026-12-31T22:05:00Z")).toBe("31/12/2026, 19:05");
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatearFechaHora("no-es-fecha")).toBe("");
  });
});
