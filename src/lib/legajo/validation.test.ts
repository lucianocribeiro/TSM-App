import { describe, expect, it } from "vitest";
import { copy } from "@/lib/copy/es-AR";
import { PARTIDOS } from "./options";
import {
  datosFamiliaresSchema,
  datosLaboralesSchema,
  domicilioContactoSchema,
  legajoPersonalSchema,
} from "./validation";

const m = copy.legajo.validation;

function validPersonal() {
  return {
    nombres: "Prueba",
    apellido: "Ficticio",
    dni: "90000002",
    nacionalidad: "Argentina",
    cuil: "27900000022",
    fecha_nacimiento: "1990-07-01",
    calle_altura: "Avenida Inventada 456",
    piso_depto: "3° B",
    localidad: "Barrio de Prueba",
    partido: "Tigre",
    partido_otro: null as string | null,
    telefono_celular: "1100000002",
    email_personal: "prueba@example.test",
    estado_civil: "soltero",
    nombre_conyuge: null as string | null,
    tiene_hijos: true,
    hijos: [{ nombre_completo: "Hijo Ficticio", fecha_nacimiento: "2015-04-10" }],
    grupo_sanguineo: "A+",
    alergias: "Ninguna",
    medicacion_habitual: "Ninguna",
    obra_social: "Obra Social de Prueba",
    numero_afiliado: "TEST-0002",
    emergencia_nombre: "Contacto Ficticio",
    emergencia_parentesco: "Hermana",
    emergencia_domicilio: "Calle Falsa 123",
    emergencia_telefono: "1100000102",
  };
}

function validLaboral() {
  return {
    numero_legajo: "TEST-002",
    area: "Operaciones",
    puesto: "Técnico",
    fecha_ingreso: "2021-09-15",
    estado_laboral: "activo",
    sede: "Sede de Prueba",
    modalidad: "Presencial",
    convenio: "Convenio de Prueba",
    bruto_mensual: 950000,
  };
}

function issuesFor(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }, field: string) {
  return (result.error?.issues ?? []).filter((issue) => issue.path[0] === field).map((i) => i.message);
}

const REQUIRED_PERSONAL = [
  "nombres", "apellido", "dni", "nacionalidad", "cuil", "fecha_nacimiento",
  "calle_altura", "localidad", "partido", "telefono_celular", "email_personal",
  "estado_civil", "tiene_hijos",
  "grupo_sanguineo", "alergias", "medicacion_habitual", "obra_social", "numero_afiliado",
  "emergencia_nombre", "emergencia_parentesco", "emergencia_domicilio", "emergencia_telefono",
] as const;

const REQUIRED_LABORAL = [
  "numero_legajo", "area", "puesto", "fecha_ingreso", "estado_laboral",
  "sede", "modalidad", "convenio", "bruto_mensual",
] as const;

describe("legajoPersonalSchema (groups A to D)", () => {
  it("accepts a valid payload and normalizes optional text", () => {
    const result = legajoPersonalSchema.safeParse({ ...validPersonal(), piso_depto: "  ", nombres: "  Prueba " });
    expect(result.success).toBe(true);
    expect(result.data?.piso_depto).toBeNull();
    expect(result.data?.nombres).toBe("Prueba");
  });

  it("accepts optional fields left empty", () => {
    const result = legajoPersonalSchema.safeParse({ ...validPersonal(), piso_depto: null, nombre_conyuge: "" });
    expect(result.success).toBe(true);
  });

  it.each(REQUIRED_PERSONAL)("fails when %s is missing", (field) => {
    const payload: Record<string, unknown> = validPersonal();
    delete payload[field];
    const result = legajoPersonalSchema.safeParse(payload);
    expect(result.success).toBe(false);
    expect(issuesFor(result, field)).toContain(m.required);
  });

  it.each(REQUIRED_PERSONAL.filter((f) => f !== "tiene_hijos"))("fails when %s is blank", (field) => {
    const result = legajoPersonalSchema.safeParse({ ...validPersonal(), [field]: "   " });
    expect(result.success).toBe(false);
    expect(issuesFor(result, field).length).toBeGreaterThan(0);
  });

  it("rejects a DNI with dots, spaces or letters", () => {
    for (const dni of ["30.000.000", "30 000 000", "30A00000"]) {
      const result = legajoPersonalSchema.safeParse({ ...validPersonal(), dni });
      expect(issuesFor(result, "dni")).toContain(m.dniDigits);
    }
  });

  it("rejects an invalid personal email", () => {
    const result = legajoPersonalSchema.safeParse({ ...validPersonal(), email_personal: "no-es-un-mail" });
    expect(issuesFor(result, "email_personal")).toContain(m.emailInvalid);
  });

  it("rejects invalid dates", () => {
    for (const fecha of ["1990-02-30", "01/07/1990", "1990-13-01"]) {
      const result = legajoPersonalSchema.safeParse({ ...validPersonal(), fecha_nacimiento: fecha });
      expect(issuesFor(result, "fecha_nacimiento")).toContain(m.dateInvalid);
    }
  });

  it("rejects values outside the option lists", () => {
    const partido = legajoPersonalSchema.safeParse({ ...validPersonal(), partido: "Rosario" });
    expect(issuesFor(partido, "partido")).toContain(m.optionInvalid);
    const estado = legajoPersonalSchema.safeParse({ ...validPersonal(), estado_civil: "Soltero" });
    expect(issuesFor(estado, "estado_civil")).toContain(m.optionInvalid);
  });

  it("accepts every partido from PRD 5.2", () => {
    for (const partido of PARTIDOS) {
      const payload = { ...validPersonal(), partido, partido_otro: partido === "Otro" ? "Partido Ficticio" : null };
      expect(legajoPersonalSchema.safeParse(payload).success, partido).toBe(true);
    }
  });

  it("requires partido_otro when partido is Otro", () => {
    for (const partido_otro of [null, "", "   "]) {
      const result = legajoPersonalSchema.safeParse({ ...validPersonal(), partido: "Otro", partido_otro });
      expect(issuesFor(result, "partido_otro")).toContain(m.partidoOtroRequired);
    }
  });

  it("rejects partido_otro when partido is not Otro", () => {
    const result = legajoPersonalSchema.safeParse({ ...validPersonal(), partido: "Tigre", partido_otro: "Algo" });
    expect(issuesFor(result, "partido_otro")).toContain(m.partidoOtroNotAllowed);
  });

  it("requires at least one child when tiene_hijos is true", () => {
    const result = legajoPersonalSchema.safeParse({ ...validPersonal(), tiene_hijos: true, hijos: [] });
    expect(issuesFor(result, "hijos")).toContain(m.hijosRequired);
  });

  it("rejects children when tiene_hijos is false", () => {
    const result = legajoPersonalSchema.safeParse({ ...validPersonal(), tiene_hijos: false });
    expect(issuesFor(result, "hijos")).toContain(m.hijosNotAllowed);
    expect(legajoPersonalSchema.safeParse({ ...validPersonal(), tiene_hijos: false, hijos: [] }).success).toBe(true);
  });

  it("requires nombre_completo and a valid fecha_nacimiento for each child", () => {
    const result = legajoPersonalSchema.safeParse({
      ...validPersonal(),
      hijos: [{ nombre_completo: " ", fecha_nacimiento: "2015-02-31" }],
    });
    const messages = (result.error?.issues ?? []).filter((i) => i.path[0] === "hijos").map((i) => i.message);
    expect(messages).toContain(m.required);
    expect(messages).toContain(m.dateInvalid);
  });
});

describe("group schemas", () => {
  it("domicilioContactoSchema applies the partido_otro rule", () => {
    const { partido, partido_otro, calle_altura, piso_depto, localidad, telefono_celular, email_personal } = validPersonal();
    const base = { partido, partido_otro, calle_altura, piso_depto, localidad, telefono_celular, email_personal };
    expect(domicilioContactoSchema.safeParse(base).success).toBe(true);
    expect(domicilioContactoSchema.safeParse({ ...base, partido: "Otro" }).success).toBe(false);
  });

  it("datosFamiliaresSchema applies the children rule", () => {
    const { estado_civil, nombre_conyuge, tiene_hijos, hijos } = validPersonal();
    const base = { estado_civil, nombre_conyuge, tiene_hijos, hijos };
    expect(datosFamiliaresSchema.safeParse(base).success).toBe(true);
    expect(datosFamiliaresSchema.safeParse({ ...base, hijos: [] }).success).toBe(false);
  });
});

describe("datosLaboralesSchema (group E)", () => {
  it("accepts a valid payload, including zero salary", () => {
    expect(datosLaboralesSchema.safeParse(validLaboral()).success).toBe(true);
    expect(datosLaboralesSchema.safeParse({ ...validLaboral(), bruto_mensual: 0 }).success).toBe(true);
  });

  it.each(REQUIRED_LABORAL)("fails when %s is missing", (field) => {
    const payload: Record<string, unknown> = validLaboral();
    delete payload[field];
    const result = datosLaboralesSchema.safeParse(payload);
    expect(result.success).toBe(false);
    expect(issuesFor(result, field)).toContain(m.required);
  });

  it("rejects a negative bruto_mensual", () => {
    const result = datosLaboralesSchema.safeParse({ ...validLaboral(), bruto_mensual: -1 });
    expect(issuesFor(result, "bruto_mensual")).toContain(m.brutoMensualNegative);
  });

  it("rejects a non-numeric bruto_mensual", () => {
    for (const bruto_mensual of ["950000", Number.NaN]) {
      const result = datosLaboralesSchema.safeParse({ ...validLaboral(), bruto_mensual });
      expect(issuesFor(result, "bruto_mensual")).toContain(m.numberInvalid);
    }
  });

  it("rejects an invalid estado_laboral", () => {
    for (const estado_laboral of ["en_licencia", "Activo"]) {
      const result = datosLaboralesSchema.safeParse({ ...validLaboral(), estado_laboral });
      expect(issuesFor(result, "estado_laboral")).toContain(m.optionInvalid);
    }
  });

  it("rejects an invalid fecha_ingreso", () => {
    const result = datosLaboralesSchema.safeParse({ ...validLaboral(), fecha_ingreso: "2021-02-29" });
    expect(issuesFor(result, "fecha_ingreso")).toContain(m.dateInvalid);
  });
});
