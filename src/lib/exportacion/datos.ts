import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ExportacionRegistrada } from "./historial";

// Reads the export log with the Admin's own session (RLS: an active Admin
// only). The page calls requireRole("admin") first. Newest first, up to
// EXPORTACIONES_LIMITE; null when it could not be read.
export const EXPORTACIONES_LIMITE = 500;

export async function listarExportaciones(): Promise<ExportacionRegistrada[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exportaciones")
    .select("id, actor_id, created_at, campos, incluye_hijos, cantidad, filtros, resultado")
    .order("secuencia", { ascending: false })
    .limit(EXPORTACIONES_LIMITE);
  if (error) return null;
  return (data ?? []).map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    fecha: row.created_at,
    campos: row.campos,
    incluyeHijos: row.incluye_hijos,
    cantidad: row.cantidad,
    filtros: row.filtros,
    resultado: row.resultado,
  }));
}
