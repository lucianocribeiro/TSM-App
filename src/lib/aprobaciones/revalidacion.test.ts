import { describe, expect, it } from "vitest";
import { legajoActual } from "./fixtures.test-helpers";
import { revalidarSolicitud } from "./revalidacion";
import { serializeHijos } from "./solicitudes";

describe("revalidarSolicitud", () => {
  it("accepts valid submitted values", () => {
    expect(
      revalidarSolicitud(
        [
          { campo: "cuil", valorPropuesto: "27-90000002-8" },
          { campo: "telefono_celular", valorPropuesto: "+54 11 5555-6666" },
        ],
        legajoActual(),
      ),
    ).toEqual({ ok: true });
  });

  it("refuses a CUIL that no longer passes the prefix rule (PRD 5.7)", () => {
    expect(revalidarSolicitud([{ campo: "cuil", valorPropuesto: "30-12345678-1" }], legajoActual())).toEqual({
      ok: false,
      campos: ["cuil"],
    });
  });

  it("reports every invalid submitted field in page order", () => {
    const result = revalidarSolicitud(
      [
        { campo: "emergencia_telefono", valorPropuesto: "12" },
        { campo: "dni", valorPropuesto: "12.345.678" },
        { campo: "fecha_nacimiento", valorPropuesto: "2999-01-01" },
      ],
      legajoActual(),
    );
    expect(result).toEqual({ ok: false, campos: ["dni", "fecha_nacimiento", "emergencia_telefono"] });
  });

  it("does not block on an old value the employee did not submit", () => {
    const actual = legajoActual({ cuil: "30-12345678-1" });
    expect(revalidarSolicitud([{ campo: "nombres", valorPropuesto: "Otra" }], actual)).toEqual({ ok: true });
  });

  it("applies cross-field rules to the resulting legajo", () => {
    expect(revalidarSolicitud([{ campo: "partido", valorPropuesto: "Otro" }], legajoActual())).toEqual({
      ok: false,
      campos: ["partido_otro"],
    });
    expect(
      revalidarSolicitud(
        [
          { campo: "partido", valorPropuesto: "Otro" },
          { campo: "partido_otro", valorPropuesto: "Partido Ficticio" },
        ],
        legajoActual(),
      ),
    ).toEqual({ ok: true });
    // Tiene hijos = No with children still present.
    expect(revalidarSolicitud([{ campo: "tiene_hijos", valorPropuesto: "false" }], legajoActual())).toEqual({
      ok: false,
      campos: ["hijos"],
    });
    expect(
      revalidarSolicitud(
        [
          { campo: "tiene_hijos", valorPropuesto: "false" },
          { campo: "hijos", valorPropuesto: "[]" },
        ],
        legajoActual(),
      ),
    ).toEqual({ ok: true });
  });

  it("validates the children set", () => {
    const hijos = serializeHijos([{ nombre_completo: "Futuro", fecha_nacimiento: "2999-01-01" }]);
    expect(revalidarSolicitud([{ campo: "hijos", valorPropuesto: hijos }], legajoActual())).toEqual({
      ok: false,
      campos: ["hijos"],
    });
  });
});
