import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { CAMPO_HIJOS, type CampoSolicitudColumna } from "@/lib/aprobaciones/campos";
import { solicitudErrorMessage } from "@/lib/aprobaciones/solicitudes";
import { copy } from "@/lib/copy/es-AR";
import type { Database } from "@/lib/supabase/database.types";
import { camposDelGrupo, ESQUEMA_GRUPO, isGrupoEditable, type GrupoEditable } from "./grupos";
import { datosLaboralesSchema, fieldErrors } from "./validation";

// Direct writes to a legajo (Admin: their own from /mi-legajo, anyone's from
// /legajos). Values are validated with the shared schemas of PRD 5.7 before
// anything is written; RLS (legajos_update_admin, legajo_hijos_*_admin) lets
// only an active Admin write. The calling action checks the role first.

type Client = SupabaseClient<Database>;
type LegajoUpdate = Database["public"]["Tables"]["legajos"]["Update"];

const aprobacionErrors = copy.aprobaciones.errors;
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const INVALID_PARAMETER = "22023";
const OBJECT_STATE = "55000";
// HINT of the lock that refuses groups A to D while a request is pending.
export const SOLICITUD_PENDIENTE_HINT = "solicitud_pendiente";

export function dbErrorMessage(error: { code?: string; message?: string; hint?: string }): string {
  if (error.code === OBJECT_STATE && error.hint === SOLICITUD_PENDIENTE_HINT) return copy.legajos.errors.solicitudPendiente;
  if (error.code === UNIQUE_VIOLATION) return solicitudErrorMessage(error);
  if (error.code === CHECK_VIOLATION || error.code === INVALID_PARAMETER) return aprobacionErrors.valorInvalido;
  return aprobacionErrors.guardarFallo;
}

const grupoInput = z.object({ grupo: z.string().refine(isGrupoEditable), valores: z.unknown() });

export type GrupoValidado =
  | { ok: true; grupo: GrupoEditable; valores: Record<string, unknown> }
  | { ok: false; result: ActionResult };

// Validates one group's values with its shared schema. Field errors come back
// keyed by field for the form.
export function validarGrupo(input: unknown): GrupoValidado {
  const shape = grupoInput.safeParse(input);
  if (!shape.success) return { ok: false, result: { ok: false, error: aprobacionErrors.guardarFallo } };
  const grupo = shape.data.grupo as GrupoEditable;
  const parsed = ESQUEMA_GRUPO[grupo].safeParse(shape.data.valores);
  if (!parsed.success) {
    return {
      ok: false,
      result: { ok: false, error: copy.miLegajo.errors.revisarCampos, fieldErrors: fieldErrors(parsed.error) },
    };
  }
  return { ok: true, grupo, valores: parsed.data as Record<string, unknown> };
}

// Writes a validated group A to D to the legajo of profileId. The children
// set is replaced as a whole, as an approved request does.
export async function aplicarGrupo(
  client: Client,
  profileId: string,
  { grupo, valores }: { grupo: GrupoEditable; valores: Record<string, unknown> },
): Promise<ActionResult> {
  const campos = camposDelGrupo(grupo);
  const update: LegajoUpdate = {};
  for (const campo of campos) {
    if (campo !== CAMPO_HIJOS) {
      Object.assign(update, { [campo as CampoSolicitudColumna]: valores[campo] });
    }
  }

  const { data: legajo, error } = await client
    .from("legajos")
    .update(update)
    .eq("profile_id", profileId)
    .select("id")
    .maybeSingle();
  if (error || !legajo) return { ok: false, error: error ? dbErrorMessage(error) : aprobacionErrors.guardarFallo };

  if (campos.includes(CAMPO_HIJOS)) {
    const hijos = (valores.hijos ?? []) as { nombre_completo: string; fecha_nacimiento: string }[];
    const removed = await client.from("legajo_hijos").delete().eq("legajo_id", legajo.id);
    if (removed.error) return { ok: false, error: dbErrorMessage(removed.error) };
    if (hijos.length > 0) {
      const inserted = await client
        .from("legajo_hijos")
        .insert(hijos.map((hijo) => ({ legajo_id: legajo.id, ...hijo })));
      if (inserted.error) return { ok: false, error: dbErrorMessage(inserted.error) };
    }
  }
  return { ok: true };
}

// Validates and writes group E (PRD 5.5). Antigüedad is calculated, never
// stored. A número de legajo already used by another employee is its own error.
export async function aplicarDatosLaborales(client: Client, profileId: string, valores: unknown): Promise<ActionResult> {
  const parsed = datosLaboralesSchema.safeParse(valores);
  if (!parsed.success) {
    return { ok: false, error: copy.miLegajo.errors.revisarCampos, fieldErrors: fieldErrors(parsed.error) };
  }
  const { data, error } = await client
    .from("legajos")
    .update(parsed.data)
    .eq("profile_id", profileId)
    .select("id")
    .maybeSingle();
  if (error?.code === UNIQUE_VIOLATION) {
    const mensaje = copy.legajos.errors.numeroLegajoDuplicado;
    return { ok: false, error: mensaje, fieldErrors: { numero_legajo: mensaje } };
  }
  if (error || !data) return { ok: false, error: error ? dbErrorMessage(error) : aprobacionErrors.guardarFallo };
  return { ok: true };
}

// True when the legajo of profileId has a pending change request, null when
// that cannot be read. While one is pending, groups A to D and the children
// are not edited directly: the request is resolved first. The database
// enforces it too (legajos_bloquear_pendiente, F1-09B); this check comes
// first for the clear message and to avoid a partial write.
export async function tieneSolicitudPendiente(client: Client, profileId: string): Promise<boolean | null> {
  const { count, error } = await client
    .from("solicitudes_cambio")
    .select("id, legajos!inner(profile_id)", { count: "exact", head: true })
    .eq("legajos.profile_id", profileId)
    .eq("estado", "pendiente");
  if (error) return null;
  return (count ?? 0) > 0;
}
