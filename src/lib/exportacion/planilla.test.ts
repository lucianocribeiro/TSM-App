import { describe, expect, it } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { copyLaborales } from "@/lib/copy/laborales";
import { exportable, item, laboralRow, legajoRow } from "./fixtures.test-helpers";
import { armarLibro, celdaDe, celdaFecha, FORMATO_FECHA, hojaHijos, hojaLegajos, neutralizarTexto, nombreArchivo } from "./planilla";

const ventas = item("area", "Ventas");
const mostrador = item("puesto", "Mostrador", { areaId: ventas.id });
const pacheco = item("sucursal", "Pacheco", { activo: false });
const ITEMS = [ventas, mostrador, pacheco];
const NOMBRES = new Map(ITEMS.map((i) => [i.id, i.nombre]));
const HOY = "2026-10-11";

describe("formula injection", () => {
  it("prefixes text that a spreadsheet would evaluate, and leaves the rest", () => {
    for (const peligroso of ["=1+1", "+54 11", "-2", "@SUM(A1)", "\tx", "\rx", '=HYPERLINK("http://x","y")']) {
      expect(neutralizarTexto(peligroso), JSON.stringify(peligroso)).toBe(`'${peligroso}`);
    }
    for (const seguro of ["Ana", "11 4444-5555", "20-30111222-3", "a=b", "Pérez", "'ya", " =x"]) {
      expect(neutralizarTexto(seguro), seguro).toBe(seguro);
    }
  });

  it("applies to every text cell, as a string cell", () => {
    const celda = celdaDe("alergias", exportable({ legajo: legajoRow({ alergias: "=cmd|' /C calc'!A0" }) }), NOMBRES, HOY);
    expect(celda).toEqual({ value: "'=cmd|' /C calc'!A0", type: String });
    const hijos = hojaHijos([exportable({ hijos: [{ nombre_completo: "+Hijo", fecha_nacimiento: "2015-05-01" }] })]);
    expect(hijos.data[1][3]).toEqual({ value: "'+Hijo", type: String });
  });
});

describe("row builder", () => {
  const legajo = exportable({
    legajo: legajoRow({ cuil: "20301112223" }),
    laboral: laboralRow({ area_id: ventas.id, puesto_id: mostrador.id, sucursal_id: pacheco.id, fecha_ingreso: "2020-03-01" }),
  });

  it("writes list fields by name, an inactive item by its plain name", () => {
    expect(celdaDe("area", legajo, NOMBRES, HOY)).toEqual({ value: "Ventas", type: String });
    expect(celdaDe("puesto", legajo, NOMBRES, HOY)).toEqual({ value: "Mostrador", type: String });
    expect(celdaDe("sucursal", legajo, NOMBRES, HOY)).toEqual({ value: "Pacheco", type: String });
    expect(celdaDe("tarea", legajo, NOMBRES, HOY)).toBeNull();
  });

  it("writes dates as date cells (DD/MM/AAAA) and CUIL as XX-XXXXXXXX-X", () => {
    expect(celdaDe("fecha_nacimiento", legajo, NOMBRES, HOY)).toEqual({ value: new Date(Date.UTC(1990, 0, 15)), type: Date, format: FORMATO_FECHA });
    expect(celdaDe("fecha_ingreso", legajo, NOMBRES, HOY)).toEqual({ value: new Date(Date.UTC(2020, 2, 1)), type: Date, format: "dd/mm/yyyy" });
    expect(celdaDe("cuil", legajo, NOMBRES, HOY)).toEqual({ value: "20-30111222-3", type: String });
    expect(celdaFecha("2020-02-30x")).toBeNull();
  });

  it("calculates antigüedad as of the export day, and writes states in words", () => {
    expect(celdaDe("antiguedad", legajo, NOMBRES, HOY)).toEqual({ value: "6 años y 7 meses", type: String });
    expect(celdaDe("estado_laboral", legajo, NOMBRES, HOY)?.value).toBe(copyLaborales.estados.activo);
    expect(celdaDe("estado_civil", legajo, NOMBRES, HOY)?.value).toBe(copy.miLegajo.estadosCiviles.union_convivencial);
    expect(celdaDe("tiene_hijos", legajo, NOMBRES, HOY)?.value).toBe(copy.miLegajo.siNo.si);
    expect(celdaDe("numero_legajo", exportable({ laboral: null }), NOMBRES, HOY)).toBeNull();
  });

  it("builds the Legajos sheet: bold headers with the screens' labels, one row per employee, frozen header", () => {
    const hoja = hojaLegajos([legajo, exportable()], ["nombres", "numero_legajo", "area"], NOMBRES, HOY);
    expect(hoja.sheet).toBe(copy.exportacion.hojas.legajos);
    expect(hoja.stickyRowsCount).toBe(1);
    expect(hoja.data[0]).toEqual([
      { value: copy.aprobaciones.campos.nombres, type: String, fontWeight: "bold" },
      { value: copyLaborales.campos.numero_legajo, type: String, fontWeight: "bold" },
      { value: copyLaborales.campos.area, type: String, fontWeight: "bold" },
    ]);
    expect(hoja.data).toHaveLength(3);
    expect(hoja.columns).toHaveLength(3);
    expect(hoja.columns.every((c) => c.width >= 10 && c.width <= 50)).toBe(true);
  });

  it("builds the Hijos sheet only when chosen, one row per child, linked to the employee", () => {
    const conHijos = exportable({
      hijos: [
        { nombre_completo: "Benjamín", fecha_nacimiento: "2018-04-02" },
        { nombre_completo: "Abril", fecha_nacimiento: "2015-01-20" },
      ],
    });
    expect(armarLibro([conHijos], { campos: ["nombres"], hijos: false }, [], HOY).map((h) => h.sheet)).toEqual([copy.exportacion.hojas.legajos]);
    const [, hijos] = armarLibro([conHijos, exportable()], { campos: ["nombres"], hijos: true }, [], HOY);
    expect(hijos.sheet).toBe(copy.exportacion.hojas.hijos);
    expect(hijos.data.map((fila) => fila.map((c) => (c?.value instanceof Date ? c.value.toISOString().slice(0, 10) : c?.value)))).toEqual([
      [copyLaborales.campos.numero_legajo, copy.aprobaciones.campos.apellido, copy.aprobaciones.campos.nombres, copy.miLegajo.hijos.nombre, copy.miLegajo.hijos.fecha],
      ["L-1", "Prueba", "Ana", "Abril", "2015-01-20"],
      ["L-1", "Prueba", "Ana", "Benjamín", "2018-04-02"],
    ]);
  });
});

describe("nombreArchivo", () => {
  it("names the file by the date and time in Argentina", () => {
    // 02:30 UTC on 1 January is 23:30 on 31 December in Argentina (UTC-3).
    expect(nombreArchivo(new Date("2026-01-01T02:30:00Z"))).toBe("legajos-2025-12-31-2330.xlsx");
    expect(nombreArchivo(new Date("2026-10-11T15:05:00Z"))).toBe("legajos-2026-10-11-1205.xlsx");
  });
});
