import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";

// The Admin's approvals indicator (Constitution §9): one number, the pending
// change requests plus the pending documents from pendientes_admin().

export const TOPE_CAMPANA = 9;

export type PendientesAdmin = { solicitudes: number; documentos: number };

export function totalPendientes(pendientes: PendientesAdmin): number {
  return Math.max(0, pendientes.solicitudes) + Math.max(0, pendientes.documentos);
}

// The badge text: nothing at zero, the number up to the cap, then "9+".
export function textoCampana(total: number): string | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return total > TOPE_CAMPANA ? copy.campana.tope : String(Math.floor(total));
}

// The link's accessible name, with the exact number.
export function etiquetaCampana(total: number): string {
  return total > 0 ? formatCopy(copy.campana.pendientes, { n: String(total) }) : copy.campana.sinPendientes;
}
