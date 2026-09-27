import { parseHijosValor, serializeValor, type HijoValor, type LegajoActual } from "@/lib/aprobaciones/solicitudes";
import type { CampoSolicitud } from "@/lib/aprobaciones/campos";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import { formatearFecha } from "@/lib/format/fecha";
import type { Antiguedad } from "./antiguedad";
import type { GrupoEditable } from "./grupos";
import { ESTADOS_CIVILES } from "./options";

// Display and form helpers for /mi-legajo. Pure.

const t = copy.miLegajo;
const DATE_FIELDS = new Set<string>(["fecha_nacimiento", "fecha_ingreso"]);

// A stored or proposed value, as text for the page. Values are in the same
// text form the change requests use (dates YYYY-MM-DD, booleans "true" /
// "false", children as JSON). Empty -> "Sin completar".
export function mostrarValor(campo: CampoSolicitud | string, valor: string | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return t.sinDato;
  if (DATE_FIELDS.has(campo)) return formatearFecha(valor) || valor;
  if (campo === "estado_civil") {
    return (ESTADOS_CIVILES as readonly string[]).includes(valor)
      ? t.estadosCiviles[valor as (typeof ESTADOS_CIVILES)[number]]
      : valor;
  }
  if (campo === "tiene_hijos") return valor === "true" ? t.siNo.si : t.siNo.no;
  if (campo === "hijos") {
    const hijos = parseHijosValor(valor) ?? [];
    return hijos.length === 0 ? t.hijos.ninguno : hijos.map(mostrarHijo).join("; ");
  }
  return valor;
}

export function mostrarHijo(hijo: HijoValor): string {
  return `${hijo.nombre_completo} (${formatearFecha(hijo.fecha_nacimiento)})`;
}

export function textoAntiguedad(antiguedad: Antiguedad | null): string {
  if (!antiguedad) return t.sinDato;
  const { anios, meses } = antiguedad;
  if (anios === 0 && meses === 0) return t.antiguedad.menosDeUnMes;
  const partes = [];
  if (anios > 0) partes.push(formatCopy(anios === 1 ? t.antiguedad.anio : t.antiguedad.anios, { n: String(anios) }));
  if (meses > 0) partes.push(formatCopy(meses === 1 ? t.antiguedad.mes : t.antiguedad.meses, { n: String(meses) }));
  return partes.join(t.antiguedad.separador);
}

// The value of a field in its stored text form.
export function valorActual(actual: LegajoActual, campo: CampoSolicitud): string | null {
  return campo === "hijos" ? JSON.stringify(actual.hijos) : serializeValor(actual[campo]);
}

// A legajo is empty when none of its data columns has a value and it has no children.
export function legajoVacio(legajo: Record<string, unknown>, hijos: readonly HijoValor[]): boolean {
  const skip = new Set(["id", "profile_id", "created_at", "updated_at"]);
  return (
    hijos.length === 0 &&
    Object.entries(legajo).every(([key, value]) => skip.has(key) || value === null || value === "")
  );
}

// ---------------------------------------------------------------------------
// Forms: every field is text in the form; hijos is a list of rows.
// ---------------------------------------------------------------------------
export type FormHijo = { nombre_completo: string; fecha_nacimiento: string };
export type FormGrupo = Record<string, string> & { hijos?: never };
export type FormState = { campos: Record<string, string>; hijos: FormHijo[] };

export function formInicial(campos: readonly CampoSolicitud[], actual: LegajoActual): FormState {
  const valores: Record<string, string> = {};
  for (const campo of campos) {
    if (campo === "hijos") continue;
    if (campo === "tiene_hijos") {
      valores[campo] = actual.tiene_hijos === null ? "" : actual.tiene_hijos ? "si" : "no";
    } else {
      valores[campo] = serializeValor(actual[campo]) ?? "";
    }
  }
  return { campos: valores, hijos: actual.hijos.map((hijo) => ({ ...hijo })) };
}

// The values the group schema validates: "" for a missing select, a boolean
// for tiene_hijos, and the children only when tiene_hijos is "si".
export function valoresDelForm(grupo: GrupoEditable, form: FormState): Record<string, unknown> {
  const valores: Record<string, unknown> = { ...form.campos };
  if (grupo === "C") {
    const tiene = form.campos.tiene_hijos;
    valores.tiene_hijos = tiene === "si" ? true : tiene === "no" ? false : undefined;
    valores.hijos = tiene === "si" ? form.hijos : [];
  }
  if (grupo === "B" && form.campos.partido !== "Otro") valores.partido_otro = null;
  return valores;
}
