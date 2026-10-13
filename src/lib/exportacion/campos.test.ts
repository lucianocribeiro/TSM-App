import { describe, expect, it } from "vitest";
import { CAMPOS_SOLICITUD } from "@/lib/aprobaciones/campos";
import { copy } from "@/lib/copy/es-AR";
import { copyLaborales } from "@/lib/copy/laborales";
import { CAMPOS_EXPORTACION, camposDelGrupo, esCampoExportacion, GRUPOS_EXPORTACION, validarSeleccion } from "./campos";
import { validarFiltros } from "./filtros";

describe("export fields (allow-list)", () => {
  it("lists groups A to D as the legajo columns, without the children, then group E with antigüedad", () => {
    const aD = CAMPOS_SOLICITUD.filter((config) => config.campo !== "hijos").map((config) => config.campo);
    expect(CAMPOS_EXPORTACION.map((config) => config.campo)).toEqual([
      ...aD,
      "numero_legajo",
      "area",
      "puesto",
      "fecha_ingreso",
      "antiguedad",
      "estado_laboral",
      "sucursal",
      "convenio",
      "tarea",
      "categoria",
    ]);
    expect(esCampoExportacion("hijos")).toBe(false);
    expect(esCampoExportacion("profile_id")).toBe(false);
    expect(esCampoExportacion("id")).toBe(false);
  });

  it("labels each field as the screens do, grouped A to E", () => {
    expect(GRUPOS_EXPORTACION.map((g) => g.titulo)).toEqual([
      copy.miLegajo.grupos.A,
      copy.miLegajo.grupos.B,
      copy.miLegajo.grupos.C,
      copy.miLegajo.grupos.D,
      copyLaborales.grupo,
    ]);
    expect(CAMPOS_EXPORTACION.find((c) => c.campo === "cuil")?.label).toBe(copy.aprobaciones.campos.cuil);
    expect(CAMPOS_EXPORTACION.find((c) => c.campo === "numero_legajo")?.label).toBe(copyLaborales.campos.numero_legajo);
    expect(camposDelGrupo("C")).toEqual(["estado_civil", "nombre_conyuge", "tiene_hijos"]);
    expect(camposDelGrupo("E")).toHaveLength(10);
  });
});

describe("validarSeleccion", () => {
  it("returns the fields in column order", () => {
    expect(validarSeleccion({ campos: ["numero_legajo", "cuil", "nombres"], hijos: true })).toEqual({
      campos: ["nombres", "cuil", "numero_legajo"],
      hijos: true,
    });
  });

  it("refuses an unknown or repeated key, no fields, or a malformed choice", () => {
    for (const input of [
      { campos: ["nombres", "password"], hijos: false },
      { campos: ["hijos"], hijos: true },
      { campos: ["nombres", "nombres"], hijos: false },
      { campos: [], hijos: true },
      { campos: ["nombres"] },
      { campos: "nombres", hijos: false },
      { campos: [1], hijos: false },
      null,
      "nombres",
    ]) {
      expect(validarSeleccion(input), JSON.stringify(input)).toBeNull();
    }
  });

  it("refuses a property other than campos and hijos, instead of ignoring it", () => {
    expect(validarSeleccion({ campos: ["nombres"], hijos: false, filas: [] })).toBeNull();
    expect(validarSeleccion({ campos: ["nombres"], hijos: false, extra: undefined })).toBeNull();
    expect(validarSeleccion([["nombres"], false])).toBeNull();
    expect(validarSeleccion({ campos: ["nombres"], hijos: false })).toEqual({ campos: ["nombres"], hijos: false });
  });
});

describe("validarFiltros", () => {
  const base = { busqueda: "", estadoLaboral: "", areaId: "", sucursalId: "", tareaId: "", mostrarBajas: false };
  const uuid = "00000000-0000-4000-8000-000000000001";

  it("takes exactly the list's state", () => {
    expect(validarFiltros(base)).toEqual(base);
    expect(validarFiltros({ ...base, busqueda: "pérez", estadoLaboral: "en_prueba", areaId: uuid, mostrarBajas: true })).toMatchObject({
      areaId: uuid,
      mostrarBajas: true,
    });
  });

  it("refuses anything else", () => {
    for (const input of [
      { ...base, extra: 1 },
      { ...base, areaId: "Ventas" },
      { ...base, estadoLaboral: "baja" },
      { ...base, mostrarBajas: "true" },
      { ...base, busqueda: "x".repeat(201) },
      { busqueda: "" },
      null,
    ]) {
      expect(validarFiltros(input), JSON.stringify(input)).toBeNull();
    }
  });
});
