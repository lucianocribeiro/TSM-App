"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import {
  buildSolicitudItemsDe,
  documentoErrorMessage,
  solicitudErrorMessage,
  type LegajoActual,
} from "@/lib/aprobaciones/solicitudes";
import { CAMPO_HIJOS, type CampoSolicitudColumna } from "@/lib/aprobaciones/campos";
import { sessionWithRole } from "@/lib/auth/require-role";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import { copy } from "@/lib/copy/es-AR";
import { buildDocumentoPath, parseDocumentoPath } from "@/lib/documentos/paths";
import { createDocumentoSignedUrl } from "@/lib/documentos/signed-url";
import { DOCUMENTOS_BUCKET, type DocumentoTipo } from "@/lib/documentos/tipos";
import { validateDocumentoUpload } from "@/lib/documentos/validation";
import { camposDelGrupo, ESQUEMA_GRUPO, isGrupoEditable, type GrupoEditable } from "@/lib/legajo/grupos";
import { fieldErrors } from "@/lib/legajo/validation";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Server Actions of /mi-legajo (PRD US-3, US-7; Constitution §9). Everything
// runs with the user's own session: RLS and the storage policies decide what
// each user reaches. An Empleado's changes go through crear_solicitud; an
// Admin's own changes apply directly. Errors are es-AR, never internals.

type LegajoUpdate = Database["public"]["Tables"]["legajos"]["Update"];

const MI_LEGAJO_PATH = "/mi-legajo";
const t = copy.miLegajo;
const aprobacionErrors = copy.aprobaciones.errors;
const noAutorizado: ActionResult = { ok: false, error: copy.cuentas.errors.noAutorizado };

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const INVALID_PARAMETER = "22023";

// The signed-in user, when their account was read and is active.
async function usuarioActivo(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  return user && user.cuenta?.estadoCuenta === "activa" ? user : null;
}

type GrupoInput = { grupo: GrupoEditable; valores: unknown };
const grupoInput = z.object({ grupo: z.string().refine(isGrupoEditable), valores: z.unknown() });

// Validates one group's values with its shared schema. Field errors come back
// keyed by field for the form.
function validarGrupo(input: unknown) {
  const shape = grupoInput.safeParse(input);
  if (!shape.success) return { ok: false as const, result: { ok: false, error: aprobacionErrors.guardarFallo } as ActionResult };
  const grupo = shape.data.grupo as GrupoInput["grupo"];
  const parsed = ESQUEMA_GRUPO[grupo].safeParse(shape.data.valores);
  if (!parsed.success) {
    return {
      ok: false as const,
      result: { ok: false, error: t.errors.revisarCampos, fieldErrors: fieldErrors(parsed.error) } as ActionResult,
    };
  }
  return { ok: true as const, grupo, valores: parsed.data as Record<string, unknown> };
}

function dbErrorMessage(error: { code?: string; message?: string }): string {
  if (error.code === UNIQUE_VIOLATION) return solicitudErrorMessage(error);
  if (error.code === CHECK_VIOLATION || error.code === INVALID_PARAMETER) return aprobacionErrors.valorInvalido;
  return aprobacionErrors.guardarFallo;
}

// ---------------------------------------------------------------------------
// Change requests (Empleado)
// ---------------------------------------------------------------------------
export async function enviarSolicitud(input: unknown): Promise<ActionResult> {
  const user = await usuarioActivo();
  if (!user) return noAutorizado;
  if (user.role !== "empleado") return { ok: false, error: t.errors.soloEmpleados };

  const validado = validarGrupo(input);
  if (!validado.ok) return validado.result;

  const supabase = await createClient();
  const { data: legajo, error } = await supabase.from("legajos").select("*").eq("profile_id", user.id).maybeSingle();
  if (error || !legajo) return { ok: false, error: aprobacionErrors.guardarFallo };
  const hijos = await supabase
    .from("legajo_hijos")
    .select("nombre_completo, fecha_nacimiento")
    .eq("legajo_id", legajo.id);
  if (hijos.error) return { ok: false, error: aprobacionErrors.guardarFallo };

  const actual: LegajoActual = { ...legajo, hijos: hijos.data ?? [] };
  const items = buildSolicitudItemsDe(camposDelGrupo(validado.grupo), validado.valores, actual);
  if (items.length === 0) return { ok: false, error: aprobacionErrors.sinCambios };

  const { error: rpcError } = await supabase.rpc("crear_solicitud", { p_legajo_id: legajo.id, p_items: items });
  if (rpcError) return { ok: false, error: dbErrorMessage(rpcError) };

  revalidatePath(MI_LEGAJO_PATH);
  return { ok: true };
}

export async function cancelarSolicitud(input: unknown): Promise<ActionResult> {
  const user = await usuarioActivo();
  if (!user) return noAutorizado;
  const parsed = z.object({ solicitudId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: aprobacionErrors.guardarFallo };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("solicitudes_cambio")
    .update({ estado: "cancelada" })
    .eq("id", parsed.data.solicitudId)
    .eq("estado", "pendiente")
    .select("id");
  if (error) return { ok: false, error: aprobacionErrors.guardarFallo };
  // RLS reaches only the caller's own pending request.
  if (!data || data.length === 0) return { ok: false, error: aprobacionErrors.noPendiente };

  revalidatePath(MI_LEGAJO_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Direct edit (Admin, own legajo only)
// ---------------------------------------------------------------------------
export async function actualizarLegajoPropio(input: unknown): Promise<ActionResult> {
  const user = await sessionWithRole("admin");
  if (!user) return { ok: false, error: t.errors.soloAdmin };

  const validado = validarGrupo(input);
  if (!validado.ok) return validado.result;

  const campos = camposDelGrupo(validado.grupo);
  const update: LegajoUpdate = {};
  for (const campo of campos) {
    if (campo !== CAMPO_HIJOS) {
      Object.assign(update, { [campo as CampoSolicitudColumna]: validado.valores[campo] });
    }
  }

  const supabase = await createClient();
  const { data: legajo, error } = await supabase
    .from("legajos")
    .update(update)
    .eq("profile_id", user.id)
    .select("id")
    .maybeSingle();
  if (error || !legajo) return { ok: false, error: error ? dbErrorMessage(error) : aprobacionErrors.guardarFallo };

  // The children set is replaced as a whole, as an approved request does.
  if (campos.includes(CAMPO_HIJOS)) {
    const hijos = (validado.valores.hijos ?? []) as { nombre_completo: string; fecha_nacimiento: string }[];
    const removed = await supabase.from("legajo_hijos").delete().eq("legajo_id", legajo.id);
    if (removed.error) return { ok: false, error: aprobacionErrors.guardarFallo };
    if (hijos.length > 0) {
      const inserted = await supabase
        .from("legajo_hijos")
        .insert(hijos.map((hijo) => ({ legajo_id: legajo.id, ...hijo })));
      if (inserted.error) return { ok: false, error: aprobacionErrors.guardarFallo };
    }
  }

  revalidatePath(MI_LEGAJO_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
// The file goes from the browser straight to Storage with the user's session
// (the storage policies apply), between two actions:
// 1. prepararSubidaDocumento validates the declared file and returns a fresh
//    path in the user's own folder;
// 2. registrarDocumento checks the stored object's real size and type again
//    and records it; if anything fails, the object is removed.
// This keeps files off the app server, whose request body limit is far below
// the 10 MB the bucket allows.

const subidaInput = z.object({
  tipo: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
});

export async function prepararSubidaDocumento(input: unknown): Promise<ActionResult<{ path: string }>> {
  const user = await usuarioActivo();
  if (!user) return noAutorizado;
  const parsed = subidaInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t.documentos.errors.subirFallo };

  const valid = validateDocumentoUpload(parsed.data);
  if (!valid.ok) return valid;

  const supabase = await createClient();
  const pendientes = await supabase
    .from("legajo_documentos")
    .select("id, legajos!inner(profile_id)", { count: "exact", head: true })
    .eq("legajos.profile_id", user.id)
    .eq("tipo", valid.data.tipo)
    .eq("estado", "pendiente");
  if (pendientes.error) return { ok: false, error: t.documentos.errors.subirFallo };
  if ((pendientes.count ?? 0) > 0) return { ok: false, error: aprobacionErrors.documentoPendiente };

  const path = buildDocumentoPath({
    profileId: user.id,
    tipo: valid.data.tipo,
    fileId: randomUUID(),
    mimeType: valid.data.mimeType,
  });
  if (!path) return { ok: false, error: t.documentos.errors.subirFallo };
  return { ok: true, data: { path } };
}

export async function registrarDocumento(
  input: unknown,
): Promise<ActionResult<{ estado: Database["public"]["Enums"]["documento_estado"] }>> {
  const user = await usuarioActivo();
  if (!user) return noAutorizado;
  const parsed = z.object({ tipo: z.string(), path: z.string(), fileName: z.string() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: t.documentos.errors.subirFallo };

  const ruta = parseDocumentoPath(parsed.data.path);
  if (!ruta || ruta.profileId !== user.id || ruta.tipo !== parsed.data.tipo) {
    return { ok: false, error: t.documentos.errors.subirFallo };
  }
  const tipo: DocumentoTipo = ruta.tipo;
  const path = parsed.data.path;

  const supabase = await createClient();
  const bucket = supabase.storage.from(DOCUMENTOS_BUCKET);
  const objectName = path.split("/")[2];
  const listed = await bucket.list(`${user.id}/${tipo}`, { search: objectName });
  const object = listed.data?.find((entry) => entry.name === objectName);
  if (listed.error || !object) return { ok: false, error: t.documentos.errors.subirFallo };

  const discard = async (error: string): Promise<ActionResult<never>> => {
    await bucket.remove([path]);
    return { ok: false, error };
  };

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

  const { data: legajo } = await supabase.from("legajos").select("id").eq("profile_id", user.id).maybeSingle();
  if (!legajo) return discard(t.documentos.errors.subirFallo);

  const archivo = {
    storage_path: path,
    file_name: valid.data.fileName,
    mime_type: valid.data.mimeType,
    size_bytes: valid.data.sizeBytes,
    uploaded_by: user.id,
  };

  // An Admin's own uploads are approved at once (Constitution §9): a new file
  // for a type that already has an approved one replaces it in place, and the
  // old object is removed.
  if (user.role === "admin") {
    const vigente = await supabase
      .from("legajo_documentos")
      .select("id, storage_path")
      .eq("legajo_id", legajo.id)
      .eq("tipo", tipo)
      .eq("estado", "aprobado")
      .maybeSingle();
    if (vigente.error) return discard(t.documentos.errors.subirFallo);
    if (vigente.data) {
      const replaced = await supabase
        .from("legajo_documentos")
        .update(archivo)
        .eq("id", vigente.data.id)
        .select("estado")
        .single();
      if (replaced.error || !replaced.data) return discard(t.documentos.errors.subirFallo);
      await bucket.remove([vigente.data.storage_path]);
      revalidatePath(MI_LEGAJO_PATH);
      return { ok: true, data: { estado: replaced.data.estado } };
    }
  }

  const inserted = await supabase
    .from("legajo_documentos")
    .insert({ legajo_id: legajo.id, tipo, ...archivo })
    .select("estado")
    .single();
  if (inserted.error || !inserted.data) {
    return discard(
      inserted.error?.code === UNIQUE_VIOLATION ? documentoErrorMessage(inserted.error) : t.documentos.errors.subirFallo,
    );
  }

  revalidatePath(MI_LEGAJO_PATH);
  return { ok: true, data: { estado: inserted.data.estado } };
}

// A document of the caller's own legajo, found by id. An Admin's RLS reaches
// every legajo, so the ownership is checked here too.
async function documentoPropio(documentoId: unknown, userId: string) {
  const parsed = z.uuid().safeParse(documentoId);
  if (!parsed.success) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("legajo_documentos")
    .select("id, estado, storage_path, legajos!inner(profile_id)")
    .eq("id", parsed.data)
    .eq("legajos.profile_id", userId)
    .maybeSingle();
  return data ? { supabase, documento: data } : null;
}

export async function eliminarDocumentoPendiente(input: unknown): Promise<ActionResult> {
  const user = await usuarioActivo();
  if (!user) return noAutorizado;
  const found = await documentoPropio((input as { documentoId?: unknown } | null)?.documentoId, user.id);
  if (!found || found.documento.estado !== "pendiente") return { ok: false, error: t.documentos.errors.eliminarFallo };

  const { supabase, documento } = found;
  // The object first, while its document is pending (storage policy), then the row.
  const removed = await supabase.storage.from(DOCUMENTOS_BUCKET).remove([documento.storage_path]);
  if (removed.error) return { ok: false, error: t.documentos.errors.eliminarFallo };
  const deleted = await supabase.from("legajo_documentos").delete().eq("id", documento.id).select("id");
  if (deleted.error || !deleted.data?.length) return { ok: false, error: t.documentos.errors.eliminarFallo };

  revalidatePath(MI_LEGAJO_PATH);
  return { ok: true };
}

export async function obtenerUrlDocumento(input: unknown): Promise<ActionResult<{ url: string }>> {
  const user = await usuarioActivo();
  if (!user) return noAutorizado;
  const found = await documentoPropio((input as { documentoId?: unknown } | null)?.documentoId, user.id);
  if (!found) return { ok: false, error: copy.documentos.errors.downloadFailed };
  return createDocumentoSignedUrl(found.documento.storage_path);
}
