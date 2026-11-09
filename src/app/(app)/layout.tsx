import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { contarPendientes } from "@/lib/aprobaciones/bandeja-datos";
import { decideAccountGate, PATHNAME_HEADER, SALIR_PATH } from "@/lib/auth/gate";
import { getSessionUser } from "@/lib/auth/session";
import { copy } from "@/lib/copy/es-AR";
import { MENU_COOKIE, parseEstadoMenu } from "@/lib/nav/menu";
import { getNavItems } from "@/lib/nav/nav";
import { contarMisPendientes } from "@/lib/recibos/mis-recibos-datos";
import { createClient } from "@/lib/supabase/server";
import { parseTheme, THEME_COOKIE } from "@/lib/theme/theme";
import { AppShell } from "./AppShell";

// Session-based access only. The menu depends on the role for presentation;
// roles are enforced by the route guard in the proxy and by each page
// (requireRole) and action.
// The account gate runs in the proxy on every request; the layout repeats it
// on every full render, for the path the proxy forwards. A session that must
// end (account inactive or not verifiable) goes to /auth/salir, which clears
// the cookies: a layout cannot.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  const pathname = (await headers()).get(PATHNAME_HEADER);
  const decision = decideAccountGate({
    pathname: pathname ?? "",
    searchParams: new URLSearchParams(),
    method: "GET",
    cuenta: user.cuenta,
  });
  const cuenta = user.cuenta;
  if (decision.action === "signOut" || cuenta === null) {
    redirect(SALIR_PATH);
  }
  // Without the forwarded path the layout cannot tell which page this is (and
  // would loop on /cambiar-password); the proxy has redirected already.
  if (decision.action === "redirect" && pathname) {
    redirect(decision.to);
  }

  const cookieStore = await cookies();
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);
  const menu = parseEstadoMenu(cookieStore.get(MENU_COOKIE)?.value);
  // The approvals bell: an active Admin past the forced password change only.
  // pendientes_admin() refuses anyone else, so the count never reaches them.
  const conBell = user.role === "admin" && cuenta.estadoCuenta === "activa" && !cuenta.debeCambiarPassword;
  const pendientes = conBell ? ((await contarPendientes()) ?? 0) : null;
  // The Mis Recibos counter (RF-23): an active Empleado past the forced
  // password change; the count is the caller's own, under RLS.
  const conRecibos = user.role === "empleado" && cuenta.estadoCuenta === "activa" && !cuenta.debeCambiarPassword;
  const misRecibosPendientes = conRecibos ? await contarMisPendientes(await createClient()) : 0;

  return (
    <AppShell
      // No navigation until the temporary password is changed.
      navItems={cuenta.debeCambiarPassword ? [] : getNavItems(user.role, { misRecibosPendientes })}
      showCambiarPassword={!cuenta.debeCambiarPassword}
      userEmail={user.email}
      roleLabel={copy.auth.roles[user.role]}
      initialTheme={theme}
      initialMenu={menu}
      pendientes={pendientes}
      cambioPendiente={cuenta.debeCambiarPassword}
    >
      {children}
    </AppShell>
  );
}
