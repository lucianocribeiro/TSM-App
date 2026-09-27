import { describe, expect, it } from "vitest";
import { filtrarCuentas, nombreCompleto, normalizarBusqueda, type CuentaListItem } from "./listado";

function cuenta(overrides: Partial<CuentaListItem>): CuentaListItem {
  return {
    id: overrides.email ?? "id",
    email: "x@mitsm.test",
    rol: "empleado",
    estado: "activa",
    debeCambiarPassword: false,
    nombre: null,
    ...overrides,
  };
}

const CUENTAS = [
  cuenta({ email: "zoe@mitsm.test", nombre: "Zoe Álvarez" }),
  cuenta({ email: "admin@mitsm.test", nombre: "Ana Pérez", rol: "admin" }),
  cuenta({ email: "baja@mitsm.test", nombre: "José Baja", estado: "inactiva" }),
  cuenta({ email: "sin.nombre@mitsm.test" }),
];

describe("nombreCompleto", () => {
  it("joins what is filled and returns null when nothing is", () => {
    expect(nombreCompleto("Ana", "Pérez")).toBe("Ana Pérez");
    expect(nombreCompleto("  Ana ", null)).toBe("Ana");
    expect(nombreCompleto(null, "Pérez")).toBe("Pérez");
    expect(nombreCompleto(" ", "")).toBeNull();
    expect(nombreCompleto(null, null)).toBeNull();
  });
});

describe("normalizarBusqueda", () => {
  it("ignores case, accents and extra spaces", () => {
    expect(normalizarBusqueda("  José   PÉREZ ")).toBe("jose perez");
    expect(normalizarBusqueda("Ñandú")).toBe("nandu");
  });
});

describe("filtrarCuentas", () => {
  it("hides inactive accounts by default and shows them with 'todas'", () => {
    const activas = filtrarCuentas(CUENTAS, { filtro: "activas", busqueda: "" }).map((c) => c.email);
    expect(activas).not.toContain("baja@mitsm.test");
    expect(activas).toHaveLength(3);
    const todas = filtrarCuentas(CUENTAS, { filtro: "todas", busqueda: "" }).map((c) => c.email);
    expect(todas).toContain("baja@mitsm.test");
    expect(todas).toHaveLength(4);
  });

  it("searches by email and by name, ignoring case and accents", () => {
    expect(filtrarCuentas(CUENTAS, { filtro: "activas", busqueda: "ZOE@" }).map((c) => c.email)).toEqual(["zoe@mitsm.test"]);
    expect(filtrarCuentas(CUENTAS, { filtro: "activas", busqueda: "perez" }).map((c) => c.email)).toEqual(["admin@mitsm.test"]);
    expect(filtrarCuentas(CUENTAS, { filtro: "activas", busqueda: "alvarez" }).map((c) => c.email)).toEqual(["zoe@mitsm.test"]);
  });

  it("applies the state filter to search results", () => {
    expect(filtrarCuentas(CUENTAS, { filtro: "activas", busqueda: "jose" })).toEqual([]);
    expect(filtrarCuentas(CUENTAS, { filtro: "todas", busqueda: "jose" }).map((c) => c.email)).toEqual(["baja@mitsm.test"]);
  });

  it("sorts by name, then accounts without a name by email", () => {
    expect(filtrarCuentas(CUENTAS, { filtro: "todas", busqueda: "" }).map((c) => c.email)).toEqual([
      "admin@mitsm.test",
      "baja@mitsm.test",
      "zoe@mitsm.test",
      "sin.nombre@mitsm.test",
    ]);
  });

  it("does not change the input", () => {
    const copia = [...CUENTAS];
    filtrarCuentas(CUENTAS, { filtro: "todas", busqueda: "" });
    expect(CUENTAS).toEqual(copia);
  });
});
