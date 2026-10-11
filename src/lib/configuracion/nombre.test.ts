import { describe, expect, it } from "vitest";
import { claveNombre, NOMBRE_MAX, normalizarNombre, validarNombre } from "./nombre";

describe("normalizarNombre", () => {
  it("trims and collapses every run of spaces", () => {
    expect(normalizarNombre("  Casa   Central \t")).toBe("Casa Central");
    expect(normalizarNombre("Mostrador\n(SM)")).toBe("Mostrador (SM)");
  });
});

describe("claveNombre", () => {
  it("ignores case, accents and spaces", () => {
    const clave = claveNombre("Administración");
    for (const variante of ["administracion", "ADMINISTRACIÓN", "  Administracion ", "ÁDMINÍSTRÁCIÓN"]) {
      expect(claveNombre(variante), variante).toBe(clave);
    }
    expect(claveNombre("Logística  Norte")).toBe("logistica norte");
    expect(claveNombre("Ñandú Pingüino")).toBe("nandu pinguino");
  });

  it("keeps different names apart", () => {
    expect(claveNombre("San Martín")).not.toBe(claveNombre("San Justo"));
  });
});

describe("validarNombre", () => {
  const existentes = ["Ventas", "Administración", "Mostrador (SM)"];

  it("returns the normalized name when it is valid", () => {
    expect(validarNombre("  Nueva   Sucursal ", existentes)).toEqual({ ok: true, nombre: "Nueva Sucursal" });
  });

  it("refuses an empty name or one with spaces only, or not a string", () => {
    for (const vacio of ["", "   ", "\t\n", null, undefined, 3]) {
      expect(validarNombre(vacio, existentes)).toEqual({ ok: false, error: "vacio" });
    }
  });

  it(`refuses more than ${NOMBRE_MAX} characters, counted after normalizing`, () => {
    expect(validarNombre("x".repeat(NOMBRE_MAX), existentes).ok).toBe(true);
    expect(validarNombre(`  ${"x".repeat(NOMBRE_MAX)}  `, existentes).ok).toBe(true);
    expect(validarNombre("x".repeat(NOMBRE_MAX + 1), existentes)).toEqual({ ok: false, error: "largo" });
    // Characters, not UTF-16 units or bytes.
    expect(validarNombre("ñ".repeat(NOMBRE_MAX), existentes).ok).toBe(true);
  });

  it("refuses a duplicate whatever its case, accents or spaces", () => {
    for (const duplicado of ["ventas", "VENTAS", " Ventas ", "Véntas", "administracion", "ADMINISTRACIÓN", "mostrador  (sm)"]) {
      expect(validarNombre(duplicado, existentes), duplicado).toEqual({ ok: false, error: "duplicado" });
    }
  });

  it("accepts a name when only the item itself had it (rename)", () => {
    expect(validarNombre("VENTAS", [])).toEqual({ ok: true, nombre: "VENTAS" });
  });
});
