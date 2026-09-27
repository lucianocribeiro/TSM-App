import "server-only";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Account history (cuenta_eventos) read with the caller's session: RLS lets
// an Admin read every account's events. Newest first. Null on a read error.

type CuentaEventoTipo = Database["public"]["Enums"]["cuenta_evento_tipo"];

export type EventoCuenta = {
  id: string;
  tipo: CuentaEventoTipo;
  motivo: string | null;
  actorId: string;
  fecha: string;
};

export async function obtenerHistorial(profileId: string): Promise<EventoCuenta[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cuenta_eventos")
    .select("id, tipo, motivo, actor_id, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });
  if (error) return null;
  return (data ?? []).map((row) => ({
    id: row.id,
    tipo: row.tipo,
    motivo: row.motivo,
    actorId: row.actor_id,
    fecha: row.created_at,
  }));
}
