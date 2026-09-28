"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { sessionWithRole } from "@/lib/auth/require-role";
import { copy } from "@/lib/copy/es-AR";
import { eliminarObjeto } from "@/lib/documentos/limpieza";
import { avisarFalloLimpieza, descartarObjeto, prepararRuta, registrarObjeto } from "@/lib/documentos/registro";
import { createDocumentoSignedUrl } from "@/lib/documentos/signed-url";
import type { Database } from "@/lib/supabase/database.types";
import { aplicarDatosLaborales, aplicarGrupo, tieneSolicitudPendiente, validarGrupo } from "@/lib/legajo/escritura";
import { createClient } from "@/lib/supabase/server";

// Server Actions of /legajos (PRD US-4, 5.6). Admin only: every action
// checks for an active Admin first (sessionWithRole), then runs with the
// Admin's own session, so RLS and the storage policies apply as well. Admin
// changes apply directly, with no approval step. Errors are es-AR.

const ORIGEN = "legajos";
const t = copy.legajos;
const docErrors = copy.miLegajo.documentos.errors;
const noAutorizado: ActionResult<never> = { ok: false, error: copy.cuentas.errors.noAutorizado };

const conPerfil = z.object({ profileId: z.uuid() });

function revalidar(profileId: string) {
  revalidatePath("/legajos");
  revalidatePath(`/legajos/${profileId}`);
  revalidatePath("/mi-legajo");
}

// The target employee's id from the input, when the caller is an active Admin.
async function destino(input: unknown) {
  const admin = await sessionWithRole("admin");
  if (!admin) return null;
  const parsed = conPerfil.safeParse(input);
  return parsed.success ? { admin, profileId: parsed.data.profileId } : "invalido";
}

// ---------------------------------------------------------------------------
// Groups A to D (children included)
// ---------------------------------------------------------------------------
// Not while the employee has a pending change request: it is resolved first.
export async function actualizarGrupoLegajo(input: unknown): Promise<ActionResult> {
  const found = await destino(input);
  if (!found) return noAutorizado;
  if (found === "invalido") return { ok: false, error: copy.aprobaciones.errors.guardarFallo };

  const validado = validarGrupo(input);
  if (!validado.ok) return validado.result;

  const supabase = await createClient();
  const pendiente = await tieneSolicitudPendiente(supabase, found.profileId);
  if (pendiente === null) return { ok: false, error: copy.aprobaciones.errors.guardarFallo };
  if (pendiente) return { ok: false, error: t.errors.solicitudPendiente };

  const result = await aplicarGrupo(supabase, found.profileId, validado);
  if (!result.ok) return result;
  revalidar(found.profileId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Group E
// ---------------------------------------------------------------------------
export async function actualizarDatosLaborales(input: unknown): Promise<ActionResult> {
  const found = await destino(input);
  if (!found) return noAutorizado;
  if (found === "invalido") return { ok: false, error: copy.aprobaciones.errors.guardarFallo };

  const valores = (input as { valores?: unknown }).valores;
  const result = await aplicarDatosLaborales(await createClient(), found.profileId, valores);
  if (!result.ok) return result;
  revalidar(found.profileId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
// The same three steps and cleanup as /mi-legajo (src/lib/documentos/
// registro.ts), in the target employee's folder. The sweep before a new path
// covers only that folder. Admin uploads are approved by the database.
export async function prepararSubidaAdmin(input: unknown): Promise<ActionResult<{ path: string }>> {
  const found = await destino(input);
  if (!found) return noAutorizado;
  if (found === "invalido") return { ok: false, error: docErrors.subirFallo };
  return prepararRuta(await createClient(), found.profileId, input, {
    origen: ORIGEN,
    mensajePendiente: t.errors.documentoPendiente,
  });
}

export async function registrarDocumentoAdmin(
  input: unknown,
): Promise<ActionResult<{ estado: Database["public"]["Enums"]["documento_estado"] }>> {
  const found = await destino(input);
  if (!found) return noAutorizado;
  if (found === "invalido") return { ok: false, error: docErrors.subirFallo };
  const result = await registrarObjeto(
    { client: await createClient(), ownerId: found.profileId, uploaderId: found.admin.id, esAdmin: true, origen: ORIGEN },
    input,
  );
  if (result.ok) revalidar(found.profileId);
  return result;
}

export async function descartarSubidaAdmin(input: unknown): Promise<ActionResult> {
  const found = await destino(input);
  if (!found) return noAutorizado;
  if (found === "invalido") return { ok: false, error: docErrors.subirFallo };
  return descartarObjeto(await createClient(), found.profileId, input, ORIGEN);
}

// A document of the target employee's legajo, by id.
async function documentoDe(input: unknown) {
  const found = await destino(input);
  if (!found || found === "invalido") return found;
  const documentoId = z.uuid().safeParse((input as { documentoId?: unknown }).documentoId);
  if (!documentoId.success) return "invalido" as const;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legajo_documentos")
    .select("id, estado, storage_path, file_name, legajos!inner(profile_id)")
    .eq("id", documentoId.data)
    .eq("legajos.profile_id", found.profileId)
    .maybeSingle();
  if (error || !data) return "invalido" as const;
  return { ...found, supabase, documento: data };
}

// Deletes the current (approved) document. The row goes first, so no row
// ever points to a missing file; if removing the object then fails, it is
// a rowless object and the next sweep of that folder removes it. Pending
// employee uploads are decided in the approvals inbox, not deleted here.
export async function eliminarDocumentoAdmin(input: unknown): Promise<ActionResult> {
  const found = await documentoDe(input);
  if (!found) return noAutorizado;
  if (found === "invalido" || found.documento.estado !== "aprobado") {
    return { ok: false, error: docErrors.eliminarFallo };
  }
  const { supabase, documento, profileId } = found;
  const deleted = await supabase.from("legajo_documentos").delete().eq("id", documento.id).select("id");
  if (deleted.error || !deleted.data?.length) return { ok: false, error: docErrors.eliminarFallo };
  if (!(await eliminarObjeto(supabase, documento.storage_path))) avisarFalloLimpieza(ORIGEN, "delete");

  revalidar(profileId);
  return { ok: true };
}

// A 5-minute signed URL, served as an attachment with the original name.
export async function obtenerUrlDocumentoAdmin(input: unknown): Promise<ActionResult<{ url: string }>> {
  const found = await documentoDe(input);
  if (!found) return noAutorizado;
  if (found === "invalido") return { ok: false, error: copy.documentos.errors.downloadFailed };
  return createDocumentoSignedUrl(found.documento.storage_path, { download: found.documento.file_name });
}
