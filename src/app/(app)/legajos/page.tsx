import { requireRole } from "@/lib/auth/require-role";
import { cargarListadoLegajos } from "@/lib/legajo/admin-legajos";
import { calcularKpis } from "@/lib/legajo/kpis";
import { LegajosScreen } from "./LegajosScreen";

// Legajos (PRD US-4, US-8). Admin only: the page guards itself before reading
// any legajo, and every action checks the role again.
export default async function LegajosPage() {
  await requireRole("admin");
  const legajos = await cargarListadoLegajos();
  // KPI cards over the whole workforce, computed here (Argentina's month).
  const kpis = legajos ? calcularKpis(legajos) : null;
  return <LegajosScreen legajos={legajos ?? []} listaFallo={legajos === null} kpis={kpis} />;
}
