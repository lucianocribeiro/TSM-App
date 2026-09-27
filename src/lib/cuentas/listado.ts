import type { Database } from "@/lib/supabase/database.types";

// Accounts list for the Usuarios screen (PRD US-5, US-8). Pure helpers: the
// data comes from listarCuentas (src/lib/admin/cuentas.ts).

type AppRole = Database["public"]["Enums"]["app_role"];
type CuentaEstado = Database["public"]["Enums"]["cuenta_estado"];

export type CuentaListItem = {
  id: string;
  email: string;
  rol: AppRole;
  estado: CuentaEstado;
  debeCambiarPassword: boolean;
  // From the legajo, when nombres or apellido are filled.
  nombre: string | null;
};

export type FiltroEstado = "activas" | "todas";
export const FILTROS_ESTADO: readonly FiltroEstado[] = ["activas", "todas"];

export function nombreCompleto(nombres: string | null, apellido: string | null): string | null {
  const nombre = [nombres, apellido]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  return nombre || null;
}

// Lower case, no accents, single spaces: "José  Pérez" matches "jose perez".
export function normalizarBusqueda(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Inactive accounts only with "todas"; the search matches email or name,
// ignoring case and accents. Sorted by name (accounts without one last), then email.
export function filtrarCuentas(
  cuentas: readonly CuentaListItem[],
  { filtro, busqueda }: { filtro: FiltroEstado; busqueda: string },
): CuentaListItem[] {
  const term = normalizarBusqueda(busqueda);
  return cuentas
    .filter((cuenta) => filtro === "todas" || cuenta.estado === "activa")
    .filter(
      (cuenta) =>
        !term ||
        normalizarBusqueda(cuenta.email).includes(term) ||
        normalizarBusqueda(cuenta.nombre ?? "").includes(term),
    )
    .sort(compararCuentas);
}

function compararCuentas(a: CuentaListItem, b: CuentaListItem): number {
  if (a.nombre && b.nombre) {
    const byName = a.nombre.localeCompare(b.nombre, "es-AR");
    if (byName !== 0) return byName;
  } else if (a.nombre || b.nombre) {
    return a.nombre ? -1 : 1;
  }
  return a.email.localeCompare(b.email, "es-AR");
}
