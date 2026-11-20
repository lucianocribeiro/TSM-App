import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { listarPeriodos } from "@/lib/recibos/carga-datos";
import { cargarDetalleRecibo, cargarEstadoPeriodo } from "@/lib/recibos/estado";
import { createClient } from "@/lib/supabase/server";
import { EstadoFirmasScreen } from "./EstadoFirmasScreen";

// The receipts screens and their Server Actions run for at most 30 seconds
// (PRD Fase 2 §6).
export const maxDuration = 30;

type EstadoPageProps = { searchParams: Promise<{ periodo?: string | string[]; recibo?: string | string[] }> };

const UUID = z.uuid();
const uuidDe = (valor: string | string[] | undefined) => {
  const parsed = UUID.safeParse(valor);
  return parsed.success ? parsed.data : null;
};

// Estado de firmas (PRD Fase 2 RF-19 to RF-21, F2-06): a period at a time
// (?periodo=, else the newest, as in Carga), one row per employee, and the
// detail of one receipt (?recibo=). Admin only: the /recibos layout and this
// page guard before reading, and the loaders check the role again.
export default async function EstadoFirmasPage({ searchParams }: EstadoPageProps) {
  await requireRole("admin");
  const supabase = await createClient();
  const [periodos, params] = await Promise.all([listarPeriodos(supabase), searchParams]);
  const elegido = periodos?.find((p) => p.id === uuidDe(params.periodo)) ?? periodos?.[0] ?? null;
  const reciboId = uuidDe(params.recibo);
  const [estado, detalle] = await Promise.all([
    elegido ? cargarEstadoPeriodo(elegido.id) : Promise.resolve(null),
    reciboId ? cargarDetalleRecibo(reciboId) : Promise.resolve(null),
  ]);
  return (
    <EstadoFirmasScreen
      periodos={periodos ?? []}
      periodo={elegido}
      estado={estado}
      listaFallo={periodos === null || (elegido !== null && estado === null)}
      detalle={detalle}
      detalleFallo={reciboId !== null && detalle === null}
    />
  );
}
