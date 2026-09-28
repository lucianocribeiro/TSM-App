import { describe, expect, it } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { MAX_MOTIVO_RECHAZO, validarMotivo } from "./motivo";

describe("validarMotivo", () => {
  it("trims and accepts a reason", () => {
    expect(validarMotivo("  El DNI no coincide.  ")).toEqual({ ok: true, motivo: "El DNI no coincide." });
  });

  it("requires a non-blank reason", () => {
    for (const value of ["", "   \n\t", null, undefined, 42]) {
      expect(validarMotivo(value)).toEqual({ ok: false, error: copy.aprobaciones.errors.motivoRequerido });
    }
  });

  it("bounds the length after trimming", () => {
    expect(validarMotivo(` ${"a".repeat(MAX_MOTIVO_RECHAZO)} `).ok).toBe(true);
    const largo = validarMotivo("a".repeat(MAX_MOTIVO_RECHAZO + 1));
    expect(largo.ok).toBe(false);
    expect(largo.ok ? "" : largo.error).toContain(String(MAX_MOTIVO_RECHAZO));
  });
});
