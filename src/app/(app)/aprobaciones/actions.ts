"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { cargarDocumento, cargarSolicitud, contarPendientes } from "@/lib/aprobaciones/bandeja-datos";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";
import { validarMotivo } from "@/lib/aprobaciones/motivo";
import { revalidarSolicitud } from "@/lib/aprobaciones/revalidacion";
import { decisionBandejaError } from "@/lib/aprobaciones/solicitudes";
import { sessionWithRole } from "@/lib/auth/require-role";
import { createDocumentoSignedUrl } from "@/lib/documentos/signed-url";
import { createClient } from "@/lib/supabase/server";

// Server Actions of /aprobaciones (PRD US-7, Constitution §9). Admin only:
// every action checks for an active Admin first (sessionWithRole) and then
// runs with the Admin's own session, so RLS and the decision functions'
// own checks apply as well. A request or document is decided as a whole, as
// the employee sent it; nothing is edited here. Errors are es-AR.
//
// yaDecidido: the item is no longer pending (another tab, or the employee
// cancelled it). The page shows the message and refreshes.

export type DecisionResult = ActionResult<never> & { yaDecidido?: boolean };

const errors = copy.aprobaciones.errors;
const noAutorizado = { ok: false as const, error: copy.cuentas.errors.noAutorizado };
const yaDecidido = { ok: false as const, error: errors.yaDecidido, yaDecidido: true };

const solicitudInput = z.object({ solicitudId: z.uuid() });
const documentoInput = z.object({ documentoId: z.uuid() });

// Everything under the app layout: the inbox, the bell count the layout
// renders, and the employee's legajo in /legajos and /mi-legajo.
function revalidar() {
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Change requests
// ---------------------------------------------------------------------------
// The submitted values are validated again with the shared schemas before
// the database applies them (PRD 5.7): if a rule changed since submission,
// approval is refused and the Admin rejects with a reason instead.
export async function aprobarSolicitud(input: unknown): Promise<DecisionResult> {
  const admin = await sessionWithRole("admin");
  if (!admin) return noAutorizado;
  const parsed = solicitudInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: errors.guardarFallo };

  const solicitud = await cargarSolicitud(parsed.data.solicitudId);
  if (solicitud === "no-encontrado") return yaDecidido;
  if (!solicitud) return { ok: false, error: errors.guardarFallo };
  if (solicitud.estado !== "pendiente") return yaDecidido;
  if (solicitud.empleado.profileId === admin.id) return { ok: false, error: errors.cuentaPropia };

  const revalidacion = revalidarSolicitud(solicitud.items, solicitud.actual);
  if (!revalidacion.ok) {
    const campos = revalidacion.campos.map((campo) => copy.aprobaciones.campos[campo]).join(", ");
    return { ok: false, error: formatCopy(errors.revalidacion, { campos }) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("aprobar_solicitud", { p_solicitud_id: solicitud.id });
  if (error) return { ok: false, ...decisionBandejaError(error) };
  revalidar();
  return { ok: true };
}

export async function rechazarSolicitud(input: unknown): Promise<DecisionResult> {
  const admin = await sessionWithRole("admin");
  if (!admin) return noAutorizado;
  const parsed = solicitudInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: errors.guardarFallo };
  const motivo = validarMotivo((input as { motivo?: unknown }).motivo);
  if (!motivo.ok) return { ok: false, error: motivo.error };

  const solicitud = await cargarSolicitud(parsed.data.solicitudId);
  if (solicitud === "no-encontrado") return yaDecidido;
  if (!solicitud) return { ok: false, error: errors.guardarFallo };
  if (solicitud.estado !== "pendiente") return yaDecidido;
  if (solicitud.empleado.profileId === admin.id) return { ok: false, error: errors.cuentaPropia };

  const supabase = await createClient();
  const { error } = await supabase.rpc("rechazar_solicitud", { p_solicitud_id: solicitud.id, p_motivo: motivo.motivo });
  if (error) return { ok: false, ...decisionBandejaError(error) };
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
async function documentoPendiente(input: unknown, adminId: string) {
  const parsed = documentoInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: errors.guardarFallo };
  const documento = await cargarDocumento(parsed.data.documentoId);
  if (documento === "no-encontrado") return yaDecidido;
  if (!documento) return { ok: false as const, error: errors.guardarFallo };
  if (documento.estado !== "pendiente") return yaDecidido;
  if (documento.empleado.profileId === adminId) return { ok: false as const, error: errors.cuentaPropia };
  return { ok: true as const, documento };
}

export async function aprobarDocumento(input: unknown): Promise<DecisionResult> {
  const admin = await sessionWithRole("admin");
  if (!admin) return noAutorizado;
  const found = await documentoPendiente(input, admin.id);
  if (!found.ok) return found;

  const supabase = await createClient();
  const { error } = await supabase.rpc("aprobar_documento", { p_documento_id: found.documento.id });
  if (error) return { ok: false, ...decisionBandejaError(error) };
  revalidar();
  return { ok: true };
}

export async function rechazarDocumento(input: unknown): Promise<DecisionResult> {
  const admin = await sessionWithRole("admin");
  if (!admin) return noAutorizado;
  const motivo = validarMotivo((input as { motivo?: unknown } | null)?.motivo);
  const found = await documentoPendiente(input, admin.id);
  if (!found.ok) return found;
  if (!motivo.ok) return { ok: false, error: motivo.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("rechazar_documento", {
    p_documento_id: found.documento.id,
    p_motivo: motivo.motivo,
  });
  if (error) return { ok: false, ...decisionBandejaError(error) };
  revalidar();
  return { ok: true };
}

// A 5-minute signed URL for the pending file or the current one beside it,
// served as an attachment with its original name.
export async function descargarDocumentoBandeja(input: unknown): Promise<ActionResult<{ url: string }>> {
  const admin = await sessionWithRole("admin");
  if (!admin) return noAutorizado;
  const parsed = documentoInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: copy.documentos.errors.downloadFailed };
  const supabase = await createClient();
  const { data } = await supabase
    .from("legajo_documentos")
    .select("storage_path, file_name")
    .eq("id", parsed.data.documentoId)
    .maybeSingle();
  if (!data) return { ok: false, error: copy.documentos.errors.downloadFailed };
  return createDocumentoSignedUrl(data.storage_path, { download: data.file_name });
}

// ---------------------------------------------------------------------------
// Indicator
// ---------------------------------------------------------------------------
// The count for the Admin's bell, asked again on navigation. Anyone else gets
// no number.
export async function contarPendientesCampana(): Promise<ActionResult<{ total: number }>> {
  const admin = await sessionWithRole("admin");
  if (!admin) return noAutorizado;
  const total = await contarPendientes();
  if (total === null) return { ok: false, error: errors.guardarFallo };
  return { ok: true, data: { total } };
}
