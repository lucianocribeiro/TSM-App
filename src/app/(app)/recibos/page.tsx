import { requireRole } from "@/lib/auth/require-role";
import { filasDelPeriodo, listarPeriodos } from "@/lib/recibos/carga-datos";
import { createClient } from "@/lib/supabase/server";
import { CargaRecibosScreen } from "./CargaRecibosScreen";

// Decision 9 (F2-04): the receipts screen and its Server Actions run for at
// most 30 seconds, so a PDF that overruns the 5-second DNI text limit cannot
// hold the function longer than that.
export const maxDuration = 30;

type RecibosPageProps = { searchParams: Promise<{ periodo?: string | string[] }> };

// Carga de recibos (PRD Fase 2 RF-05, RF-06): one screen, a period at a
// time (?periodo=, else the newest), one row per active Empleado. Admin only:
// the page guards itself before reading anything, and every action checks
// the role again.
export default async function RecibosPage({ searchParams }: RecibosPageProps) {
  await requireRole("admin");
  const supabase = await createClient();
  const [periodos, { periodo }] = await Promise.all([listarPeriodos(supabase), searchParams]);
  const elegido = periodos?.find((p) => p.id === periodo) ?? periodos?.[0] ?? null;
  const filas = elegido ? await filasDelPeriodo(supabase, elegido.id) : [];
  return (
    <CargaRecibosScreen
      periodos={periodos ?? []}
      periodo={elegido}
      filas={filas ?? []}
      listaFallo={periodos === null || filas === null}
    />
  );
}
