import { afterEach, describe, expect, it, vi } from "vitest";

// SESSION_SECRET: accepted from 43 characters (32 random bytes, base64url);
// anything shorter or missing gives no key, with one error that never
// contains the value.

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function modulo() {
  vi.resetModules();
  return import("./secreto");
}

describe("leerSecretoSesion", () => {
  it("accepts a long enough secret", async () => {
    const { leerSecretoSesion, SECRETO_MIN_CARACTERES } = await modulo();
    const valor = "a".repeat(SECRETO_MIN_CARACTERES);
    expect(leerSecretoSesion(valor)).toBe(valor);
  });

  it("refuses a missing, empty or short secret, logging one error without the value", async () => {
    const errores = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { leerSecretoSesion, SECRETO_MIN_CARACTERES } = await modulo();
    const corto = "b".repeat(SECRETO_MIN_CARACTERES - 1);
    expect(leerSecretoSesion(undefined)).toBeNull();
    expect(leerSecretoSesion("")).toBeNull();
    expect(leerSecretoSesion(corto)).toBeNull();
    expect(errores).toHaveBeenCalledTimes(1);
    expect(String(errores.mock.calls[0][0])).toContain("SESSION_SECRET");
    expect(errores.mock.calls.flat().join(" ")).not.toContain(corto);
  });
});
