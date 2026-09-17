import { z } from "zod";
import { copy } from "@/lib/copy/es-AR";
import {
  ESTADOS_CIVILES,
  ESTADOS_LABORALES,
  PARTIDO_OTRO,
  PARTIDOS,
} from "./options";

// Shared server validation for the legajo (PRD section 5).
// Groups A to D are editable by Empleado (own legajo) and Admin; group E by
// Admin only. Server Actions must validate with these schemas before writing.

const messages = copy.legajo.validation;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// Required text: trimmed, non-empty.
const requiredText = () =>
  z.string({ error: messages.required }).trim().min(1, { error: messages.required });

// Optional text: trimmed; empty becomes null.
const optionalText = () =>
  z
    .string({ error: messages.required })
    .trim()
    .nullish()
    .transform((value) => (value ? value : null));

// Required ISO date (YYYY-MM-DD).
const requiredDate = () =>
  requiredText().refine(isValidIsoDate, { error: messages.dateInvalid });

const option = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values, {
    error: (issue) =>
      issue.input === undefined || issue.input === null || issue.input === ""
        ? messages.required
        : messages.optionInvalid,
  });

// ---------------------------------------------------------------------------
// Group A: Datos personales
// ---------------------------------------------------------------------------
export const datosPersonalesShape = {
  nombres: requiredText(),
  apellido: requiredText(),
  dni: requiredText().regex(/^\d+$/, { error: messages.dniDigits }),
  nacionalidad: requiredText(),
  cuil: requiredText(),
  fecha_nacimiento: requiredDate(),
};

// ---------------------------------------------------------------------------
// Group B: Domicilio y contacto
// ---------------------------------------------------------------------------
export const domicilioContactoShape = {
  calle_altura: requiredText(),
  piso_depto: optionalText(),
  localidad: requiredText(),
  partido: option(PARTIDOS),
  partido_otro: optionalText(),
  telefono_celular: requiredText(),
  email_personal: requiredText().pipe(z.email({ error: messages.emailInvalid })),
};

// ---------------------------------------------------------------------------
// Group C: Datos familiares
// ---------------------------------------------------------------------------
export const hijoSchema = z.object({
  nombre_completo: requiredText(),
  fecha_nacimiento: requiredDate(),
});

export const datosFamiliaresShape = {
  estado_civil: option(ESTADOS_CIVILES),
  nombre_conyuge: optionalText(),
  tiene_hijos: z.boolean({ error: messages.required }),
  hijos: z.array(hijoSchema, { error: messages.required }),
};

// ---------------------------------------------------------------------------
// Group D: Datos de emergencia
// ---------------------------------------------------------------------------
export const datosEmergenciaShape = {
  grupo_sanguineo: requiredText(),
  alergias: requiredText(),
  medicacion_habitual: requiredText(),
  obra_social: requiredText(),
  numero_afiliado: requiredText(),
  emergencia_nombre: requiredText(),
  emergencia_parentesco: requiredText(),
  emergencia_domicilio: requiredText(),
  emergencia_telefono: requiredText(),
};

type PartidoInput = { partido: string; partido_otro: string | null };
type HijosInput = { tiene_hijos: boolean; hijos: unknown[] };

// Partido (otro) is required only when Partido = Otro, and not allowed otherwise.
function checkPartidoOtro(value: PartidoInput, ctx: z.RefinementCtx) {
  if (value.partido === PARTIDO_OTRO && !value.partido_otro) {
    ctx.addIssue({ code: "custom", path: ["partido_otro"], message: messages.partidoOtroRequired });
  }
  if (value.partido !== PARTIDO_OTRO && value.partido_otro) {
    ctx.addIssue({ code: "custom", path: ["partido_otro"], message: messages.partidoOtroNotAllowed });
  }
}

// At least one child when Tiene hijos = Sí; none when No.
function checkHijos(value: HijosInput, ctx: z.RefinementCtx) {
  if (value.tiene_hijos && value.hijos.length === 0) {
    ctx.addIssue({ code: "custom", path: ["hijos"], message: messages.hijosRequired });
  }
  if (!value.tiene_hijos && value.hijos.length > 0) {
    ctx.addIssue({ code: "custom", path: ["hijos"], message: messages.hijosNotAllowed });
  }
}

export const datosPersonalesSchema = z.object(datosPersonalesShape);
export const domicilioContactoSchema = z
  .object(domicilioContactoShape)
  .superRefine(checkPartidoOtro);
export const datosFamiliaresSchema = z.object(datosFamiliaresShape).superRefine(checkHijos);
export const datosEmergenciaSchema = z.object(datosEmergenciaShape);

// Groups A to D together: what an Empleado can edit on their own legajo.
export const legajoPersonalSchema = z
  .object({
    ...datosPersonalesShape,
    ...domicilioContactoShape,
    ...datosFamiliaresShape,
    ...datosEmergenciaShape,
  })
  .superRefine((value, ctx) => {
    checkPartidoOtro(value, ctx);
    checkHijos(value, ctx);
  });

// ---------------------------------------------------------------------------
// Group E: Datos laborales (Admin only)
// ---------------------------------------------------------------------------
export const datosLaboralesSchema = z.object({
  numero_legajo: requiredText(),
  area: requiredText(),
  puesto: requiredText(),
  fecha_ingreso: requiredDate(),
  estado_laboral: option(ESTADOS_LABORALES),
  sede: requiredText(),
  modalidad: requiredText(),
  convenio: requiredText(),
  bruto_mensual: z
    .number({ error: (issue) => (issue.input === undefined || issue.input === null ? messages.required : messages.numberInvalid) })
    .refine(Number.isFinite, { error: messages.numberInvalid })
    .min(0, { error: messages.brutoMensualNegative }),
});

export type LegajoPersonalInput = z.input<typeof legajoPersonalSchema>;
export type LegajoPersonal = z.output<typeof legajoPersonalSchema>;
export type DatosLaboralesInput = z.input<typeof datosLaboralesSchema>;
export type DatosLaborales = z.output<typeof datosLaboralesSchema>;
