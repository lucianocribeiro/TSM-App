import { requireRole } from "@/lib/auth/require-role";
import { cargarListadoLegajos } from "@/lib/legajo/admin-legajos";
import { LegajosScreen } from "./LegajosScreen";

// Legajos (PRD US-4, US-8). Admin only: the page guards itself before reading
// any legajo, and every action checks the role again.
export default async function LegajosPage() {
  await requireRole("admin");
  const listado = await cargarListadoLegajos();
  return (
    <LegajosScreen
      legajos={listado?.legajos ?? []}
      items={listado?.items ?? []}
      listaFallo={listado === null}
    />
  );
}
