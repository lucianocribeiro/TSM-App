import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { documentoErrorMessage } from "@/lib/aprobaciones/solicitudes";
import { copy } from "@/lib/copy/es-AR";
import type { Database } from "@/lib/supabase/database.types";
import { barrerHuerfanos, eliminarObjeto } from "./limpieza";
import { buildDocumentoPath, parseDocumentoPath } from "./paths";
import { MODOS_REEMPLAZO, type ModoReemplazo } from "./reemplazo";
import { DOCUMENTOS_BUCKET, type DocumentoTipo } from "./tipos";
import { validateDocumentoUpload } from "./validation";

// The server side of a document upload, shared by /mi-legajo (own legajo)
// and /legajos (Admin, any legajo). The file goes from the browser straight
// to Storage with the caller's session (the storage policies apply), between
// two steps:
// 1. prepararRuta validates the declared file and returns a fresh path in the
//    owner's folder;
// 2. registrarObjeto checks the stored object's real size and type again and
//    records it; if anything fails, the object is removed.
// This keeps files off the app server, whose request body limit is far below
// the 10 MB the bucket allows.
//
// No object may stay without its row (AUD08-02): every failure after the
// upload removes it and checks that the removal worked; the browser calls
// descartarObjeto (through its action) when registration fails or never
// answers; and each new upload first sweeps the owner's folder for rowless
// objects older than UMBRAL_HUERFANO_MINUTOS (./limpieza.ts).
//
// Every function runs with the caller's own session client. The caller (a
// Server Action) has already checked who may act on ownerId.

type Client = SupabaseClient<Database>;
type DocumentoEstado = Database["public"]["Enums"]["documento_estado"];

const errors = copy.miLegajo.documentos.errors;
const reemplazoErrors = copy.legajos.documentos.errors;
const UNIQUE_VIOLATION = "23505";
const OBJECT_STATE = "55000";

// Server-side note for a cleanup that failed. No paths, ids or credentials.
export function avisarFalloLimpieza(origen: string, motivo: string) {
  console.error(`[${origen}] legajo-docs cleanup failed: ${motivo}`);
}

const subidaInput = z.object({
  tipo: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
});

// Step 1: a fresh path in the owner's folder. One pending document per type
// at a time (mensajePendiente says so to the caller). The sweep of the
// owner's folder runs first; its failure is noted and never blocks the upload.
export async function prepararRuta(
  client: Client,
  ownerId: string,
  input: unknown,
  { origen, mensajePendiente = copy.aprobaciones.errors.documentoPendiente }: { origen: string; mensajePendiente?: string },
): Promise<ActionResult<{ path: string }>> {
  const parsed = subidaInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: errors.subirFallo };

  const valid = validateDocumentoUpload(parsed.data);
  if (!valid.ok) return valid;

  const pendientes = await client
    .from("legajo_documentos")
    .select("id, legajos!inner(profile_id)", { count: "exact", head: true })
    .eq("legajos.profile_id", ownerId)
    .eq("tipo", valid.data.tipo)
    .eq("estado", "pendiente");
  if (pendientes.error) return { ok: false, error: errors.subirFallo };
  if ((pendientes.count ?? 0) > 0) return { ok: false, error: mensajePendiente };

  const barrido = await barrerHuerfanos(client, ownerId);
  if (!barrido.ok) avisarFalloLimpieza(origen, "sweep");

  const path = buildDocumentoPath({
    profileId: ownerId,
    tipo: valid.data.tipo,
    fileId: randomUUID(),
    mimeType: valid.data.mimeType,
  });
  if (!path) return { ok: false, error: errors.subirFallo };
  return { ok: true, data: { path } };
}

export type Registro = {
  client: Client;
  // Whose legajo and folder.
  ownerId: string;
  // Who uploads (the signed-in user).
  uploaderId: string;
  // Admin uploads are approved at once (set by the database). When the type
  // already has an approved document, the input's modo says how it is
  // replaced (public.reemplazar_documento).
  esAdmin: boolean;
  origen: string;
};

// Step 2: checks the stored object and records it.
export async function registrarObjeto(
  { client, ownerId, uploaderId, esAdmin, origen }: Registro,
  input: unknown,
): Promise<ActionResult<{ estado: DocumentoEstado }>> {
  const parsed = z
    .object({ tipo: z.string(), path: z.string(), fileName: z.string(), modo: z.enum(MODOS_REEMPLAZO).optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: errors.subirFallo };

  const ruta = parseDocumentoPath(parsed.data.path);
  if (!ruta || ruta.profileId !== ownerId || ruta.tipo !== parsed.data.tipo) {
    return { ok: false, error: errors.subirFallo };
  }
  const tipo: DocumentoTipo = ruta.tipo;
  const path = parsed.data.path;
  const bucket = client.storage.from(DOCUMENTOS_BUCKET);

  // From here the object may exist: every failure removes it first. If the
  // removal itself fails, the user gets a controlled error (and the sweep
  // retries later).
  const discard = async (error: string): Promise<ActionResult<never>> => {
    if (await eliminarObjeto(client, path)) return { ok: false, error };
    avisarFalloLimpieza(origen, "register");
    return { ok: false, error: errors.limpiezaFallo };
  };

  const objectName = path.split("/")[2];
  const listed = await bucket.list(`${ownerId}/${tipo}`, { search: objectName });
  if (listed.error) return discard(errors.subirFallo);
  const object = listed.data?.find((entry) => entry.name === objectName);
  // Not stored (or not visible): removing a missing path is harmless.
  if (!object) return discard(errors.subirFallo);

  // What was actually stored, not what the browser declared.
  const metadata = (object.metadata ?? {}) as { size?: number; mimetype?: string };
  const valid = validateDocumentoUpload({
    tipo,
    fileName: parsed.data.fileName,
    mimeType: metadata.mimetype,
    sizeBytes: metadata.size,
  });
  if (!valid.ok) return discard(valid.error);
  if (valid.data.mimeType !== ruta.mimeType) return discard(copy.documentos.validation.fileTypeMismatch);

  const { data: legajo } = await client.from("legajos").select("id").eq("profile_id", ownerId).maybeSingle();
  if (!legajo) return discard(errors.subirFallo);

  const archivo = {
    storage_path: path,
    file_name: valid.data.fileName,
    mime_type: valid.data.mimeType,
    size_bytes: valid.data.sizeBytes,
    uploaded_by: uploaderId,
  };

  // Admin uploads are approved at once (Constitution §9). A new file for a
  // type that already has an approved one replaces it, in the mode the Admin
  // chose, in one database transaction.
  if (esAdmin) {
    const vigente = await client
      .from("legajo_documentos")
      .select("id")
      .eq("legajo_id", legajo.id)
      .eq("tipo", tipo)
      .eq("estado", "aprobado")
      .maybeSingle();
    if (vigente.error) return discard(errors.subirFallo);
    if (vigente.data) {
      if (!parsed.data.modo) return discard(reemplazoErrors.modoRequerido);
      return reemplazar(client, { legajoId: legajo.id, tipo, archivo, modo: parsed.data.modo, origen }, discard);
    }
  }

  const inserted = await client
    .from("legajo_documentos")
    .insert({ legajo_id: legajo.id, tipo, ...archivo })
    .select("estado")
    .single();
  if (inserted.error || !inserted.data) {
    return discard(
      inserted.error?.code === UNIQUE_VIOLATION ? documentoErrorMessage(inserted.error) : errors.subirFallo,
    );
  }
  return { ok: true, data: { estado: inserted.data.estado } };
}

type Reemplazo = {
  legajoId: string;
  tipo: DocumentoTipo;
  archivo: { storage_path: string; file_name: string; mime_type: string; size_bytes: number };
  modo: ModoReemplazo;
  origen: string;
};

// Replaces the approved document through public.reemplazar_documento. In the
// permanent mode the previous row is gone when it returns, and its object is
// removed here: if that fails, the replacement stands, the caller gets the
// cleanup error and the rowless object is left to the folder sweep.
async function reemplazar(
  client: Client,
  { legajoId, tipo, archivo, modo, origen }: Reemplazo,
  discard: (error: string) => Promise<ActionResult<never>>,
): Promise<ActionResult<{ estado: DocumentoEstado }>> {
  const { data, error } = await client.rpc("reemplazar_documento", {
    p_legajo_id: legajoId,
    p_tipo: tipo,
    p_storage_path: archivo.storage_path,
    p_file_name: archivo.file_name,
    p_mime_type: archivo.mime_type,
    p_size_bytes: archivo.size_bytes,
    p_conservar_historial: modo === "conservar",
  });
  if (error || !data?.length) {
    return discard(
      error?.code === OBJECT_STATE ? copy.legajos.errors.documentoPendiente : errors.subirFallo,
    );
  }
  // Null in the keep-history mode (the generated type does not say so).
  const anterior: string | null = data[0].storage_path_eliminado ?? null;
  if (anterior && !(await eliminarObjeto(client, anterior))) {
    avisarFalloLimpieza(origen, "replace");
    return { ok: false, error: reemplazoErrors.limpiezaFallo };
  }
  return { ok: true, data: { estado: "aprobado" } };
}

// Called (through an action) when registration failed or never answered:
// removes the uploaded object, only in the owner's folder and only while no
// document row points to it (a registered document is never removed here).
export async function descartarObjeto(
  client: Client,
  ownerId: string,
  input: unknown,
  origen: string,
): Promise<ActionResult> {
  const parsed = z.object({ path: z.string() }).safeParse(input);
  const ruta = parsed.success ? parseDocumentoPath(parsed.data.path) : null;
  if (!parsed.success || !ruta || ruta.profileId !== ownerId) return { ok: false, error: errors.subirFallo };

  const fila = await client
    .from("legajo_documentos")
    .select("id", { count: "exact", head: true })
    .eq("storage_path", parsed.data.path);
  if (fila.error) return { ok: false, error: errors.limpiezaFallo };
  if ((fila.count ?? 0) > 0) return { ok: true };

  if (await eliminarObjeto(client, parsed.data.path)) return { ok: true };
  avisarFalloLimpieza(origen, "discard");
  return { ok: false, error: errors.limpiezaFallo };
}
