"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { sessionWithRole } from "@/lib/auth/require-role";
import { copy } from "@/lib/copy/es-AR";
import { eliminarObjeto } from "@/lib/documentos/limpieza";
import {
  avisarFalloLimpieza,
  DESCARTE_CAMPOS,
  descartarObjeto,
  prepararRuta,
  REGISTRO_CAMPOS,
  registrarObjeto,
  SUBIDA_CAMPOS,
} from "@/lib/documentos/registro";
import { createDocumentoSignedUrl } from "@/lib/documentos/signed-url";
import { exportarLegajos as exportar, type ArchivoExportado } from "@/lib/exportacion/exportar";
import type { Database } from "@/lib/supabase/database.types";
import { aplicarGrupo, tieneSolicitudPendiente, validarGrupo } from "@/lib/legajo/escritura";
import { aplicarDatosLaborales } from "@/lib/legajo/laborales-escritura";
import { clavesLaboralesSchema } from "@/lib/legajo/laborales";
import { createClient } from "@/lib/supabase/server";

// Server Actions of /legajos (PRD US-4, 5.6). Admin only: every action
// checks for an active Admin first (sessionWithRole), then runs with the
// Admin's own session, so RLS and the storage policies apply as well. Admin
// changes apply directly, with no approval step. Errors are es-AR.

const ORIGEN = "legajos";
const t = copy.legajos;
const docErrors = copy.miLegajo.documentos.errors;
const noAutorizado: ActionResult<never> = { ok: false, error: copy.cuentas.errors.noAutorizado };

// Each action's input: the target employee plus the action's own fields, and
// no other key (AUD-SEC-01-01; group E at either level, AUDCR5-01).
const GRUPO_CAMPOS = { grupo: z.unknown(), valores: z.unknown() };
const LABORALES_CAMPOS = { valores: clavesLaboralesSchema };
const DOCUMENTO_CAMPOS = { documentoId: z.uuid() };

function revalidar(profileId: string) {
  revalidatePath("/legajos");
  revalidatePath(`/legajos/${profileId}`);
  revalidatePath("/mi-legajo");
}

// The target employee's id and the rest of the input, when the caller is an
// active Admin and the input has exactly profileId and these fields. Checked
// before any read or write.
async function destino(input: unknown, campos: Record<string, z.ZodType>) {
  const admin = await sessionWithRole("admin");
  if (!admin) return null;
  const parsed = z.strictObject({ profileId: z.uuid(), ...campos }).safeParse(input);
  if (!parsed.success) return "invalido" as const;
  const { profileId, ...resto } = parsed.data as { profileId: string } & Record<string, unknown>;
  return { admin, profileId, resto };
}

// ---------------------------------------------------------------------------
// Groups A to D (children included)
// ---------------------------------------------------------------------------
// Not while the employee has a pending change request: it is resolved first.
export async function actualizarGrupoLegajo(input: unknown): Promise<ActionResult> {
  const found = await destino(input, GRUPO_CAMPOS);
  if (!found) return noAutorizado;
  if (found === "invalido") return { ok: false, error: copy.aprobaciones.errors.guardarFallo };

  const validado = validarGrupo(found.resto);
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
  const found = await destino(input, LABORALES_CAMPOS);
  if (!found) return noAutorizado;
  if (found === "invalido") return { ok: false, error: copy.aprobaciones.errors.guardarFallo };

  const result = await aplicarDatosLaborales(await createClient(), found.profileId, found.resto.valores);
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
  const found = await destino(input, SUBIDA_CAMPOS);
  if (!found) return noAutorizado;
  if (found === "invalido") return { ok: false, error: docErrors.subirFallo };
  return prepararRuta(await createClient(), found.profileId, found.resto, {
    origen: ORIGEN,
    mensajePendiente: t.errors.documentoPendiente,
  });
}

export async function registrarDocumentoAdmin(
  input: unknown,
): Promise<ActionResult<{ estado: Database["public"]["Enums"]["documento_estado"] }>> {
  const found = await destino(input, REGISTRO_CAMPOS);
  if (!found) return noAutorizado;
  if (found === "invalido") return { ok: false, error: docErrors.subirFallo };
  const result = await registrarObjeto(
    { client: await createClient(), ownerId: found.profileId, uploaderId: found.admin.id, esAdmin: true, origen: ORIGEN },
    found.resto,
  );
  if (result.ok) revalidar(found.profileId);
  return result;
}

export async function descartarSubidaAdmin(input: unknown): Promise<ActionResult> {
  const found = await destino(input, DESCARTE_CAMPOS);
  if (!found) return noAutorizado;
  if (found === "invalido") return { ok: false, error: docErrors.subirFallo };
  return descartarObjeto(await createClient(), found.profileId, found.resto, ORIGEN);
}

// A document of the target employee's legajo, by id.
async function documentoDe(input: unknown) {
  const found = await destino(input, DOCUMENTO_CAMPOS);
  if (!found || found === "invalido") return found;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legajo_documentos")
    .select("id, estado, storage_path, file_name, legajos!inner(profile_id)")
    .eq("id", found.resto.documentoId as string)
    .eq("legajos.profile_id", found.profileId)
    .maybeSingle();
  if (error || !data) return "invalido" as const;
  return { ...found, supabase, documento: data };
}

// Deletes the current (approved) document. The row goes first, so no row
// ever points to a missing file. If removing the object then fails, the
// Admin gets the controlled cleanup error (the document is already gone from
// the legajo); the object is rowless and the next sweep of that folder
// removes it. Pending employee uploads are decided in the approvals inbox,
// not deleted here.
export async function eliminarDocumentoAdmin(input: unknown): Promise<ActionResult> {
  const found = await documentoDe(input);
  if (!found) return noAutorizado;
  if (found === "invalido" || found.documento.estado !== "aprobado") {
    return { ok: false, error: docErrors.eliminarFallo };
  }
  const { supabase, documento, profileId } = found;
  const deleted = await supabase.from("legajo_documentos").delete().eq("id", documento.id).select("id");
  if (deleted.error || !deleted.data?.length) return { ok: false, error: docErrors.eliminarFallo };
  // The row is gone either way: the page shows it.
  revalidar(profileId);
  if (!(await eliminarObjeto(supabase, documento.storage_path))) {
    avisarFalloLimpieza(ORIGEN, "delete");
    return { ok: false, error: docErrors.limpiezaFallo };
  }
  return { ok: true };
}

// A 5-minute signed URL, served as an attachment with the original name.
export async function obtenerUrlDocumentoAdmin(input: unknown): Promise<ActionResult<{ url: string }>> {
  const found = await documentoDe(input);
  if (!found) return noAutorizado;
  if (found === "invalido") return { ok: false, error: copy.documentos.errors.downloadFailed };
  return createDocumentoSignedUrl(found.documento.storage_path, { download: found.documento.file_name });
}

// ---------------------------------------------------------------------------
// Excel export (CR-4)
// ---------------------------------------------------------------------------
// Input: the list state ({ filtros }) and the chosen fields ({ seleccion:
// { campos, hijos } }), never rows. The file comes back base64-encoded for
// the browser to save; it is logged before it is returned, and never stored.
export async function exportarLegajos(input: unknown): Promise<ActionResult<ArchivoExportado>> {
  const admin = await sessionWithRole("admin");
  if (!admin) return noAutorizado;
  return exportar(input);
}
