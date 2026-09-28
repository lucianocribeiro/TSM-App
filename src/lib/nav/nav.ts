import type { Database } from "@/lib/supabase/database.types";
import { copy } from "@/lib/copy/es-AR";

type AppRole = Database["public"]["Enums"]["app_role"];

export type NavItem = {
  href: string;
  label: string;
  number: string;
};

const entries: Array<{ href: string; label: string; roles: AppRole[] }> = [
  { href: "/mi-legajo", label: copy.nav.miLegajo, roles: ["empleado", "admin"] },
  { href: "/legajos", label: copy.nav.legajos, roles: ["admin"] },
  { href: "/aprobaciones", label: copy.nav.aprobaciones, roles: ["admin"] },
  { href: "/usuarios", label: copy.nav.usuarios, roles: ["admin"] },
];

// Menu items for a role (Constitution §6). Presentation only: the route guard
// (src/lib/auth/guardia.ts) and the pages enforce the roles.
export function getNavItems(role: AppRole): NavItem[] {
  return entries
    .filter((entry) => entry.roles.includes(role))
    .map((entry, index) => ({
      href: entry.href,
      label: entry.label,
      number: String(index + 1).padStart(2, "0"),
    }));
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
