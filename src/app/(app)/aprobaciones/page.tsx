import { requireRole } from "@/lib/auth/require-role";
import { cargarBandeja } from "@/lib/aprobaciones/bandeja-datos";
import { esResultadoDecision } from "@/lib/aprobaciones/resultado";
import { AprobacionesScreen } from "./AprobacionesScreen";

type AprobacionesPageProps = { searchParams: Promise<{ resultado?: string | string[] }> };

// The approvals inbox (PRD US-7). Admin only: the page guards itself before
// reading anything, and every action checks the role again.
export default async function AprobacionesPage({ searchParams }: AprobacionesPageProps) {
  const admin = await requireRole("admin");
  const items = await cargarBandeja(admin.id);
  const { resultado } = await searchParams;
  return (
    <AprobacionesScreen
      items={items ?? []}
      listaFallo={items === null}
      resultado={esResultadoDecision(resultado) ? resultado : null}
    />
  );
}
