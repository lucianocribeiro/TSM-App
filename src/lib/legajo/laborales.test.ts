import { describe, expect, it } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { formLaboralInicial, parseMonto, valoresLaborales } from "./laborales";
import { datosLaboralesSchema } from "./validation";

describe("parseMonto", () => {
  it("reads plain and es-AR formatted amounts", () => {
    expect(parseMonto("850000")).toBe(850000);
    expect(parseMonto("850000.5")).toBe(850000.5);
    expect(parseMonto("850.000")).toBe(850000);
    expect(parseMonto("1.250.000,75")).toBe(1250000.75);
    expect(parseMonto("850000,5")).toBe(850000.5);
    expect(parseMonto(" $ 850.000 ")).toBe(850000);
    expect(parseMonto("-10")).toBe(-10);
  });

  it("gives undefined for empty and NaN for anything else", () => {
    expect(parseMonto("")).toBeUndefined();
    expect(parseMonto("   ")).toBeUndefined();
    expect(parseMonto("abc")).toBeNaN();
    expect(parseMonto("1,2,3")).toBeNaN();
  });
});

describe("group E form", () => {
  const legajo = {
    numero_legajo: "L-1",
    area: "Operaciones",
    puesto: "Chofer",
    fecha_ingreso: "2020-03-01",
    estado_laboral: "activo" as const,
    sede: "San Martín",
    modalidad: "Presencial",
    convenio: "Camioneros",
    bruto_mensual: 850000.5,
  };

  it("starts from the stored values, empty text for nulls", () => {
    expect(formLaboralInicial(legajo)).toMatchObject({ numero_legajo: "L-1", bruto_mensual: "850000.5" });
    expect(formLaboralInicial({ ...legajo, estado_laboral: null, bruto_mensual: null })).toMatchObject({
      estado_laboral: "",
      bruto_mensual: "",
    });
  });

  it("round-trips through the shared schema", () => {
    const parsed = datosLaboralesSchema.safeParse(valoresLaborales(formLaboralInicial(legajo)));
    expect(parsed.success && parsed.data).toEqual(legajo);
  });

  it("reports missing and invalid values with the shared messages", () => {
    const form = { ...formLaboralInicial(legajo), estado_laboral: "", bruto_mensual: "mucho" };
    const parsed = datosLaboralesSchema.safeParse(valoresLaborales(form));
    expect(parsed.success).toBe(false);
    const messages = parsed.success ? [] : parsed.error.issues.map((issue) => [issue.path[0], issue.message]);
    expect(messages).toEqual(
      expect.arrayContaining([
        ["estado_laboral", copy.legajo.validation.required],
        ["bruto_mensual", copy.legajo.validation.numberInvalid],
      ]),
    );
  });
});
