import { Suspense } from "react";
import { requireRole } from "@/lib/auth/require-role";
import { cargarListadoLegajos } from "@/lib/legajo/admin-legajos";
import { LegajosScreen } from "./LegajosScreen";
import { RecibosSinFirmar, RecibosSinFirmarCargando } from "./RecibosSinFirmar";

// Legajos (PRD US-4, US-8). Admin only: the page guards itself before reading
// any legajo, and every action checks the role again. The "Recibos sin
// firmar" card (PRD Fase 2 RF-22) streams in on its own.
export default async function LegajosPage() {
  await requireRole("admin");
  const listado = await cargarListadoLegajos();
  return (
    <LegajosScreen
      legajos={listado?.legajos ?? []}
      items={listado?.items ?? []}
      listaFallo={listado === null}
      kpi={
        <Suspense fallback={<RecibosSinFirmarCargando />}>
          <RecibosSinFirmar />
        </Suspense>
      }
    />
  );
}
