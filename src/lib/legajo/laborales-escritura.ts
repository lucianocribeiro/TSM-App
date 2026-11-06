import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionResult } from "@/lib/action-result";
import { listarItems } from "@/lib/configuracion/datos";
import { copy } from "@/lib/copy/es-AR";
import { copyLaborales } from "@/lib/copy/laborales";
import type { Database } from "@/lib/supabase/database.types";
import { CHECK_VIOLATION, dbErrorMessage, UNIQUE_VIOLATION } from "./escritura";
import { validarDatosLaborales } from "./laborales";

// Group E (Datos laborales) writes, Admin only (AUDCR3-01): only the /legajos
// actions import this module. Mi Legajo, the shared modules and the shared
// write helpers (./escritura.ts) never do (eslint.config.mjs), so none of it
// reaches the employee's bundle (scripts/bundle-mi-legajo.mjs). RLS lets only
// an active Admin write legajos_laborales; the calling action checks the role
// first.

type Client = SupabaseClient<Database>;

const aprobacionErrors = copy.aprobaciones.errors;

// HINTs of legajos_laborales_validar (CR-2).
const LABORALES_INCOMPLETOS_HINT = "laborales_incompletos";
const ITEM_INACTIVO_HINT = "item_inactivo";
// CR-5: the "No" convenio with Tarea or Categoría.
const SIN_CONVENIO_HINT = "sin_convenio";

// Validates and writes group E (PRD 5.5) to legajos_laborales, against the
// Configuración lists as they are now (validarDatosLaborales). Antigüedad is
// calculated, never stored. A número de legajo already used by another
// employee is its own error. The database applies the same rules
// (legajos_laborales_validar), so a list changed meanwhile is still refused.
export async function aplicarDatosLaborales(client: Client, profileId: string, valores: unknown): Promise<ActionResult> {
  const [legajo, items] = await Promise.all([
    client.from("legajos").select("id, legajos_laborales(*)").eq("profile_id", profileId).maybeSingle(),
    listarItems(client),
  ]);
  if (legajo.error || !legajo.data?.legajos_laborales || !items) return { ok: false, error: aprobacionErrors.guardarFallo };

  const validado = validarDatosLaborales(valores, items, legajo.data.legajos_laborales);
  if (!validado.ok) return { ok: false, error: copy.miLegajo.errors.revisarCampos, fieldErrors: validado.fieldErrors };

  const { data, error } = await client
    .from("legajos_laborales")
    .update(validado.datos)
    .eq("legajo_id", legajo.data.id)
    .select("legajo_id")
    .maybeSingle();
  if (error?.code === UNIQUE_VIOLATION) {
    const mensaje = copyLaborales.errors.numeroLegajoDuplicado;
    return { ok: false, error: mensaje, fieldErrors: { numero_legajo: mensaje } };
  }
  if (error?.code === CHECK_VIOLATION && error.hint === ITEM_INACTIVO_HINT) {
    return { ok: false, error: copy.legajo.validation.itemInactivo };
  }
  if (error?.code === CHECK_VIOLATION && error.hint === SIN_CONVENIO_HINT) {
    const mensaje = copyLaborales.errors.sinConvenio;
    return { ok: false, error: copy.miLegajo.errors.revisarCampos, fieldErrors: { tarea_id: mensaje, categoria_id: mensaje } };
  }
  if (error?.code === CHECK_VIOLATION && error.hint === LABORALES_INCOMPLETOS_HINT) {
    return { ok: false, error: copy.miLegajo.errors.revisarCampos };
  }
  if (error || !data) return { ok: false, error: error ? dbErrorMessage(error) : aprobacionErrors.guardarFallo };
  return { ok: true };
}
