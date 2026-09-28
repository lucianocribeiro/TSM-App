import "server-only";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { itemDesdeFila, type LegajoListItem } from "./listado";
import { cargarMiLegajo, type MiLegajoData } from "./mi-legajo";

// Reads for /legajos (Admin), with the Admin's own session: an active
// Admin's RLS reaches every legajo, profile, child, document and request.
// The pages call requireRole("admin") before any of these.

type CuentaEstado = Database["public"]["Enums"]["cuenta_estado"];

// The list: one query with only the columns the table, filters, search and
// KPI cards use, joined to the account state. No children, documents,
// requests or bruto mensual.
export async function cargarListadoLegajos(): Promise<LegajoListItem[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legajos")
    .select(
      "profile_id, nombres, apellido, dni, cuil, numero_legajo, area, puesto, sede, modalidad, estado_laboral, fecha_ingreso, profiles!inner(estado_cuenta)",
    );
  if (error) return null;
  return (data ?? []).map(({ profiles, ...fila }) => itemDesdeFila({ ...fila, estado_cuenta: profiles.estado_cuenta }));
}

export type LegajoAdmin = MiLegajoData & { estadoCuenta: CuentaEstado };

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
  return data ? { ...data, estadoCuenta: profile.estado_cuenta } : null;
}
