import { requireRole } from "@/lib/auth/require-role";
import { listarItems, listarItemsReferenciados } from "@/lib/configuracion/datos";
import { esLista } from "@/lib/configuracion/listas";
import { ConfiguracionScreen } from "./ConfiguracionScreen";

type ConfiguracionPageProps = { searchParams: Promise<{ lista?: string | string[] }> };

// Configuración (PRD "Configuración"): the Admin-maintained lists. Admin
// only: the page guards itself before reading anything, and every action
// checks the role again. ?lista= picks the list shown.
export default async function ConfiguracionPage({ searchParams }: ConfiguracionPageProps) {
  await requireRole("admin");
  const [items, referenciados, { lista }] = await Promise.all([listarItems(), listarItemsReferenciados(), searchParams]);
  const fallo = items === null || referenciados === null;
  return (
    <ConfiguracionScreen
      items={fallo ? [] : items}
      enUsoIds={fallo ? [] : [...referenciados]}
      listaFallo={fallo}
      listaInicial={esLista(lista) ? lista : "area"}
    />
  );
}
