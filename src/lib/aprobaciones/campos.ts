import type { Copy } from "@/lib/copy/es-AR";
import type { Database } from "@/lib/supabase/database.types";

// Fields an Empleado can change through a change request (Constitution §9,
// PRD US-7): the group A to D data columns of public.legajos plus "hijos",
// the whole children set as one field. Never group E, id, profile_id or
// timestamps.
//
// Kept in sync with:
// - the legajo validation shapes (src/lib/legajo/validation.ts), by the unit
//   test in campos.test.ts;
// - public.campos_solicitud_permitidos() in the database, by the integration
//   test in tests/integration/aprobaciones-rls.test.ts.

type LegajoRow = Database["public"]["Tables"]["legajos"]["Row"];

export type CampoGrupo = "A" | "B" | "C" | "D";

// A legajo column, or "hijos" (stored in public.legajo_hijos).
export type CampoLegajo = Extract<keyof LegajoRow, string>;
export type CampoSolicitudCodigo = CampoLegajo | "hijos";

export type CampoSolicitudConfig = {
  campo: CampoSolicitudCodigo;
  grupo: CampoGrupo;
  labelKey: keyof Copy["aprobaciones"]["campos"];
};

export const CAMPOS_SOLICITUD = [
  // Group A: Datos personales
  { campo: "nombres", grupo: "A", labelKey: "nombres" },
  { campo: "apellido", grupo: "A", labelKey: "apellido" },
  { campo: "dni", grupo: "A", labelKey: "dni" },
  { campo: "nacionalidad", grupo: "A", labelKey: "nacionalidad" },
  { campo: "cuil", grupo: "A", labelKey: "cuil" },
  { campo: "fecha_nacimiento", grupo: "A", labelKey: "fecha_nacimiento" },
  // Group B: Domicilio y contacto
  { campo: "calle_altura", grupo: "B", labelKey: "calle_altura" },
  { campo: "piso_depto", grupo: "B", labelKey: "piso_depto" },
  { campo: "localidad", grupo: "B", labelKey: "localidad" },
  { campo: "partido", grupo: "B", labelKey: "partido" },
  { campo: "partido_otro", grupo: "B", labelKey: "partido_otro" },
  { campo: "telefono_celular", grupo: "B", labelKey: "telefono_celular" },
  { campo: "email_personal", grupo: "B", labelKey: "email_personal" },
  // Group C: Datos familiares
  { campo: "estado_civil", grupo: "C", labelKey: "estado_civil" },
  { campo: "nombre_conyuge", grupo: "C", labelKey: "nombre_conyuge" },
  { campo: "tiene_hijos", grupo: "C", labelKey: "tiene_hijos" },
  { campo: "hijos", grupo: "C", labelKey: "hijos" },
  // Group D: Datos de emergencia
  { campo: "grupo_sanguineo", grupo: "D", labelKey: "grupo_sanguineo" },
  { campo: "alergias", grupo: "D", labelKey: "alergias" },
  { campo: "medicacion_habitual", grupo: "D", labelKey: "medicacion_habitual" },
  { campo: "obra_social", grupo: "D", labelKey: "obra_social" },
  { campo: "numero_afiliado", grupo: "D", labelKey: "numero_afiliado" },
  { campo: "emergencia_nombre", grupo: "D", labelKey: "emergencia_nombre" },
  { campo: "emergencia_parentesco", grupo: "D", labelKey: "emergencia_parentesco" },
  { campo: "emergencia_domicilio", grupo: "D", labelKey: "emergencia_domicilio" },
  { campo: "emergencia_telefono", grupo: "D", labelKey: "emergencia_telefono" },
] as const satisfies readonly CampoSolicitudConfig[];

export type CampoSolicitud = (typeof CAMPOS_SOLICITUD)[number]["campo"];

// Allowed fields that are legajo columns (everything except "hijos").
export type CampoSolicitudColumna = Exclude<CampoSolicitud, "hijos">;

export const CAMPO_HIJOS = "hijos" as const satisfies CampoSolicitud;

export const CAMPO_SOLICITUD_CODES: readonly CampoSolicitud[] = CAMPOS_SOLICITUD.map(
  (config) => config.campo,
);

export function isCampoSolicitud(value: unknown): value is CampoSolicitud {
  return (
    typeof value === "string" &&
    (CAMPO_SOLICITUD_CODES as readonly string[]).includes(value)
  );
}
