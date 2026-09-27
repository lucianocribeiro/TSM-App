import { describe, expect, it } from "vitest";
import { CUIL_PREFIJOS, cuilDigitoVerificador, normalizarCuil, validarCuil } from "./cuil";

// Builds a CUIL from a prefix and a DNI with its computed check digit. Test
// numbers are generated, never real people's.
function construir(prefijo: string, dni: string): string | null {
  const digito = cuilDigitoVerificador(`${prefijo}${dni}`);
  return digito === null ? null : `${prefijo}-${dni}-${digito}`;
}

// The first 8-digit DNI (from 10000000) for which `prefijo` has no check digit.
function dniSinDigito(prefijo: string): string {
  for (let n = 10_000_000; n < 10_010_000; n += 1) {
    if (cuilDigitoVerificador(`${prefijo}${n}`) === null) return String(n);
  }
  throw new Error("no DNI found");
}

describe("cuilDigitoVerificador", () => {
  it("computes the modulo 11 check digit", () => {
    // 2*5+0*4+1*3+2*2+3*7+4*6+5*5+6*4+7*3+8*2 = 148; 148 % 11 = 5; 11 - 5 = 6.
    expect(cuilDigitoVerificador("2012345678")).toBe(6);
    // 2*5+3*4 = 22, a remainder of 0: check digit 0.
    expect(cuilDigitoVerificador("2300000000")).toBe(0);
    // 2*5+1*2 = 12, remainder 1: 11 - 1 = 10, no valid check digit.
    expect(cuilDigitoVerificador("2000000001")).toBeNull();
    expect(cuilDigitoVerificador("123")).toBeNull();
    expect(cuilDigitoVerificador("20a2345678")).toBeNull();
  });
});

describe("validarCuil: allowed prefixes", () => {
  it("allows exactly 20, 23, 24 and 27", () => {
    expect([...CUIL_PREFIJOS]).toEqual(["20", "23", "24", "27"]);
  });

  it.each(CUIL_PREFIJOS)("accepts a valid CUIL with prefix %s", (prefijo) => {
    // A DNI for which this prefix has a check digit.
    const dni = ["30111222", "30111223", "30111224", "30111225"].find((d) => construir(prefijo, d) !== null)!;
    const cuil = construir(prefijo, dni)!;
    expect(validarCuil(cuil)).toEqual({ ok: true, cuil });
    expect(validarCuil(cuil.replace(/-/g, ""))).toEqual({ ok: true, cuil });
  });

  it("rejects prefix 20 when its check digit would be 10, and accepts the same DNI with 23 (digit 9)", () => {
    const dni = dniSinDigito("20");
    for (let digito = 0; digito <= 9; digito += 1) {
      expect(validarCuil(`20-${dni}-${digito}`).ok, `20-${dni}-${digito}`).toBe(false);
    }
    const reasignado = construir("23", dni);
    expect(reasignado).toBe(`23-${dni}-9`);
    expect(validarCuil(reasignado!)).toEqual({ ok: true, cuil: reasignado });
  });

  it("rejects prefix 27 when its check digit would be 10, and accepts the same DNI with 23 (digit 4)", () => {
    const dni = dniSinDigito("27");
    for (let digito = 0; digito <= 9; digito += 1) {
      expect(validarCuil(`27-${dni}-${digito}`).ok, `27-${dni}-${digito}`).toBe(false);
    }
    const reasignado = construir("23", dni);
    expect(reasignado).toBe(`23-${dni}-4`);
    expect(validarCuil(reasignado!)).toEqual({ ok: true, cuil: reasignado });
  });

  it("rejects a prefix outside the list even with a correct check digit", () => {
    for (const prefijo of ["30", "33", "34", "99", "21", "00"]) {
      const cuil = construir(prefijo, "30111222") ?? construir(prefijo, "30111223");
      expect(cuil, prefijo).not.toBeNull();
      expect(validarCuil(cuil!), prefijo).toEqual({ ok: false, motivo: "prefijo" });
    }
  });

  it("rejects a wrong check digit", () => {
    const cuil = construir("20", "30111222") ?? construir("20", "30111223");
    const digito = Number(cuil!.slice(-1));
    const otro = `${cuil!.slice(0, -1)}${(digito + 1) % 10}`;
    expect(validarCuil(otro)).toEqual({ ok: false, motivo: "digito" });
  });

  it("rejects a wrong length or non-digits", () => {
    for (const value of ["", "2012345678", "201234567861", "20-1234567-86", "20.12345678.6", "20 12345678 6", "2O-12345678-6", "20--12345678-6", "CUIL"]) {
      expect(validarCuil(value), value).toEqual({ ok: false, motivo: "formato" });
    }
  });
});

describe("normalizarCuil", () => {
  it("returns XX-XXXXXXXX-X for a valid CUIL and null otherwise", () => {
    expect(normalizarCuil("  20123456786 ")).toBe("20-12345678-6");
    expect(normalizarCuil("20-12345678-7")).toBeNull();
    expect(normalizarCuil("30-12345678-1")).toBeNull();
  });
});
