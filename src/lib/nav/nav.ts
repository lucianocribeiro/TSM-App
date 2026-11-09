import type { Database } from "@/lib/supabase/database.types";
import { copy } from "@/lib/copy/es-AR";
import { formatCopy } from "@/lib/copy/format";

type AppRole = Database["public"]["Enums"]["app_role"];

export type NavItem = {
  href: string;
  label: string;
  number: string;
  // A count shown next to the label, and the link's accessible name with it.
  badge?: string;
  ariaLabel?: string;
};

// What the menu shows beside items (F2-05: the employee's unsigned receipts).
export type NavContadores = { misRecibosPendientes?: number };

const entries: Array<{ href: string; label: string; roles: AppRole[] }> = [
  { href: "/mi-legajo", label: copy.nav.miLegajo, roles: ["empleado", "admin"] },
  { href: "/mis-recibos", label: copy.nav.misRecibos, roles: ["empleado"] },
  { href: "/legajos", label: copy.nav.legajos, roles: ["admin"] },
  { href: "/aprobaciones", label: copy.nav.aprobaciones, roles: ["admin"] },
  { href: "/recibos", label: copy.nav.recibos, roles: ["admin"] },
  { href: "/usuarios", label: copy.nav.usuarios, roles: ["admin"] },
  { href: "/configuracion", label: copy.nav.configuracion, roles: ["admin"] },
];

// Menu items for a role (Constitution §6). Presentation only: the route guard
// (src/lib/auth/guardia.ts) and the pages enforce the roles.
export function getNavItems(role: AppRole, contadores: NavContadores = {}): NavItem[] {
  return entries
    .filter((entry) => entry.roles.includes(role))
    .map((entry, index) => {
      const item: NavItem = { href: entry.href, label: entry.label, number: String(index + 1).padStart(2, "0") };
      const pendientes = entry.href === "/mis-recibos" ? (contadores.misRecibosPendientes ?? 0) : 0;
      if (pendientes > 0) {
        item.badge = String(pendientes);
        item.ariaLabel = formatCopy(pendientes === 1 ? copy.nav.misRecibosPendiente : copy.nav.misRecibosPendientes, {
          label: entry.label,
          n: String(pendientes),
        });
      }
      return item;
    });
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
