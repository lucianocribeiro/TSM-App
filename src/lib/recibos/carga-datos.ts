import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listarCuentas } from "@/lib/admin/cuentas";
import { copyRecibos, type EstadoFilaRecibo } from "@/lib/copy/recibos";
import { nombreCompleto, normalizarBusqueda } from "@/lib/cuentas/listado";
import type { Database } from "@/lib/supabase/database.types";

// Reads of the Carga de recibos screen (F2-04, RF-05, RF-06), with the
// Admin's session (RLS). Rows: active Empleado accounts only (decision 1),
// by surname. Never a raw id on screen: the name, else the email, else the
// fallback copy (RF-21).

type Client = SupabaseClient<Database>;
type PeriodoEstado = Database["public"]["Enums"]["recibo_periodo_estado"];

export type PeriodoVista = { id: string; anio: number; mes: number; estado: PeriodoEstado };
export type FilaCarga = { empleadoId: string; nombre: string; estado: EstadoFilaRecibo; reciboId: string | null };

// Newest first.
export async function listarPeriodos(client: Client): Promise<PeriodoVista[] | null> {
  const { data, error } = await client
    .from("recibo_periodos")
    .select("id, anio, mes, estado")
    .order("anio", { ascending: false })
    .order("mes", { ascending: false });
  return error ? null : (data ?? []);
}

type Persona = { id: string; nombres: string | null; apellido: string | null; email: string | null };

// By surname, then first names, then the shown name (es-AR, accents ignored).
export function ordenarPersonas<T extends Persona>(personas: readonly T[]): T[] {
  const clave = (p: Persona) =>
    [p.apellido, p.nombres, p.email].map((parte) => normalizarBusqueda(parte ?? "") || "￿");
  return [...personas].sort((a, b) => {
    const [ka, kb] = [clave(a), clave(b)];
    for (let i = 0; i < ka.length; i++) {
      const orden = ka[i].localeCompare(kb[i], "es-AR");
      if (orden !== 0) return orden;
    }
    return 0;
  });
}

export function nombreVisible(p: Persona): string {
  return nombreCompleto(p.nombres, p.apellido) ?? (p.email?.trim() || copyRecibos.usuarioNoDisponible);
}

export async function filasDelPeriodo(client: Client, periodoId: string): Promise<FilaCarga[] | null> {
  const [perfiles, recibos] = await Promise.all([
    client.from("profiles").select("id").eq("role", "empleado").eq("estado_cuenta", "activa"),
    client.from("recibos").select("id, empleado_id, estado").eq("periodo_id", periodoId),
  ]);
  if (perfiles.error || recibos.error) return null;
  const ids = (perfiles.data ?? []).map((perfil) => perfil.id);
  if (ids.length === 0) return [];

  const legajos = await client.from("legajos").select("profile_id, nombres, apellido").in("profile_id", ids);
  if (legajos.error) return null;
  const porPerfil = new Map((legajos.data ?? []).map((legajo) => [legajo.profile_id, legajo]));

  // Emails only for whoever has no name in the legajo.
  let emails = new Map<string, string>();
  if (ids.some((id) => !nombreCompleto(porPerfil.get(id)?.nombres ?? null, porPerfil.get(id)?.apellido ?? null))) {
    const cuentas = await listarCuentas();
    if (cuentas.ok) emails = new Map((cuentas.data ?? []).map((cuenta) => [cuenta.id, cuenta.email]));
    else console.error("[recibos] account lookup failed; unnamed employees shown with the fallback");
  }

  const personas = ids.map((id) => ({
    id,
    nombres: porPerfil.get(id)?.nombres ?? null,
    apellido: porPerfil.get(id)?.apellido ?? null,
    email: emails.get(id) || null,
  }));
  const reciboDe = new Map((recibos.data ?? []).map((recibo) => [recibo.empleado_id, recibo]));
  return ordenarPersonas(personas).map((persona) => {
    const recibo = reciboDe.get(persona.id);
    return {
      empleadoId: persona.id,
      nombre: nombreVisible(persona),
      estado: !recibo ? "sin_recibo" : recibo.estado === "firmado" ? "firmado" : "cargado",
      reciboId: recibo?.id ?? null,
    };
  });
}
