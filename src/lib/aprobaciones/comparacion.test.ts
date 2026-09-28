import { describe, expect, it } from "vitest";
import { compararHijos, construirComparacion, gruposDeSolicitud } from "./comparacion";
import { legajoActual } from "./fixtures.test-helpers";
import { serializeHijos } from "./solicitudes";

describe("gruposDeSolicitud", () => {
  it("returns the touched groups in page order", () => {
    expect(gruposDeSolicitud(["alergias", "cuil", "hijos"])).toEqual(["A", "C", "D"]);
    expect(gruposDeSolicitud([])).toEqual([]);
  });
});

describe("construirComparacion", () => {
  it("lists only the fields whose submitted value differs, grouped A to D", () => {
    const grupos = construirComparacion(
      [
        { campo: "telefono_celular", valorPropuesto: "1122223333" },
        { campo: "localidad", valorPropuesto: "Barrio de Prueba" },
        { campo: "nombres", valorPropuesto: "Otra" },
        { campo: "piso_depto", valorPropuesto: "2° A" },
      ],
      legajoActual(),
    );
    expect(grupos.map((grupo) => grupo.grupo)).toEqual(["A", "B"]);
    expect(grupos[0].filas).toEqual([{ campo: "nombres", actual: "Prueba", propuesto: "Otra" }]);
    // Unchanged localidad is left out; an empty current value is null.
    expect(grupos[1].filas).toEqual([
      { campo: "piso_depto", actual: null, propuesto: "2° A" },
      { campo: "telefono_celular", actual: "1100000002", propuesto: "1122223333" },
    ]);
    expect(grupos[0].hijos).toBeNull();
  });

  it("compares booleans and dates in their text form, and clearing a value", () => {
    const [grupo] = construirComparacion(
      [
        { campo: "tiene_hijos", valorPropuesto: "false" },
        { campo: "nombre_conyuge", valorPropuesto: null },
        { campo: "hijos", valorPropuesto: "[]" },
      ],
      legajoActual(),
    );
    expect(grupo.filas).toEqual([
      { campo: "nombre_conyuge", actual: "Cónyuge Ficticio", propuesto: null },
      { campo: "tiene_hijos", actual: "true", propuesto: "false" },
    ]);
    expect(grupo.hijos?.map((cambio) => cambio.tipo)).toEqual(["quitado", "quitado"]);
  });

  it("a group whose values all match has no rows", () => {
    const [grupo] = construirComparacion([{ campo: "dni", valorPropuesto: "12345678" }], legajoActual());
    expect(grupo).toEqual({ grupo: "A", filas: [], hijos: null });
  });

  it("compares the children as a list", () => {
    const hijos = serializeHijos([
      { nombre_completo: "hija  ficticia", fecha_nacimiento: "2015-03-02" },
      { nombre_completo: "Hijo Ficticio", fecha_nacimiento: "2018-11-21" },
      { nombre_completo: "Nuevo Hijo", fecha_nacimiento: "2024-01-01" },
    ]);
    const [grupo] = construirComparacion([{ campo: "hijos", valorPropuesto: hijos }], legajoActual());
    expect(grupo.filas).toEqual([]);
    expect(grupo.hijos).toEqual([
      { tipo: "modificado", hijo: { nombre_completo: "Hijo Ficticio", fecha_nacimiento: "2018-11-21" }, fechaAnterior: "2018-11-20" },
      { tipo: "agregado", hijo: { nombre_completo: "Nuevo Hijo", fecha_nacimiento: "2024-01-01" } },
    ]);
  });
});

describe("compararHijos", () => {
  const a = { nombre_completo: "Ana Prueba", fecha_nacimiento: "2010-01-01" };
  const b = { nombre_completo: "Beto Prueba", fecha_nacimiento: "2012-02-02" };

  it("matches names ignoring case, accents and spaces; unchanged children are left out", () => {
    expect(compararHijos([a], [{ ...a, nombre_completo: "  ANA   prueba " }])).toEqual([]);
    expect(compararHijos([{ ...a, nombre_completo: "José" }], [{ ...a, nombre_completo: "jose" }])).toEqual([]);
  });

  it("reports added, removed and modified children", () => {
    expect(compararHijos([a, b], [{ ...b, fecha_nacimiento: "2012-02-03" }])).toEqual([
      { tipo: "modificado", hijo: { ...b, fecha_nacimiento: "2012-02-03" }, fechaAnterior: "2012-02-02" },
      { tipo: "quitado", hijo: a },
    ]);
    expect(compararHijos([], [a])).toEqual([{ tipo: "agregado", hijo: a }]);
  });

  it("pairs repeated names in order", () => {
    const gemelo = { nombre_completo: "Gemelo", fecha_nacimiento: "2020-05-05" };
    expect(compararHijos([gemelo, gemelo], [gemelo, gemelo, gemelo])).toEqual([{ tipo: "agregado", hijo: gemelo }]);
  });
});
