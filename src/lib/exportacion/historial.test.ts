import { describe, expect, it } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { item } from "./fixtures.test-helpers";
import { camposDelGrupo } from "./campos";
import { filaExportacion, resumirCampos, resumirFiltros } from "./historial";

const t = copy.exportacion.historial;
const ventas = item("area", "Ventas");
const base = { busqueda: "", estadoLaboral: "", areaId: "", sucursalId: "", tareaId: "", mostrarBajas: false };
const ACTOR = "30000000-0000-4000-8000-000000000001";

describe("export history", () => {
  it("names a whole group once, and lists the fields of a partial one", () => {
    expect(resumirCampos([...camposDelGrupo("A"), "numero_legajo", "area"])).toBe("Datos personales (todos) · Número de legajo · Área");
    expect(resumirCampos(["cuil"])).toBe("CUIL");
  });

  it("summarizes the filters in words, list items by name", () => {
    expect(resumirFiltros(base, [])).toBe(t.sinFiltros);
    expect(resumirFiltros({ ...base, busqueda: " pérez ", estadoLaboral: "activo", areaId: ventas.id, mostrarBajas: true }, [ventas])).toBe(
      "Búsqueda: «pérez» · Estado laboral: Activo · Área: Ventas · Con dados de baja",
    );
    const borrado = "00000000-0000-4000-8000-0000000000ff";
    expect(resumirFiltros({ ...base, sucursalId: borrado }, [])).toBe(`Sucursal: ${t.itemNoDisponible}`);
    expect(resumirFiltros({ raro: 1 }, [])).toBe(t.sinFiltros);
  });

  it("shows who by name, else the fallback, never an id", () => {
    const registro = { id: "x", actorId: ACTOR, fecha: "2026-10-11T15:05:00Z", campos: ["nombres"], incluyeHijos: true, cantidad: 3, filtros: base, resultado: "ok" };
    expect(filaExportacion(registro, new Map([[ACTOR, "Admin Prueba"]]), [])).toEqual({
      id: "x",
      fecha: "11/10/2026, 12:05",
      usuario: "Admin Prueba",
      cantidad: "3",
      campos: "Nombres",
      hijos: t.si,
      filtros: t.sinFiltros,
      completada: true,
    });
    const sinNombre = filaExportacion({ ...registro, resultado: "error" }, new Map(), []);
    expect(sinNombre.usuario).toBe(t.usuarioNoDisponible);
    expect(sinNombre.completada).toBe(false);
    expect(JSON.stringify({ ...sinNombre, id: "" })).not.toContain(ACTOR);
  });
});
