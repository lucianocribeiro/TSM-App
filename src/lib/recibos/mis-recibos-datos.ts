import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Reads of the Mis Recibos screen and the menu counter (F2-05, RF-13,
// RF-23), with the employee's session: RLS returns only their own receipts
// in non-draft periods and their own signatures.

type Client = SupabaseClient<Database>;

export type ReciboEmpleado = {
  id: string;
  anio: number;
  mes: number;
  estado: Database["public"]["Enums"]["recibo_estado"];
  firmadoAt: string | null;
};

// Newest period first.
export function ordenarRecibos(recibos: readonly ReciboEmpleado[]): ReciboEmpleado[] {
  return [...recibos].sort((a, b) => b.anio - a.anio || b.mes - a.mes);
}

export async function listarMisRecibos(client: Client): Promise<ReciboEmpleado[] | null> {
  const { data, error } = await client.from("recibos").select("id, estado, firmado_at, recibo_periodos(anio, mes)");
  if (error) return null;
  const filas = (data ?? []).flatMap((fila) => {
    const periodo = fila.recibo_periodos as { anio: number; mes: number } | null;
    return periodo ? [{ id: fila.id, anio: periodo.anio, mes: periodo.mes, estado: fila.estado, firmadoAt: fila.firmado_at }] : [];
  });
  return ordenarRecibos(filas);
}

// Whether the employee has an active registered signature.
export async function tieneFirmaActiva(client: Client, yo: string): Promise<boolean | null> {
  const { data, error } = await client.from("firmas_empleado").select("id").eq("empleado_id", yo).eq("activa", true).limit(1);
  if (error) return null;
  return (data ?? []).length > 0;
}

// The menu counter: visible unsigned receipts of the caller (0 on failure).
export async function contarMisPendientes(client: Client): Promise<number> {
  const { data, error } = await client.rpc("mis_recibos_pendientes_count");
  return error || typeof data !== "number" ? 0 : data;
}
