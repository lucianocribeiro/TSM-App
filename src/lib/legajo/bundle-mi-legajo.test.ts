import { describe, expect, it } from "vitest";
import { buscarProhibidos, IDS_PROHIBIDOS, MARCA_XLSX, TEXTOS_PROHIBIDOS } from "../../../scripts/bundle-mi-legajo.mjs";
import { copyLaborales } from "@/lib/copy/laborales";
import { CAMPOS_LABORALES } from "./laborales";

// The bundle check (scripts/bundle-mi-legajo.mjs, run after the build in CI)
// looks for the group E labels and field identifiers. These keep its lists in
// step with the Admin-only copy and fields, and check the scan itself.

describe("Mi Legajo bundle check", () => {
  it("looks for the group E title, its distinctive labels and every group E field", () => {
    expect(TEXTOS_PROHIBIDOS).toEqual(
      expect.arrayContaining([
        copyLaborales.grupo,
        copyLaborales.campos.numero_legajo,
        copyLaborales.campos.fecha_ingreso,
        copyLaborales.campos.estado_laboral,
        copyLaborales.campos.antiguedad,
      ]),
    );
    expect(IDS_PROHIBIDOS).toEqual(expect.arrayContaining([...CAMPOS_LABORALES, "legajos_laborales"]));
  });

  it("looks for the .xlsx writer by a path only a workbook writer carries (CR-4)", () => {
    expect(buscarProhibidos([["cliente.js", 'f("xl/worksheets/sheet1.xml")']], [MARCA_XLSX])).toEqual([{ chunk: "cliente.js", texto: MARCA_XLSX }]);
    expect(buscarProhibidos([["cliente.js", "const a=1;"]], [MARCA_XLSX])).toEqual([]);
  });

  it("finds a forbidden string raw or \\u-escaped, and nothing in a clean chunk", () => {
    const chunks: [string, string][] = [
      ["limpio.js", 'const t={A:"Datos personales"};'],
      ["crudo.js", 'const e={E:"Datos laborales"},c=["sucursal_id"];'],
      ["escapado.js", 'const l="N\\u00famero de legajo";'],
    ];
    expect(buscarProhibidos(chunks)).toEqual([
      { chunk: "crudo.js", texto: "Datos laborales" },
      { chunk: "crudo.js", texto: "sucursal_id" },
      { chunk: "escapado.js", texto: "Número de legajo" },
    ]);
  });
});
