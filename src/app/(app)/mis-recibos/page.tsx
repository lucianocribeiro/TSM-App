import { requireRole } from "@/lib/auth/require-role";
import { urlMiFirma } from "@/lib/recibos/firma";
import { listarMisRecibos, tieneFirmaActiva } from "@/lib/recibos/mis-recibos-datos";
import { createClient } from "@/lib/supabase/server";
import { MisRecibosScreen } from "./MisRecibosScreen";

// Signing stamps the PDF on the server: the screen and its Server Actions run
// for at most 30 seconds (F2-05).
export const maxDuration = 30;

// Mis Recibos (PRD Fase 2 RF-13 to RF-18): the employee's own receipts from
// published and closed periods, newest first, and their signature. Empleado
// only: the page guards itself before reading anything, and every action
// checks the role again.
export default async function MisRecibosPage() {
  const yo = await requireRole("empleado");
  const supabase = await createClient();
  const [recibos, tieneFirma, firma] = await Promise.all([
    listarMisRecibos(supabase),
    tieneFirmaActiva(supabase, yo.id),
    // The preview of the current signature (a 5-minute signed URL).
    urlMiFirma(supabase, yo.id, {}),
  ]);
  return (
    <MisRecibosScreen
      recibos={recibos ?? []}
      firmaInicial={firma.ok ? (firma.data ?? null) : null}
      tieneFirma={tieneFirma === true}
      listaFallo={recibos === null || tieneFirma === null}
    />
  );
}
