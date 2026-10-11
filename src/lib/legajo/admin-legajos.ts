import "server-only";
import type { Database } from "@/lib/supabase/database.types";
import { listarItems } from "@/lib/configuracion/datos";
import type { CatalogoItem } from "@/lib/configuracion/listas";
import { createClient } from "@/lib/supabase/server";
import type { LaboralRow } from "./laborales";
import { itemDesdeFila, type LegajoListItem } from "./listado";
import { cargarMiLegajo, type MiLegajoData } from "./mi-legajo";

// Reads for /legajos (Admin), with the Admin's own session: an active
// Admin's RLS reaches every legajo, its group E, profile, child, document
// and request, and the Configuración lists.
// The pages call requireRole("admin") before any of these.

type CuentaEstado = Database["public"]["Enums"]["cuenta_estado"];

// The list: one query with only the columns the table, filters, search and
// KPI cards use, joined to group E and the account state, plus the
// Configuración lists for the names. No children, documents or requests.
export type ListadoLegajos = { legajos: LegajoListItem[]; items: CatalogoItem[] };

export async function cargarListadoLegajos(): Promise<ListadoLegajos | null> {
  const supabase = await createClient();
  const [{ data, error }, items] = await Promise.all([
    supabase
      .from("legajos")
      .select(
        "profile_id, nombres, apellido, dni, cuil, legajos_laborales(numero_legajo, area_id, puesto_id, sucursal_id, tarea_id, estado_laboral, fecha_ingreso), profiles!inner(estado_cuenta)",
      ),
    listarItems(),
  ]);
  if (error || !items) return null;
  const legajos = (data ?? []).map(({ profiles, legajos_laborales, ...fila }) =>
    itemDesdeFila({ ...fila, laboral: legajos_laborales, estado_cuenta: profiles.estado_cuenta }, items),
  );
  return { legajos, items };
}

export type LegajoAdmin = MiLegajoData & {
  estadoCuenta: CuentaEstado;
  // Group E (null if the row is missing) and the lists its dropdowns offer.
  laboral: LaboralRow | null;
  items: CatalogoItem[];
};

// One employee's legajo, by profile id. "no-encontrado" when there is no
// such profile; null when it could not be read.
export async function cargarLegajoAdmin(profileId: string): Promise<LegajoAdmin | "no-encontrado" | null> {
  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("estado_cuenta")
    .eq("id", profileId)
    .maybeSingle();
  if (error) return null;
  if (!profile) return "no-encontrado";

  const data = await cargarMiLegajo(profileId);
  if (!data) return null;
  const [laboral, items] = await Promise.all([
    supabase.from("legajos_laborales").select("*").eq("legajo_id", data.legajo.id).maybeSingle(),
    listarItems(),
  ]);
  if (laboral.error || !items) return null;
  return { ...data, estadoCuenta: profile.estado_cuenta, laboral: laboral.data, items };
}
