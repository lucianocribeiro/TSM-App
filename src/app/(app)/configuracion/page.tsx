import { requireRole } from "@/lib/auth/require-role";
import { listarItems } from "@/lib/configuracion/datos";
import { esLista } from "@/lib/configuracion/listas";
import { ConfiguracionScreen } from "./ConfiguracionScreen";

type ConfiguracionPageProps = { searchParams: Promise<{ lista?: string | string[] }> };

// Configuración (PRD "Configuración"): the Admin-maintained lists. Admin
// only: the page guards itself before reading anything, and every action
// checks the role again. ?lista= picks the list shown.
export default async function ConfiguracionPage({ searchParams }: ConfiguracionPageProps) {
  await requireRole("admin");
  const [items, { lista }] = await Promise.all([listarItems(), searchParams]);
  return (
    <ConfiguracionScreen items={items ?? []} listaFallo={items === null} listaInicial={esLista(lista) ? lista : "area"} />
  );
}
