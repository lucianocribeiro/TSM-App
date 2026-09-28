import { describe, expect, it } from "vitest";
import { rutaRetornoSegura } from "./retorno";

describe("rutaRetornoSegura", () => {
  it("keeps same-origin paths to known, non-public routes", () => {
    expect(rutaRetornoSegura("/legajos")).toBe("/legajos");
    expect(rutaRetornoSegura("/legajos/abc?filtro=1")).toBe("/legajos/abc?filtro=1");
    expect(rutaRetornoSegura("/aprobaciones/solicitudes/123")).toBe("/aprobaciones/solicitudes/123");
    expect(rutaRetornoSegura("/mi-legajo")).toBe("/mi-legajo");
  });

  // Open-redirect payloads: each must be refused.
  const PAYLOADS = [
    "https://evil.example",
    "http://evil.example/legajos",
    "//evil.example",
    "//evil.example/legajos",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/\\/evil.example",
    "\\/evil.example",
    "/%2F%2Fevil.example",
    "/%2fevil.example",
    "%2F%2Fevil.example",
    "/%5Cevil.example",
    "/%5cevil.example",
    "/%252F%252Fevil.example",
    "/%25252F%25252Fevil.example",
    "javascript:alert(1)",
    "/javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "/\tevil.example",
    "/\n/evil.example",
    "/ /evil.example",
    "/%09/evil.example",
    "/%0a/evil.example",
    "/%00/legajos",
    " /legajos",
    "legajos",
    "evil.example",
    "/login",
    "/auth/salir",
    "/no-existe",
    "",
    "/%",
    `/${"a".repeat(600)}`,
  ];

  it.each(PAYLOADS)("refuses %j", (payload) => {
    expect(rutaRetornoSegura(payload)).toBeNull();
  });

  it("refuses non-strings", () => {
    for (const value of [null, undefined, 42, ["/legajos"], { a: 1 }]) expect(rutaRetornoSegura(value)).toBeNull();
  });

  it("reports how many payloads are covered", () => {
    expect(PAYLOADS.length).toBeGreaterThanOrEqual(30);
  });
});
