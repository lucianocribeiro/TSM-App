import { describe, expect, it } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import type { LegajoActual } from "@/lib/aprobaciones/solicitudes";
import { formInicial, legajoVacio, mostrarValor, textoAntiguedad, valoresDelForm } from "./vista";

const t = copy.miLegajo;

describe("mostrarValor", () => {
  it("formats each kind of field and shows empties as Sin completar", () => {
    expect(mostrarValor("nombres", null)).toBe(t.sinDato);
    expect(mostrarValor("nombres", "")).toBe(t.sinDato);
    expect(mostrarValor("fecha_nacimiento", "1990-07-01")).toBe("01/07/1990");
    expect(mostrarValor("estado_civil", "union_convivencial")).toBe("Unión Convivencial");
    expect(mostrarValor("tiene_hijos", "true")).toBe("Sí");
    expect(mostrarValor("tiene_hijos", "false")).toBe("No");
    expect(mostrarValor("hijos", "[]")).toBe(t.hijos.ninguno);
    expect(mostrarValor("hijos", '[{"nombre_completo":"Ana","fecha_nacimiento":"2015-04-10"}]')).toBe("Ana (10/04/2015)");
    expect(mostrarValor("cuil", "27-90000002-8")).toBe("27-90000002-8");
  });
});

describe("textoAntiguedad", () => {
  it("reads naturally in es-AR", () => {
    expect(textoAntiguedad({ anios: 0, meses: 0 })).toBe("Menos de un mes");
    expect(textoAntiguedad({ anios: 1, meses: 0 })).toBe("1 año");
    expect(textoAntiguedad({ anios: 0, meses: 1 })).toBe("1 mes");
    expect(textoAntiguedad({ anios: 5, meses: 3 })).toBe("5 años y 3 meses");
    expect(textoAntiguedad(null)).toBe(t.sinDato);
  });
});

describe("legajoVacio", () => {
  it("is true only when no data column has a value and there are no children", () => {
    expect(legajoVacio({ id: "x", profile_id: "y", nombres: null, created_at: "z" }, [])).toBe(true);
    expect(legajoVacio({ id: "x", nombres: "Ana" }, [])).toBe(false);
    expect(legajoVacio({ id: "x", nombres: null }, [{ nombre_completo: "A", fecha_nacimiento: "2015-01-01" }])).toBe(false);
  });
});

describe("form values", () => {
  const actual = { tiene_hijos: true, estado_civil: "casado", nombre_conyuge: null, hijos: [{ nombre_completo: "A", fecha_nacimiento: "2015-01-01" }] } as unknown as LegajoActual;

  it("starts from the current values, with tiene_hijos as si/no", () => {
    expect(formInicial(["estado_civil", "nombre_conyuge", "tiene_hijos", "hijos"], actual)).toEqual({
      campos: { estado_civil: "casado", nombre_conyuge: "", tiene_hijos: "si" },
      hijos: [{ nombre_completo: "A", fecha_nacimiento: "2015-01-01" }],
    });
  });

  it("sends the children only when tiene_hijos is si, and a boolean for it", () => {
    const form = { campos: { estado_civil: "casado", nombre_conyuge: "", tiene_hijos: "no" }, hijos: actual.hijos };
    expect(valoresDelForm("C", form)).toMatchObject({ tiene_hijos: false, hijos: [] });
    expect(valoresDelForm("C", { ...form, campos: { ...form.campos, tiene_hijos: "si" } })).toMatchObject({ tiene_hijos: true, hijos: actual.hijos });
    expect(valoresDelForm("C", { ...form, campos: { ...form.campos, tiene_hijos: "" } }).tiene_hijos).toBeUndefined();
  });

  it("drops partido_otro unless partido is Otro", () => {
    expect(valoresDelForm("B", { campos: { partido: "Tigre", partido_otro: "x" }, hijos: [] }).partido_otro).toBeNull();
    expect(valoresDelForm("B", { campos: { partido: "Otro", partido_otro: "x" }, hijos: [] }).partido_otro).toBe("x");
  });
});
