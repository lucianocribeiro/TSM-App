import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { decideAccountGate, LOGIN_CUENTA_INACTIVA, PATHNAME_HEADER } from "@/lib/auth/gate";
import { getSessionUser } from "@/lib/auth/session";
import { copy } from "@/lib/copy/es-AR";
import { getNavItems } from "@/lib/nav/nav";
import { parseTheme, THEME_COOKIE } from "@/lib/theme/theme";
import { AppShell } from "./AppShell";

// Session-based access only. The menu depends on the role for presentation;
// per-route role enforcement (requireRole) arrives in F1-10.
// The account gate runs in the proxy on every request; the layout repeats it
// on every full render, for the path the proxy forwards.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  const pathname = (await headers()).get(PATHNAME_HEADER);
  if (user.estadoCuenta === "inactiva") {
    // The proxy clears the session cookies on the way to the login page.
    redirect(LOGIN_CUENTA_INACTIVA);
  }
  if (pathname) {
    const decision = decideAccountGate({
      pathname,
      searchParams: new URLSearchParams(),
      method: "GET",
      estadoCuenta: user.estadoCuenta,
      debeCambiarPassword: user.debeCambiarPassword,
    });
    if (decision.action === "redirect") redirect(decision.to);
  }

  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <AppShell
      // No navigation until the temporary password is changed.
      navItems={user.debeCambiarPassword ? [] : getNavItems(user.role)}
      userEmail={user.email}
      roleLabel={copy.auth.roles[user.role]}
      initialTheme={theme}
    >
      {children}
    </AppShell>
  );
}
