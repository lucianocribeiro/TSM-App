import { describe, expect, it } from "vitest";
import { armarBandeja, rutaItem, type EmpleadoFila } from "./bandeja";

const ADMIN = "admin-1";
const empleado = (id: string, estado: "activa" | "inactiva" = "activa"): EmpleadoFila => ({
  profile_id: id,
  nombres: "Prueba",
  apellido: id,
  numero_legajo: `L-${id}`,
  profiles: { estado_cuenta: estado },
});

describe("armarBandeja", () => {
  const items = armarBandeja(
    [
      { id: "s2", created_at: "2026-09-20T10:00:00+00:00", solicitudes_cambio_items: [{ campo: "alergias" }, { campo: "cuil" }], legajos: empleado("e1") },
      { id: "s1", created_at: "2026-09-18T10:00:00+00:00", solicitudes_cambio_items: [{ campo: "hijos" }], legajos: empleado(ADMIN) },
    ],
    [{ id: "d1", tipo: "dni_frente", created_at: "2026-09-19T10:00:00+00:00", legajos: empleado("e2", "inactiva") }],
    ADMIN,
  );

  it("mixes requests and documents, oldest first", () => {
    expect(items.map((item) => item.id)).toEqual(["s1", "d1", "s2"]);
  });

  it("describes what is pending and who it belongs to", () => {
    expect(items[2]).toMatchObject({ clase: "solicitud", grupos: ["A", "D"], nombre: "Prueba e1", numeroLegajo: "L-e1", dadoDeBaja: false, propio: false });
    expect(items[1]).toMatchObject({ clase: "documento", tipo: "dni_frente", dadoDeBaja: true, profileId: "e2" });
    expect(items[0]).toMatchObject({ propio: true, grupos: ["C"] });
  });

  it("links each item to its detail", () => {
    expect(rutaItem({ clase: "solicitud", id: "x" })).toBe("/aprobaciones/solicitudes/x");
    expect(rutaItem({ clase: "documento", id: "y" })).toBe("/aprobaciones/documentos/y");
  });
});
