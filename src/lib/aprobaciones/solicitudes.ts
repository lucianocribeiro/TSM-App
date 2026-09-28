import { z } from "zod";
import { copy } from "@/lib/copy/es-AR";
import { hijoSchema, type LegajoPersonal } from "@/lib/legajo/validation";
import type { Database } from "@/lib/supabase/database.types";
import {
  CAMPO_HIJOS,
  CAMPOS_SOLICITUD,
  type CampoSolicitud,
  type CampoSolicitudColumna,
} from "./campos";

// Pure helpers to build a change request (PRD US-7) from a validated form
// value set: the p_items payload of public.crear_solicitud. Values are sent as
// text in the same format the database uses when it fills valor_anterior:
// dates YYYY-MM-DD, booleans "true" / "false", and the children set as a JSON
// array.

type LegajoRow = Database["public"]["Tables"]["legajos"]["Row"];

export type HijoValor = { nombre_completo: string; fecha_nacimiento: string };

// Current legajo: the allowed columns plus the current children.
export type LegajoActual = Pick<LegajoRow, CampoSolicitudColumna> & {
  hijos: HijoValor[];
};

// One element of crear_solicitud's p_items. The database fills valor_anterior.
export type CrearSolicitudItem = {
  campo: CampoSolicitud;
  valor_propuesto: string | null;
};

// Same shape as public.is_valid_hijos_json: an array of objects with exactly
// nombre_completo and fecha_nacimiento.
export const hijosValorSchema = z.array(hijoSchema.strict());

function compareHijos(a: HijoValor, b: HijoValor): number {
  if (a.fecha_nacimiento !== b.fecha_nacimiento) {
    return a.fecha_nacimiento < b.fecha_nacimiento ? -1 : 1;
  }
  if (a.nombre_completo !== b.nombre_completo) {
    return a.nombre_completo < b.nombre_completo ? -1 : 1;
  }
  return 0;
}

// Canonical form: sorted by birth date, then name, with only the two keys.
export function serializeHijos(hijos: readonly HijoValor[]): string {
  return JSON.stringify(
    [...hijos]
      .sort(compareHijos)
      .map(({ nombre_completo, fecha_nacimiento }) => ({ nombre_completo, fecha_nacimiento })),
  );
}

// Parses a stored "hijos" value; null when it does not have the expected shape.
export function parseHijosValor(valor: string | null): HijoValor[] | null {
  if (valor === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(valor);
  } catch {
    return null;
  }
  const parsed = hijosValorSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export function serializeValor(value: string | boolean | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

// The p_items payload: one item per allowed field whose proposed value
// differs from the current one. Unchanged fields are skipped. An empty result
// means there is nothing to submit; crear_solicitud rejects an empty list, so
// check it before calling (copy.aprobaciones.errors.sinCambios).
export function buildSolicitudItems(
  propuesto: LegajoPersonal,
  actual: LegajoActual,
): CrearSolicitudItem[] {
  return buildSolicitudItemsDe(
    CAMPOS_SOLICITUD.map((config) => config.campo),
    propuesto,
    actual,
  );
}

// The same for a partial edit (one group of the page): only the listed fields
// are compared, and only those need a proposed value.
export function buildSolicitudItemsDe(
  campos: readonly CampoSolicitud[],
  propuesto: Partial<LegajoPersonal>,
  actual: LegajoActual,
): CrearSolicitudItem[] {
  const items: CrearSolicitudItem[] = [];

  for (const campo of campos) {
    let valorPropuesto: string | null;
    let valorActual: string | null;

    if (campo === CAMPO_HIJOS) {
      valorPropuesto = serializeHijos(propuesto.hijos ?? []);
      valorActual = serializeHijos(actual.hijos);
    } else {
      valorPropuesto = serializeValor(propuesto[campo]);
      valorActual = serializeValor(actual[campo]);
    }

    if (valorPropuesto !== valorActual) {
      items.push({ campo, valor_propuesto: valorPropuesto });
    }
  }

  return items;
}

// The partial unique index that allows one pending request per legajo, and
// the one that allows one pending document per legajo and type.
export const SOLICITUD_PENDIENTE_INDEX = "solicitudes_cambio_una_pendiente_por_legajo";
export const DOCUMENTO_PENDIENTE_INDEX = "legajo_documentos_un_pendiente_por_tipo";

const UNIQUE_VIOLATION = "23505";
const INVALID_PARAMETER = "22023";
const NOT_PENDING = "55000";
const NOT_FOUND = "P0002";
// HINT of the 55000 raised when an Admin decides on their own legajo.
export const CUENTA_PROPIA_HINT = "cuenta_propia";

type DbError = { code?: string; message?: string; hint?: string } | null | undefined;

// es-AR messages for failed database calls. They never expose the database
// message; anything unexpected gets the generic message.
const messages = copy.aprobaciones.errors;

function isUniqueViolationOn(error: DbError, index: string): boolean {
  return error?.code === UNIQUE_VIOLATION && Boolean(error.message?.includes(index));
}

// crear_solicitud.
export function solicitudErrorMessage(error: DbError): string {
  if (isUniqueViolationOn(error, SOLICITUD_PENDIENTE_INDEX)) return messages.solicitudPendiente;
  return messages.guardarFallo;
}

// Document upload (legajo_documentos insert).
export function documentoErrorMessage(error: DbError): string {
  if (isUniqueViolationOn(error, DOCUMENTO_PENDIENTE_INDEX)) return messages.documentoPendiente;
  return messages.guardarFallo;
}

// aprobar_* and rechazar_* functions.
export function decisionErrorMessage(error: DbError): string {
  if (error?.code === INVALID_PARAMETER) return messages.motivoRequerido;
  if (error?.code === NOT_PENDING && error.hint === CUENTA_PROPIA_HINT) return messages.cuentaPropia;
  if (error?.code === NOT_PENDING) return messages.noPendiente;
  return messages.guardarFallo;
}

// The same functions from the approvals inbox. yaDecidido: the item is no
// longer pending (decided in another tab, or cancelled by the employee), so
// the inbox refreshes instead of offering the decision again.
export function decisionBandejaError(error: DbError): { error: string; yaDecidido: boolean } {
  if (error?.code === NOT_PENDING && error.hint === CUENTA_PROPIA_HINT) {
    return { error: messages.cuentaPropia, yaDecidido: false };
  }
  if (error?.code === NOT_PENDING || error?.code === NOT_FOUND) return { error: messages.yaDecidido, yaDecidido: true };
  if (error?.code === INVALID_PARAMETER) return { error: messages.motivoRequerido, yaDecidido: false };
  return { error: messages.guardarFallo, yaDecidido: false };
}
