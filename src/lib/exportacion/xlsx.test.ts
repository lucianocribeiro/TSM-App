import { describe, expect, it, vi } from "vitest";
import { fechaDeSerial, leerXlsx } from "../../../e2e/xlsx";
import { exportable, item, laboralRow } from "./fixtures.test-helpers";
import { armarLibro } from "./planilla";

vi.mock("server-only", () => ({}));
const { escribirXlsx } = await import("./xlsx");

// The workbook as Excel reads it: written by the library, read back with the
// tests' own reader (e2e/xlsx.ts).
describe("escribirXlsx", () => {
  it("writes the sheets, bold frozen headers, date cells and neutralized text", async () => {
    const ventas = item("area", "Ventas");
    const legajos = [
      exportable({
        laboral: laboralRow({ area_id: ventas.id }),
        hijos: [{ nombre_completo: "=Hijo", fecha_nacimiento: "2015-01-20" }],
      }),
    ];
    const archivo = await escribirXlsx(armarLibro(legajos, { campos: ["nombres", "fecha_nacimiento", "area"], hijos: true }, [ventas], "2026-10-11"));
    const libro = leerXlsx(archivo);

    expect(libro.hojas.map((h) => h.nombre)).toEqual(["Legajos", "Hijos"]);
    const [legajosHoja, hijosHoja] = libro.hojas;
    expect(legajosHoja.congelada).toBe(true);
    expect(legajosHoja.filas[0].map((c) => c.texto)).toEqual(["Nombres", "Fecha de nacimiento", "Área"]);
    expect(legajosHoja.filas[0].every((c) => libro.estilos[c.estilo ?? 0]?.negrita)).toBe(true);

    const [nombre, fecha, area] = legajosHoja.filas[1];
    expect(nombre.texto).toBe("Ana");
    expect(fecha.texto).toBeNull();
    expect(fechaDeSerial(fecha.numero!)).toBe("1990-01-15");
    expect(libro.estilos[fecha.estilo!].formato).toBe("dd/mm/yyyy");
    expect(area.texto).toBe("Ventas");

    // Kept as a text cell, never a formula.
    expect(hijosHoja.filas[1][3]).toMatchObject({ texto: "'=Hijo", numero: null });
    expect(archivo.toString("latin1")).not.toContain("<f>");
  });
});
