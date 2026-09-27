import { describe, expect, it } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { parseCambioPassword, passwordSchema, PASSWORD_MIN_LENGTH } from "./password";

const messages = copy.password.errors;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("passwordSchema", () => {
  it("requires at least 8 characters", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    for (const value of ["", "a", "1234567", "       "]) {
      const result = passwordSchema.safeParse(value);
      expect(result.success, JSON.stringify(value)).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(messages.demasiadoCorta);
    }
    for (const value of ["12345678", "Temporal-2026", "        ", "ñandú123"]) {
      expect(passwordSchema.safeParse(value).success, JSON.stringify(value)).toBe(true);
    }
  });

  it("allows up to 72 bytes, counting multi-byte characters", () => {
    expect(passwordSchema.safeParse("a".repeat(72)).success).toBe(true);
    const tooLong = passwordSchema.safeParse("a".repeat(73));
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.message).toBe(messages.demasiadoLarga);
    // "ñ" is 2 bytes in UTF-8: 37 of them are 74 bytes.
    expect(passwordSchema.safeParse("ñ".repeat(36)).success).toBe(true);
    expect(passwordSchema.safeParse("ñ".repeat(37)).success).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(passwordSchema.safeParse(undefined).success).toBe(false);
    expect(passwordSchema.safeParse(12345678).success).toBe(false);
  });
});

describe("parseCambioPassword", () => {
  const forced = { requiereActual: false };
  const voluntary = { requiereActual: true };

  it("returns the new password when both fields match and are valid", () => {
    expect(parseCambioPassword(form({ password: "NuevaClave-1", confirmacion: "NuevaClave-1" }), forced)).toEqual({
      ok: true,
      data: { actual: null, password: "NuevaClave-1" },
    });
  });

  it("does not trim the password", () => {
    expect(parseCambioPassword(form({ password: " clave12 ", confirmacion: " clave12 " }), forced)).toEqual({
      ok: true,
      data: { actual: null, password: " clave12 " },
    });
  });

  it("reports a short password before a mismatch", () => {
    expect(parseCambioPassword(form({ password: "corta", confirmacion: "otra" }), forced)).toEqual({
      ok: false,
      error: messages.demasiadoCorta,
    });
  });

  it("reports a mismatch", () => {
    expect(
      parseCambioPassword(form({ password: "NuevaClave-1", confirmacion: "NuevaClave-2" }), forced),
    ).toEqual({ ok: false, error: messages.noCoinciden });
  });

  it("reports missing fields", () => {
    expect(parseCambioPassword(new FormData(), forced)).toEqual({ ok: false, error: messages.demasiadoCorta });
    expect(parseCambioPassword(form({ password: "NuevaClave-1" }), forced)).toEqual({
      ok: false,
      error: messages.noCoinciden,
    });
  });

  describe("current password", () => {
    const nueva = { password: "NuevaClave-1", confirmacion: "NuevaClave-1" };

    it("is required in a voluntary change", () => {
      for (const actual of [undefined, ""]) {
        const fields = actual === undefined ? nueva : { ...nueva, actual };
        expect(parseCambioPassword(form(fields), voluntary), JSON.stringify(actual)).toEqual({
          ok: false,
          error: messages.actualRequerida,
        });
      }
      expect(parseCambioPassword(form({ ...nueva, actual: "ClaveActual-1" }), voluntary)).toEqual({
        ok: true,
        data: { actual: "ClaveActual-1", password: "NuevaClave-1" },
      });
    });

    it("is reported before the new-password rules in a voluntary change", () => {
      expect(parseCambioPassword(form({ password: "corta", confirmacion: "otra" }), voluntary)).toEqual({
        ok: false,
        error: messages.actualRequerida,
      });
    });

    it("is not required, and ignored if sent, in a forced change", () => {
      expect(parseCambioPassword(form(nueva), forced)).toEqual({
        ok: true,
        data: { actual: null, password: "NuevaClave-1" },
      });
      expect(parseCambioPassword(form({ ...nueva, actual: "cualquiera" }), forced)).toEqual({
        ok: true,
        data: { actual: null, password: "NuevaClave-1" },
      });
    });
  });
});
