import type { Database } from "@/lib/supabase/database.types";
import { DOCUMENTO_TIPOS, type DocumentoTipo } from "./tipos";

// What the Mi Legajo documents section shows for each type (PRD scope item 6,
// US-7). Pure: the rows come from legajo_documentos, read under RLS.

type DocumentoEstado = Database["public"]["Enums"]["documento_estado"];

export type DocumentoFila = {
  id: string;
  tipo: DocumentoTipo;
  estado: DocumentoEstado;
  fileName: string;
  creadoEn: string;
  motivoRechazo: string | null;
  // Replaced documents only (Admin reads; an Empleado never gets these rows).
  reemplazadoEn?: string | null;
  reemplazadoPor?: string | null;
};

// The state shown for a type: pending first, then a rejection that is the
// latest upload, then the approved file, else missing.
export type EstadoDocumentoTipo = "pendiente" | "rechazado" | "aprobado" | "faltante";

export type ResumenDocumento = {
  tipo: DocumentoTipo;
  requerido: boolean;
  estado: EstadoDocumentoTipo;
  // The current approved file (downloadable), if any.
  vigente: DocumentoFila | null;
  // The file waiting for approval (downloadable, deletable), if any.
  pendiente: DocumentoFila | null;
  // The rejected upload, when it is the latest one: its reason is shown.
  rechazado: DocumentoFila | null;
  // A new upload is possible unless one is already pending.
  puedeSubir: boolean;
};

export function resumirDocumentos(filas: readonly DocumentoFila[]): ResumenDocumento[] {
  return DOCUMENTO_TIPOS.map(({ tipo, required }) => {
    const delTipo = filas
      .filter((fila) => fila.tipo === tipo && fila.estado !== "reemplazado")
      .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
    const vigente = delTipo.find((fila) => fila.estado === "aprobado") ?? null;
    const pendiente = delTipo.find((fila) => fila.estado === "pendiente") ?? null;
    const ultimo = delTipo[0] ?? null;
    const rechazado = !pendiente && ultimo?.estado === "rechazado" ? ultimo : null;

    const estado: EstadoDocumentoTipo = pendiente
      ? "pendiente"
      : rechazado
        ? "rechazado"
        : vigente
          ? "aprobado"
          : "faltante";

    return { tipo, requerido: required, estado, vigente, pendiente, rechazado, puedeSubir: !pendiente };
  });
}
