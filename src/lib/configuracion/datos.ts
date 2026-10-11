import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { EventoCatalogo } from "./historial";
import type { CatalogoItem } from "./listas";

// Reads of the Configuración lists and their history with the caller's
// session: RLS lets only an active Admin read them. Null on a read error.

export const HISTORIAL_LIMITE = 500;

export async function listarItems(): Promise<CatalogoItem[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalogo_items")
    .select("id, lista, nombre, area_id, posicion, activo, version")
    .order("posicion");
  if (error) return null;
  return (data ?? []).map((row) => ({
    id: row.id,
    lista: row.lista,
    nombre: row.nombre,
    areaId: row.area_id,
    posicion: row.posicion,
    activo: row.activo,
    version: row.version,
  }));
}

// Newest first (secuencia breaks ties within one change), the latest
// HISTORIAL_LIMITE.
export async function listarEventos(): Promise<EventoCatalogo[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalogo_eventos")
    .select("id, lista, item_nombre, area_nombre, accion, valor_anterior, valor_nuevo, actor_id, created_at")
    .order("secuencia", { ascending: false })
    .limit(HISTORIAL_LIMITE);
  if (error) return null;
  return (data ?? []).map((row) => ({
    id: row.id,
    lista: row.lista,
    itemNombre: row.item_nombre,
    areaNombre: row.area_nombre,
    accion: row.accion,
    valorAnterior: row.valor_anterior,
    valorNuevo: row.valor_nuevo,
    actorId: row.actor_id,
    fecha: row.created_at,
  }));
}
