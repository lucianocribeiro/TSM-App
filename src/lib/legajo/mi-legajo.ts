import "server-only";
import type { HijoValor } from "@/lib/aprobaciones/solicitudes";
import type { DocumentoFila } from "@/lib/documentos/resumen";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Everything /mi-legajo shows, read with the user's own session: RLS limits
// every query to their legajo, children, documents and requests. /legajos
// reuses it for any employee with an Admin's session (whose RLS reaches all).

type LegajoRow = Database["public"]["Tables"]["legajos"]["Row"];
type SolicitudEstado = Database["public"]["Enums"]["solicitud_estado"];

export type SolicitudActual = {
  id: string;
  estado: SolicitudEstado;
  motivoRechazo: string | null;
  items: { campo: string; valorPropuesto: string | null; valorAnterior: string | null }[];
};

export type MiLegajoData = {
  legajo: LegajoRow;
  hijos: HijoValor[];
  documentos: DocumentoFila[];
  // The latest change request, whatever its state (null when there is none).
  solicitud: SolicitudActual | null;
};

export async function cargarMiLegajo(profileId: string): Promise<MiLegajoData | null> {
  const supabase = await createClient();
  const { data: legajo, error } = await supabase
    .from("legajos")
    .select("*")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error || !legajo) return null;

  const [hijos, documentos, solicitudes] = await Promise.all([
    supabase
      .from("legajo_hijos")
      .select("nombre_completo, fecha_nacimiento")
      .eq("legajo_id", legajo.id)
      .order("fecha_nacimiento")
      .order("nombre_completo"),
    supabase
      .from("legajo_documentos")
      .select("id, tipo, estado, file_name, created_at, motivo_rechazo, reemplazado_en, reemplazado_por")
      .eq("legajo_id", legajo.id),
    supabase
      .from("solicitudes_cambio")
      .select("id, estado, motivo_rechazo, solicitudes_cambio_items (campo, valor_propuesto, valor_anterior)")
      .eq("legajo_id", legajo.id)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  if (hijos.error || documentos.error || solicitudes.error) return null;

  const ultima = solicitudes.data?.[0];
  return {
    legajo,
    hijos: hijos.data ?? [],
    documentos: (documentos.data ?? []).map((row) => ({
      id: row.id,
      tipo: row.tipo,
      estado: row.estado,
      fileName: row.file_name,
      creadoEn: row.created_at,
      motivoRechazo: row.motivo_rechazo,
      reemplazadoEn: row.reemplazado_en,
      reemplazadoPor: row.reemplazado_por,
    })),
    solicitud: ultima
      ? {
          id: ultima.id,
          estado: ultima.estado,
          motivoRechazo: ultima.motivo_rechazo,
          items: ultima.solicitudes_cambio_items.map((item) => ({
            campo: item.campo,
            valorPropuesto: item.valor_propuesto,
            valorAnterior: item.valor_anterior,
          })),
        }
      : null,
  };
}
