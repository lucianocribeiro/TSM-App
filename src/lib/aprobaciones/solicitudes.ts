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
// value set. Values are stored as text in the same format the database uses
// when it fills valor_anterior: dates YYYY-MM-DD, booleans "true" / "false",
// and the children set as a JSON array.

type LegajoRow = Database["public"]["Tables"]["legajos"]["Row"];

export type HijoValor = { nombre_completo: string; fecha_nacimiento: string };

// Current legajo: the allowed columns plus the current children.
export type LegajoActual = Pick<LegajoRow, CampoSolicitudColumna> & {
  hijos: HijoValor[];
};

export type SolicitudItemPayload = {
  campo: CampoSolicitud;
  valor_propuesto: string | null;
  valor_anterior: string | null;
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

// One item per allowed field whose proposed value differs from the current
// one. Unchanged fields are skipped. An empty result means nothing to submit.
export function buildSolicitudItems(
  propuesto: LegajoPersonal,
  actual: LegajoActual,
): SolicitudItemPayload[] {
  const items: SolicitudItemPayload[] = [];

  for (const { campo } of CAMPOS_SOLICITUD) {
    let valorPropuesto: string | null;
    let valorAnterior: string | null;

    if (campo === CAMPO_HIJOS) {
      valorPropuesto = serializeHijos(propuesto.hijos);
      valorAnterior = serializeHijos(actual.hijos);
    } else {
      valorPropuesto = serializeValor(propuesto[campo]);
      valorAnterior = serializeValor(actual[campo]);
    }

    if (valorPropuesto !== valorAnterior) {
      items.push({ campo, valor_propuesto: valorPropuesto, valor_anterior: valorAnterior });
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

type DbError = { code?: string; message?: string } | null | undefined;

// es-AR message for a failed submission or decision. Never exposes the
// database message.
export function aprobacionErrorMessage(error: DbError): string {
  const messages = copy.aprobaciones.errors;
  if (error?.code === UNIQUE_VIOLATION && error.message?.includes(SOLICITUD_PENDIENTE_INDEX)) {
    return messages.solicitudPendiente;
  }
  if (error?.code === UNIQUE_VIOLATION && error.message?.includes(DOCUMENTO_PENDIENTE_INDEX)) {
    return messages.documentoPendiente;
  }
  if (error?.code === INVALID_PARAMETER) return messages.motivoRequerido;
  if (error?.code === NOT_PENDING) return messages.noPendiente;
  return messages.guardarFallo;
}
