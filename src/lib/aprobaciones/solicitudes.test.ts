import { describe, expect, it } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { legajoPersonalSchema, type LegajoPersonal } from "@/lib/legajo/validation";
import {
  aprobacionErrorMessage,
  buildSolicitudItems,
  DOCUMENTO_PENDIENTE_INDEX,
  parseHijosValor,
  serializeHijos,
  serializeValor,
  SOLICITUD_PENDIENTE_INDEX,
  type LegajoActual,
} from "./solicitudes";

const actual: LegajoActual = {
  nombres: "Prueba",
  apellido: "Ficticio",
  dni: "90000002",
  nacionalidad: "Argentina",
  cuil: "27900000022",
  fecha_nacimiento: "1990-07-01",
  calle_altura: "Avenida Inventada 456",
  piso_depto: "3° B",
  localidad: "Barrio de Prueba",
  partido: "Otro",
  partido_otro: "Partido Ficticio",
  telefono_celular: "1100000002",
  email_personal: "prueba@example.test",
  estado_civil: "casado",
  nombre_conyuge: "Cónyuge Ficticio",
  tiene_hijos: true,
  grupo_sanguineo: "A+",
  alergias: "Ninguna",
  medicacion_habitual: "Ninguna",
  obra_social: "Prepaga de Prueba",
  numero_afiliado: "TEST-0002",
  emergencia_nombre: "Contacto Ficticio",
  emergencia_parentesco: "Hermana",
  emergencia_domicilio: "Avenida Inventada 789",
  emergencia_telefono: "1100000102",
  hijos: [
    { nombre_completo: "Hija Ficticia Dos", fecha_nacimiento: "2019-12-05" },
    { nombre_completo: "Hijo Ficticio Uno", fecha_nacimiento: "2015-04-10" },
  ],
};

// A validated form value set equal to the current legajo.
function unchangedForm(): LegajoPersonal {
  return legajoPersonalSchema.parse({
    ...actual,
    hijos: actual.hijos.map((hijo) => ({ ...hijo })),
  });
}

describe("buildSolicitudItems", () => {
  it("returns no items when nothing changed, whatever the children order", () => {
    const form = unchangedForm();
    form.hijos.reverse();
    expect(buildSolicitudItems(form, actual)).toEqual([]);
  });

  it("skips unchanged fields and records the current value as valor_anterior", () => {
    const form = { ...unchangedForm(), telefono_celular: "1100000022", alergias: "Polen" };
    expect(buildSolicitudItems(form, actual)).toEqual([
      { campo: "telefono_celular", valor_propuesto: "1100000022", valor_anterior: "1100000002" },
      { campo: "alergias", valor_propuesto: "Polen", valor_anterior: "Ninguna" },
    ]);
  });

  it("proposes null to clear an optional field", () => {
    const form = { ...unchangedForm(), piso_depto: null };
    expect(buildSolicitudItems(form, actual)).toEqual([
      { campo: "piso_depto", valor_propuesto: null, valor_anterior: "3° B" },
    ]);
  });

  it("uses null as valor_anterior when the current value is empty", () => {
    const form = unchangedForm();
    const empty: LegajoActual = { ...actual, nombre_conyuge: null };
    expect(buildSolicitudItems(form, empty)).toEqual([
      { campo: "nombre_conyuge", valor_propuesto: "Cónyuge Ficticio", valor_anterior: null },
    ]);
  });

  it("serialises booleans, enum codes and dates as the database stores them", () => {
    const form = {
      ...unchangedForm(),
      tiene_hijos: false,
      hijos: [],
      estado_civil: "soltero" as const,
      fecha_nacimiento: "1991-02-03",
    };
    const items = buildSolicitudItems(form, actual);
    expect(items).toEqual([
      { campo: "fecha_nacimiento", valor_propuesto: "1991-02-03", valor_anterior: "1990-07-01" },
      { campo: "estado_civil", valor_propuesto: "soltero", valor_anterior: "casado" },
      { campo: "tiene_hijos", valor_propuesto: "false", valor_anterior: "true" },
      {
        campo: "hijos",
        valor_propuesto: "[]",
        valor_anterior: serializeHijos(actual.hijos),
      },
    ]);
  });

  it("serialises the whole children set when one child changes", () => {
    const form = unchangedForm();
    form.hijos.push({ nombre_completo: "Hijo Ficticio Tres", fecha_nacimiento: "2022-01-01" });
    const [item] = buildSolicitudItems(form, actual);
    expect(item.campo).toBe("hijos");
    expect(parseHijosValor(item.valor_propuesto)).toEqual([
      { nombre_completo: "Hijo Ficticio Uno", fecha_nacimiento: "2015-04-10" },
      { nombre_completo: "Hija Ficticia Dos", fecha_nacimiento: "2019-12-05" },
      { nombre_completo: "Hijo Ficticio Tres", fecha_nacimiento: "2022-01-01" },
    ]);
  });
});

describe("hijos serialisation", () => {
  it("is canonical: sorted by birth date, then name, with only the two keys", () => {
    const withExtra = [
      { nombre_completo: "B", fecha_nacimiento: "2020-01-01", extra: "x" },
      { nombre_completo: "A", fecha_nacimiento: "2020-01-01" },
      { nombre_completo: "C", fecha_nacimiento: "2010-05-05" },
    ];
    expect(serializeHijos(withExtra)).toBe(
      '[{"nombre_completo":"C","fecha_nacimiento":"2010-05-05"},' +
        '{"nombre_completo":"A","fecha_nacimiento":"2020-01-01"},' +
        '{"nombre_completo":"B","fecha_nacimiento":"2020-01-01"}]',
    );
    expect(serializeHijos([])).toBe("[]");
  });

  it("round-trips through parseHijosValor, including the database's own formatting", () => {
    const hijos = [{ nombre_completo: "Hijo", fecha_nacimiento: "2015-04-10" }];
    expect(parseHijosValor(serializeHijos(hijos))).toEqual(hijos);
    // jsonb::text output, as public.set_solicitud_item_valor_anterior stores it.
    expect(
      parseHijosValor('[{"nombre_completo": "Hijo", "fecha_nacimiento": "2015-04-10"}]'),
    ).toEqual(hijos);
  });

  it("rejects values without the expected shape", () => {
    const invalid = [
      null,
      "not json",
      "{}",
      '[{"nombre_completo":"Hijo"}]',
      '[{"nombre_completo":"Hijo","fecha_nacimiento":"2015-02-30"}]',
      '[{"nombre_completo":"  ","fecha_nacimiento":"2015-04-10"}]',
      '[{"nombre_completo":"Hijo","fecha_nacimiento":"2015-04-10","dni":"1"}]',
    ];
    for (const value of invalid) {
      expect(parseHijosValor(value), String(value)).toBeNull();
    }
  });
});

describe("serializeValor", () => {
  it("maps values to their stored text", () => {
    expect(serializeValor(null)).toBeNull();
    expect(serializeValor(undefined)).toBeNull();
    expect(serializeValor(true)).toBe("true");
    expect(serializeValor(false)).toBe("false");
    expect(serializeValor("texto")).toBe("texto");
  });
});

describe("aprobacionErrorMessage", () => {
  const messages = copy.aprobaciones.errors;

  it("explains a second pending request or document", () => {
    expect(
      aprobacionErrorMessage({
        code: "23505",
        message: `duplicate key value violates unique constraint "${SOLICITUD_PENDIENTE_INDEX}"`,
      }),
    ).toBe(messages.solicitudPendiente);
    expect(
      aprobacionErrorMessage({
        code: "23505",
        message: `duplicate key value violates unique constraint "${DOCUMENTO_PENDIENTE_INDEX}"`,
      }),
    ).toBe(messages.documentoPendiente);
  });

  it("maps decision errors and falls back to a generic message", () => {
    expect(aprobacionErrorMessage({ code: "22023" })).toBe(messages.motivoRequerido);
    expect(aprobacionErrorMessage({ code: "55000" })).toBe(messages.noPendiente);
    expect(aprobacionErrorMessage({ code: "42501", message: "permission denied" })).toBe(
      messages.guardarFallo,
    );
    expect(aprobacionErrorMessage(null)).toBe(messages.guardarFallo);
  });
});
