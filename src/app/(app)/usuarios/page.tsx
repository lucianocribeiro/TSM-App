import { listarCuentas } from "@/lib/admin/cuentas";
import { requireRole } from "@/lib/auth/require-role";
import { UsuariosScreen } from "./UsuariosScreen";

// Usuarios (PRD US-5, US-8, US-9). Admin only: the page guards itself before
// reading any account data, and every action checks the role again.
export default async function UsuariosPage() {
  const user = await requireRole("admin");
  const result = await listarCuentas();

  return (
    <UsuariosScreen
      cuentas={result.ok ? (result.data ?? []) : []}
      listaFallo={!result.ok}
      propiaId={user.id}
    />
  );
}
