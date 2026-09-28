import { nombreCompleto } from "@/lib/cuentas/listado";
import type { Database } from "@/lib/supabase/database.types";
import type { DocumentoTipo } from "@/lib/documentos/tipos";
import type { CampoGrupo } from "./campos";
import { gruposDeSolicitud } from "./comparacion";

// The approvals inbox list (PRD US-7): pending change requests and pending
// documents together, oldest first. Pure: the rows come from
// src/lib/aprobaciones/bandeja-datos.ts.

type CuentaEstado = Database["public"]["Enums"]["cuenta_estado"];

// The employee a pending item belongs to, as read with the Admin's session.
export type EmpleadoFila = {
  profile_id: string;
  nombres: string | null;
  apellido: string | null;
  numero_legajo: string | null;
  profiles: { estado_cuenta: CuentaEstado };
};

export type SolicitudFila = {
  id: string;
  created_at: string;
  solicitudes_cambio_items: { campo: string }[];
  legajos: EmpleadoFila;
};

export type DocumentoPendienteFila = {
  id: string;
  tipo: DocumentoTipo;
  created_at: string;
  legajos: EmpleadoFila;
};

type ItemBase = {
  id: string;
  profileId: string;
  nombre: string | null;
  numeroLegajo: string | null;
  enviadoEn: string;
  dadoDeBaja: boolean;
  // The signed-in Admin's own legajo: shown, never decided by them.
  propio: boolean;
};

export type ItemBandeja =
  | (ItemBase & { clase: "solicitud"; grupos: CampoGrupo[] })
  | (ItemBase & { clase: "documento"; tipo: DocumentoTipo });

function base(id: string, enviadoEn: string, legajo: EmpleadoFila, adminId: string): ItemBase {
  return {
    id,
    profileId: legajo.profile_id,
    nombre: nombreCompleto(legajo.nombres, legajo.apellido),
    numeroLegajo: legajo.numero_legajo,
    enviadoEn,
    dadoDeBaja: legajo.profiles.estado_cuenta !== "activa",
    propio: legajo.profile_id === adminId,
  };
}

export function armarBandeja(
  solicitudes: readonly SolicitudFila[],
  documentos: readonly DocumentoPendienteFila[],
  adminId: string,
): ItemBandeja[] {
  const items: ItemBandeja[] = [
    ...solicitudes.map((fila) => ({
      ...base(fila.id, fila.created_at, fila.legajos, adminId),
      clase: "solicitud" as const,
      grupos: gruposDeSolicitud(fila.solicitudes_cambio_items.map((item) => item.campo)),
    })),
    ...documentos.map((fila) => ({
      ...base(fila.id, fila.created_at, fila.legajos, adminId),
      clase: "documento" as const,
      tipo: fila.tipo,
    })),
  ];
  // Oldest first; ties in a stable order.
  return items.sort((a, b) => a.enviadoEn.localeCompare(b.enviadoEn) || a.id.localeCompare(b.id));
}

export function rutaItem(item: Pick<ItemBandeja, "clase" | "id">): string {
  return item.clase === "solicitud" ? `/aprobaciones/solicitudes/${item.id}` : `/aprobaciones/documentos/${item.id}`;
}
