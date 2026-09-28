import type { DocumentoFila } from "./resumen";
import { DOCUMENTO_TIPO_CODES, type DocumentoTipo } from "./tipos";

// The replaced versions of each document type, for the Admin's Legajos
// detail (F1-09B). Pure: the rows are the legajo's documents read with the
// Admin's session; names resolve who replaced each one.

export type VersionReemplazada = {
  id: string;
  fileName: string;
  creadoEn: string;
  // Null for documents replaced before this was recorded.
  reemplazadoEn: string | null;
  reemplazadoPor: string | null;
};

export type HistorialTipo = { tipo: DocumentoTipo; versiones: VersionReemplazada[] };

// Types with at least one replaced version, in page order; newest first.
export function historialDocumentos(
  filas: readonly DocumentoFila[],
  nombres: ReadonlyMap<string, string>,
): HistorialTipo[] {
  return DOCUMENTO_TIPO_CODES.map((tipo) => ({
    tipo,
    versiones: filas
      .filter((fila) => fila.tipo === tipo && fila.estado === "reemplazado")
      .map((fila) => ({
        id: fila.id,
        fileName: fila.fileName,
        creadoEn: fila.creadoEn,
        reemplazadoEn: fila.reemplazadoEn ?? null,
        reemplazadoPor: fila.reemplazadoPor ? (nombres.get(fila.reemplazadoPor) ?? null) : null,
      }))
      .sort((a, b) => (b.reemplazadoEn ?? b.creadoEn).localeCompare(a.reemplazadoEn ?? a.creadoEn)),
  })).filter((grupo) => grupo.versiones.length > 0);
}

// Who replaced something, when a name has to be looked up.
export function reemplazantes(filas: readonly DocumentoFila[]): string[] {
  return [
    ...new Set(
      filas.flatMap((fila) => (fila.estado === "reemplazado" && fila.reemplazadoPor ? [fila.reemplazadoPor] : [])),
    ),
  ];
}
