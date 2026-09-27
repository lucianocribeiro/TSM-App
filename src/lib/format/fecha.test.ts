import { describe, expect, it } from "vitest";
import { formatearFecha, formatearFechaHora, formatearPesos } from "./fecha";

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

describe("formatearFecha", () => {
  it("shows a stored date as dd/mm/yyyy without any time zone shift", () => {
    expect(formatearFecha("2026-01-01")).toBe("01/01/2026");
    expect(formatearFecha("1990-12-31")).toBe("31/12/1990");
    expect(formatearFecha(null)).toBe("");
    expect(formatearFecha("2026-1-1")).toBe("");
  });
});

describe("formatearPesos", () => {
  it("formats pesos in es-AR", () => {
    expect(formatearPesos(1234567.89).replace(/\s/g, " ")).toBe("$ 1.234.567,89");
    expect(formatearPesos(0).replace(/\s/g, " ")).toBe("$ 0,00");
    expect(formatearPesos(null)).toBe("");
  });
});
