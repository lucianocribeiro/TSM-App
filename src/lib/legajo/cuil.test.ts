import { describe, expect, it } from "vitest";
import { cuilDigitoVerificador, normalizarCuil } from "./cuil";

describe("cuilDigitoVerificador", () => {
  it("computes the modulo 11 check digit", () => {
    // 20-12345678-6: 2*5+0*4+1*3+2*2+3*7+4*6+5*5+6*4+7*3+8*2 = 148; 148 % 11 = 5; 11 - 5 = 6.
    expect(cuilDigitoVerificador("2012345678")).toBe(6);
    // 2*5+3*4 = 22, a remainder of 0: check digit 0.
    expect(cuilDigitoVerificador("2300000000")).toBe(0);
  });

  it("returns null when no check digit exists (result 10) or the input is not ten digits", () => {
    const tens = Array.from({ length: 200 }, (_, i) => `20${String(10000000 + i)}`).filter(
      (digits) => cuilDigitoVerificador(digits) === null,
    );
    expect(tens.length).toBeGreaterThan(0);
    // 2*5+1*2 = 12, remainder 1: 11 - 1 = 10, no valid check digit.
    expect(cuilDigitoVerificador("2000000001")).toBeNull();
    expect(cuilDigitoVerificador("123")).toBeNull();
    expect(cuilDigitoVerificador("20a2345678")).toBeNull();
  });
});

describe("normalizarCuil", () => {
  it("accepts the hyphenated and the plain form and returns XX-XXXXXXXX-X", () => {
    expect(normalizarCuil("20-12345678-6")).toBe("20-12345678-6");
    expect(normalizarCuil("20123456786")).toBe("20-12345678-6");
    expect(normalizarCuil("  20-12345678-6 ")).toBe("20-12345678-6");
  });

  it("rejects a wrong check digit", () => {
    for (let digit = 0; digit <= 9; digit += 1) {
      if (digit === 6) continue;
      expect(normalizarCuil(`20-12345678-${digit}`), String(digit)).toBeNull();
    }
  });

  it("rejects wrong formats", () => {
    for (const value of ["", "2012345678", "201234567861", "20.12345678.6", "20 12345678 6", "2O-12345678-6", "20--12345678-6"]) {
      expect(normalizarCuil(value), value).toBeNull();
    }
  });
});
