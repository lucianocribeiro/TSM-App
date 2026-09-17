import { describe, expect, it } from "vitest";
import { calcularAntiguedad } from "./antiguedad";

describe("calcularAntiguedad", () => {
  it.each([
    ["2021-09-15", "2021-09-15", 0, 0],
    ["2021-09-15", "2022-09-15", 1, 0],
    ["2021-09-15", "2022-09-14", 0, 11],
    ["2021-09-15", "2026-09-17", 5, 0],
    ["2021-09-15", "2026-03-14", 4, 5],
    ["2021-09-15", "2026-03-15", 4, 6],
    ["2015-02-01", "2026-01-31", 10, 11],
    ["2020-12-31", "2021-01-01", 0, 0],
    ["2020-12-31", "2021-01-31", 0, 1],
  ])("from %s to %s is %i years %i months", (desde, hasta, anios, meses) => {
    expect(calcularAntiguedad(desde, hasta)).toEqual({ anios, meses });
  });

  it("counts a full month when the reference is the last day of a shorter month", () => {
    expect(calcularAntiguedad("2025-01-31", "2025-02-28")).toEqual({ anios: 0, meses: 1 });
    expect(calcularAntiguedad("2024-01-30", "2024-02-29")).toEqual({ anios: 0, meses: 1 });
    expect(calcularAntiguedad("2024-01-31", "2024-02-28")).toEqual({ anios: 0, meses: 0 });
    expect(calcularAntiguedad("2025-03-31", "2025-04-30")).toEqual({ anios: 0, meses: 1 });
  });

  it("handles leap-day ingreso", () => {
    expect(calcularAntiguedad("2024-02-29", "2025-02-28")).toEqual({ anios: 1, meses: 0 });
    expect(calcularAntiguedad("2024-02-29", "2025-02-27")).toEqual({ anios: 0, meses: 11 });
  });

  it("returns zero when the reference is before the ingreso date", () => {
    expect(calcularAntiguedad("2026-10-01", "2026-09-17")).toEqual({ anios: 0, meses: 0 });
    expect(calcularAntiguedad("2026-09-20", "2026-09-17")).toEqual({ anios: 0, meses: 0 });
  });

  it("returns null for invalid dates", () => {
    expect(calcularAntiguedad("2021-02-30", "2026-01-01")).toBeNull();
    expect(calcularAntiguedad("2021-09-15", "17/09/2026")).toBeNull();
  });
});
