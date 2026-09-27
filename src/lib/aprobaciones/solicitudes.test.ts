import { describe, expect, it } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { legajoPersonalSchema, type LegajoPersonal } from "@/lib/legajo/validation";
import {
  buildSolicitudItems,
  buildSolicitudItemsDe,
  decisionErrorMessage,
  DOCUMENTO_PENDIENTE_INDEX,
  documentoErrorMessage,
  parseHijosValor,
  serializeHijos,
  serializeValor,
  SOLICITUD_PENDIENTE_INDEX,
  solicitudErrorMessage,
  type LegajoActual,
} from "./solicitudes";

const actual: LegajoActual = {
  nombres: "Prueba",
  apellido: "Ficticio",
  dni: "90000002",
  nacionalidad: "Argentina",
  cuil: "27-90000002-8",
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

  it("builds the crear_solicitud p_items payload, skipping unchanged fields", () => {
    const form = { ...unchangedForm(), telefono_celular: "1100000022", alergias: "Polen" };
    const items = buildSolicitudItems(form, actual);
    expect(items).toEqual([
      { campo: "telefono_celular", valor_propuesto: "1100000022" },
      { campo: "alergias", valor_propuesto: "Polen" },
    ]);
    // Exactly the two keys crear_solicitud accepts; the database fills valor_anterior.
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(["campo", "valor_propuesto"]);
    }
  });

  it("proposes null to clear an optional field", () => {
    const form = { ...unchangedForm(), piso_depto: null };
    expect(buildSolicitudItems(form, actual)).toEqual([{ campo: "piso_depto", valor_propuesto: null }]);
  });

  it("detects a change when the current value is empty", () => {
    const form = unchangedForm();
    const empty: LegajoActual = { ...actual, nombre_conyuge: null };
    expect(buildSolicitudItems(form, empty)).toEqual([
      { campo: "nombre_conyuge", valor_propuesto: "Cónyuge Ficticio" },
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
      { campo: "fecha_nacimiento", valor_propuesto: "1991-02-03" },
      { campo: "estado_civil", valor_propuesto: "soltero" },
      { campo: "tiene_hijos", valor_propuesto: "false" },
      { campo: "hijos", valor_propuesto: "[]" },
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

describe("error messages", () => {
  const messages = copy.aprobaciones.errors;
  const duplicate = (index: string) => ({
    code: "23505",
    message: `duplicate key value violates unique constraint "${index}"`,
  });

  it("explains a second pending request", () => {
    expect(solicitudErrorMessage(duplicate(SOLICITUD_PENDIENTE_INDEX))).toBe(messages.solicitudPendiente);
    expect(solicitudErrorMessage({ code: "22023" })).toBe(messages.guardarFallo);
    expect(solicitudErrorMessage({ code: "42501", message: "permission denied" })).toBe(messages.guardarFallo);
  });

  it("explains a second pending document", () => {
    expect(documentoErrorMessage(duplicate(DOCUMENTO_PENDIENTE_INDEX))).toBe(messages.documentoPendiente);
    expect(documentoErrorMessage(duplicate(SOLICITUD_PENDIENTE_INDEX))).toBe(messages.guardarFallo);
  });

  it("maps decision errors and falls back to a generic message", () => {
    expect(decisionErrorMessage({ code: "22023" })).toBe(messages.motivoRequerido);
    expect(decisionErrorMessage({ code: "55000" })).toBe(messages.noPendiente);
    expect(decisionErrorMessage({ code: "42501", message: "permission denied" })).toBe(messages.guardarFallo);
    expect(decisionErrorMessage(null)).toBe(messages.guardarFallo);
  });
});

describe("buildSolicitudItemsDe (partial edit)", () => {
  it("compares only the listed fields and needs values only for them", () => {
    const items = buildSolicitudItemsDe(
      ["telefono_celular", "email_personal", "partido", "partido_otro"],
      { telefono_celular: "11 5555-0000", email_personal: actual.email_personal ?? "", partido: "Tigre", partido_otro: null },
      actual,
    );
    expect(items).toEqual([
      { campo: "telefono_celular", valor_propuesto: "11 5555-0000" },
      { campo: "partido", valor_propuesto: "Tigre" },
      { campo: "partido_otro", valor_propuesto: null },
    ]);
  });

  it("sends the children set as one field", () => {
    const items = buildSolicitudItemsDe(
      ["tiene_hijos", "hijos"],
      { tiene_hijos: true, hijos: [...actual.hijos, { nombre_completo: "Nueva", fecha_nacimiento: "2023-03-03" }] },
      actual,
    );
    expect(items.map((item) => item.campo)).toEqual(["hijos"]);
    expect(parseHijosValor(items[0].valor_propuesto)).toHaveLength(3);
  });

  it("returns nothing when the listed fields did not change", () => {
    expect(buildSolicitudItemsDe(["nombres", "apellido"], { nombres: actual.nombres ?? "", apellido: actual.apellido ?? "" }, actual)).toEqual([]);
  });
});
