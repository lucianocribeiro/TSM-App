import { describe, expect, it } from "vitest";
import { esFechaFutura, hoyEnArgentina } from "./fechas";

describe("hoyEnArgentina", () => {
  it("uses Argentina's date, not UTC's", () => {
    // 02:00 UTC on 28 Sep is still 27 Sep in Buenos Aires (UTC-3).
    expect(hoyEnArgentina(new Date("2026-09-28T02:00:00Z"))).toBe("2026-09-27");
    expect(hoyEnArgentina(new Date("2026-09-28T03:00:00Z"))).toBe("2026-09-28");
  });
});

describe("esFechaFutura", () => {
  const now = new Date("2026-09-27T15:00:00Z");
  it("is true only after today in Argentina", () => {
    expect(esFechaFutura("2026-09-28", now)).toBe(true);
    expect(esFechaFutura("2026-09-27", now)).toBe(false);
    expect(esFechaFutura("1990-01-01", now)).toBe(false);
  });
});
