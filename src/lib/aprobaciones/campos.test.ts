import { describe, expect, it } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import {
  datosEmergenciaShape,
  datosFamiliaresShape,
  datosLaboralesSchema,
  datosPersonalesShape,
  domicilioContactoShape,
  legajoPersonalSchema,
} from "@/lib/legajo/validation";
import { CAMPO_SOLICITUD_CODES, CAMPOS_SOLICITUD, isCampoSolicitud } from "./campos";

// Drift guard: the approvable fields are exactly the group A to D fields of
// the shared legajo validation, and never a group E field.

const sorted = (values: Iterable<string>) => [...values].sort();

describe("CAMPOS_SOLICITUD", () => {
  it("contains every group A to D field of the legajo validation, and nothing else", () => {
    const personalFields = Object.keys(legajoPersonalSchema.shape);
    expect(sorted(CAMPO_SOLICITUD_CODES)).toEqual(sorted(personalFields));
  });

  it("assigns each field to the group of its validation shape", () => {
    const groups = {
      A: Object.keys(datosPersonalesShape),
      B: Object.keys(domicilioContactoShape),
      C: Object.keys(datosFamiliaresShape),
      D: Object.keys(datosEmergenciaShape),
    };
    for (const [grupo, fields] of Object.entries(groups)) {
      const listed = CAMPOS_SOLICITUD.filter((config) => config.grupo === grupo).map(
        (config) => config.campo,
      );
      expect(sorted(listed), grupo).toEqual(sorted(fields));
    }
  });

  it("contains no group E field", () => {
    for (const field of Object.keys(datosLaboralesSchema.shape)) {
      expect(CAMPO_SOLICITUD_CODES, field).not.toContain(field);
      expect(isCampoSolicitud(field), field).toBe(false);
    }
  });

  it("never contains keys or timestamps", () => {
    for (const field of ["id", "profile_id", "created_at", "updated_at"]) {
      expect(isCampoSolicitud(field), field).toBe(false);
    }
  });

  it("has no duplicates", () => {
    expect(new Set(CAMPO_SOLICITUD_CODES).size).toBe(CAMPO_SOLICITUD_CODES.length);
  });

  it("has a non-empty es-AR label for every field", () => {
    for (const { campo, labelKey } of CAMPOS_SOLICITUD) {
      expect(copy.aprobaciones.campos[labelKey].trim(), campo).not.toBe("");
    }
  });
});
