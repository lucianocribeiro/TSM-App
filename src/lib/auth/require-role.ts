import "server-only";
import { redirect } from "next/navigation";
import { HOME_PATH, LOGIN_PATH } from "@/lib/auth/gate";
import { getSessionUser, type AppRole, type SessionUser } from "@/lib/auth/session";

// Server-side role guard for role-restricted pages (Constitution §4). Returns
// the signed-in user when their account is readable, active and has the role;
// otherwise redirects before the page reads any data: no session to /login,
// anything else to /mi-legajo. The global route guards arrive in F1-10.
export async function requireRole(role: AppRole): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(LOGIN_PATH);
  if (user.role !== role || user.cuenta?.estadoCuenta !== "activa") redirect(HOME_PATH);
  return user;
}

// The same check for Server Actions, which answer with an error instead of
// redirecting. Null when the caller is not an active user with the role.
export async function sessionWithRole(role: AppRole): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user || user.role !== role || user.cuenta?.estadoCuenta !== "activa") return null;
  return user;
}
