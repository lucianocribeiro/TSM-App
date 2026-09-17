import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSessionUser } from "@/lib/auth/session";
import { copy } from "@/lib/copy/es-AR";
import { getNavItems } from "@/lib/nav/nav";
import { parseTheme, THEME_COOKIE } from "@/lib/theme/theme";
import { AppShell } from "./AppShell";

// Session-based access only. The menu depends on the role for presentation;
// per-route role enforcement (requireRole) arrives in F1-10.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <AppShell
      navItems={getNavItems(user.role)}
      userEmail={user.email}
      roleLabel={copy.auth.roles[user.role]}
      initialTheme={theme}
    >
      {children}
    </AppShell>
  );
}
