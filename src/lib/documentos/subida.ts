import type { ActionResult } from "@/lib/action-result";
import { copy } from "@/lib/copy/es-AR";
import type { ModoReemplazo } from "./reemplazo";
import type { DocumentoTipo } from "./tipos";

// The browser side of a document upload: a path from the server, the file to
// Storage, then the server records it. If the upload landed but registration
// failed or never answered, the object is discarded, so nothing stays without
// its row. Never throws: returns an es-AR error, or null on success.

export type SubidaPasos = {
  preparar: (input: { tipo: DocumentoTipo; fileName: string; mimeType: string; sizeBytes: number }) => Promise<ActionResult<{ path: string }>>;
  subirArchivo: (path: string) => Promise<{ error: unknown }>;
  // modo: only when an Admin replaces a current document.
  registrar: (input: { tipo: DocumentoTipo; path: string; fileName: string; modo?: ModoReemplazo }) => Promise<ActionResult<unknown>>;
  descartar: (input: { path: string }) => Promise<ActionResult>;
};

export type ArchivoDeclarado = { name: string; type: string; size: number };

const subirFallo = copy.miLegajo.documentos.errors.subirFallo;

export async function subirDocumento(
  pasos: SubidaPasos,
  tipo: DocumentoTipo,
  file: ArchivoDeclarado,
): Promise<string | null> {
  let path: string;
  try {
    const prepared = await pasos.preparar({ tipo, fileName: file.name, mimeType: file.type, sizeBytes: file.size });
    if (!prepared.ok) return prepared.error;
    if (!prepared.data) return subirFallo;
    path = prepared.data.path;
    const uploaded = await pasos.subirArchivo(path);
    // Nothing was stored: nothing to clean up.
    if (uploaded.error) return subirFallo;
  } catch {
    return subirFallo;
  }

  let registered: ActionResult<unknown> | null = null;
  try {
    registered = await pasos.registrar({ tipo, path, fileName: file.name });
  } catch {
    registered = null;
  }
  if (registered?.ok) return null;

  // The server removes the object on its own failures; this also covers a
  // registration that never answered. The discard keeps registered documents.
  try {
    const discarded = await pasos.descartar({ path });
    if (!discarded.ok) return discarded.error;
  } catch {
    return copy.miLegajo.documentos.errors.limpiezaFallo;
  }
  return registered ? registered.error : subirFallo;
}
