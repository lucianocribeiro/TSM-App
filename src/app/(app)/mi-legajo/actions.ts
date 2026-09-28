"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { buildSolicitudItemsDe, type LegajoActual } from "@/lib/aprobaciones/solicitudes";
import { sessionWithRole } from "@/lib/auth/require-role";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import { copy } from "@/lib/copy/es-AR";
import { descartarObjeto, prepararRuta, registrarObjeto } from "@/lib/documentos/registro";
import { createDocumentoSignedUrl } from "@/lib/documentos/signed-url";
import { DOCUMENTOS_BUCKET } from "@/lib/documentos/tipos";
import { camposDelGrupo } from "@/lib/legajo/grupos";
import { aplicarGrupo, dbErrorMessage, validarGrupo } from "@/lib/legajo/escritura";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Server Actions of /mi-legajo (PRD US-3, US-7; Constitution §9). Everything
// runs with the user's own session: RLS and the storage policies decide what
// each user reaches. An Empleado's changes go through crear_solicitud; an
// Admin's own changes apply directly. Errors are es-AR, never internals.

const MI_LEGAJO_PATH = "/mi-legajo";
const t = copy.miLegajo;
const aprobacionErrors = copy.aprobaciones.errors;
const noAutorizado: ActionResult = { ok: false, error: copy.cuentas.errors.noAutorizado };

// The signed-in user, when their account was read and is active.
async function usuarioActivo(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  return user && user.cuenta?.estadoCuenta === "activa" ? user : null;
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

  const supabase = await createClient();
  const result = await aplicarGrupo(supabase, user.id, validado);
  if (!result.ok) return result;

  revalidatePath(MI_LEGAJO_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
// Three steps around a browser-direct upload to the caller's own folder, with
// cleanup on every failure (src/lib/documentos/registro.ts).
const ORIGEN = "mi-legajo";

export async function prepararSubidaDocumento(input: unknown): Promise<ActionResult<{ path: string }>> {
  const user = await usuarioActivo();
  if (!user) return noAutorizado;
  return prepararRuta(await createClient(), user.id, input, { origen: ORIGEN });
}

export async function registrarDocumento(
  input: unknown,
): Promise<ActionResult<{ estado: Database["public"]["Enums"]["documento_estado"] }>> {
  const user = await usuarioActivo();
  if (!user) return noAutorizado;
  const result = await registrarObjeto(
    { client: await createClient(), ownerId: user.id, uploaderId: user.id, esAdmin: user.role === "admin", origen: ORIGEN },
    input,
  );
  if (result.ok) revalidatePath(MI_LEGAJO_PATH);
  return result;
}

// Called by the browser when registration failed or never answered.
export async function descartarSubida(input: unknown): Promise<ActionResult> {
  const user = await usuarioActivo();
  if (!user) return noAutorizado;
  return descartarObjeto(await createClient(), user.id, input, ORIGEN);
}

// A document of the caller's own legajo, found by id. An Admin's RLS reaches
// every legajo, so the ownership is checked here too.
async function documentoPropio(documentoId: unknown, userId: string) {
  const parsed = z.uuid().safeParse(documentoId);
  if (!parsed.success) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("legajo_documentos")
    .select("id, estado, storage_path, file_name, legajos!inner(profile_id)")
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
  // Served as an attachment with the original file name.
  return createDocumentoSignedUrl(found.documento.storage_path, { download: found.documento.file_name });
}
