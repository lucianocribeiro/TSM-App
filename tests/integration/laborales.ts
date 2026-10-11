import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/database.types";
import type { TypedClient } from "./helpers";

// Group E fixtures (CR-2): the seeded Configuración items by name, and a
// complete set of group E values built from them. Every write goes through
// legajos_laborales_validar, the service role's too.

export type LaboralUpdate = Database["public"]["Tables"]["legajos_laborales"]["Update"];
type Lista = Database["public"]["Enums"]["catalogo_lista"];

// The id of a seeded item (a Puesto within its Área).
export async function itemId(service: TypedClient, lista: Lista, nombre: string, area?: string): Promise<string> {
  let consulta = service.from("catalogo_items").select("id").eq("lista", lista).eq("nombre", nombre);
  if (area) consulta = consulta.eq("area_id", await itemId(service, "area", area));
  const { data, error } = await consulta.single();
  if (error || !data) throw new Error(`catalog item not found: ${lista} ${nombre}`);
  return data.id;
}

// Every group E field filled. The número de legajo is unique per call.
export async function laboralCompleto(service: TypedClient, prefijo = "E"): Promise<LaboralUpdate> {
  return {
    numero_legajo: `${prefijo}-${randomUUID().slice(0, 8)}`,
    area_id: await itemId(service, "area", "Ventas"),
    puesto_id: await itemId(service, "puesto", "Mostrador (SM)", "Ventas"),
    fecha_ingreso: "2020-01-02",
    estado_laboral: "activo",
    sucursal_id: await itemId(service, "sucursal", "Casa Central"),
    tarea_id: await itemId(service, "tarea", "Ventas"),
    convenio_id: await itemId(service, "convenio", "Comercio"),
    categoria_id: await itemId(service, "categoria", "A"),
  };
}

// The group E row of a legajo, read with the service role.
export async function laboralDe(service: TypedClient, legajoId: string) {
  const { data, error } = await service.from("legajos_laborales").select("*").eq("legajo_id", legajoId).single();
  if (error || !data) throw new Error(`group E row not found: ${error?.message ?? "none"}`);
  return data;
}

// Writes group E with the service role.
export async function escribirLaboral(service: TypedClient, legajoId: string, valores: LaboralUpdate): Promise<void> {
  const { error } = await service.from("legajos_laborales").update(valores).eq("legajo_id", legajoId);
  if (error) throw new Error(`group E write failed: ${error.message}`);
}
