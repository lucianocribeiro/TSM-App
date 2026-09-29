import "server-only";
import { redirect } from "next/navigation";
import { HOME_PATH, LOGIN_PATH } from "@/lib/auth/gate";
import { getSessionUser, type AppRole, type SessionUser } from "@/lib/auth/session";

// Server-side role guard for role-restricted pages (Constitution §4). Returns
// the signed-in user when their account is readable, active and has the role;
// otherwise redirects before the page reads any data: no session to /login,
// anything else to /mi-legajo. The route guard in the proxy
// (src/lib/auth/guardia.ts) checks first; this stays as defense in depth.
export async function requireRole(role: AppRole): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(LOGIN_PATH);
  if (user.role !== role || user.cuenta?.estadoCuenta !== "activa") redirect(HOME_PATH);
  return user;
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------
// Every Server Action starts with one of these (the action inventory test,
// src/lib/auth/acciones-inventario.test.ts, enforces it). They read only the
// session and the own profile, and refuse, centrally:
// - no session, or an account that cannot be read;
// - an inactive account;
// - a pending forced password change (PRD US-9, US-11): nothing but changing
//   the password and signing out is allowed until it is done;
// - a role other than the one asked for.
// The two exemptions are explicit at the call site, and the inventory test
// allows them only in the named actions:
// - autorizarAccion({ permitirCambioPendiente: true }): cambiarPassword;
// - sesionParaCerrar(): logout and cerrarSesionPorInactividad.

export type MotivoRechazo = "sin-sesion" | "inactiva" | "cambio-pendiente" | "rol";

export type Acceso = { ok: true; user: SessionUser } | { ok: false; motivo: MotivoRechazo };

export async function autorizarAccion(
  opciones: { rol?: AppRole; permitirCambioPendiente?: true } = {},
): Promise<Acceso> {
  const user = await getSessionUser();
  if (!user || !user.cuenta) return { ok: false, motivo: "sin-sesion" };
  if (user.cuenta.estadoCuenta !== "activa") return { ok: false, motivo: "inactiva" };
  if (user.cuenta.debeCambiarPassword && !opciones.permitirCambioPendiente) {
    return { ok: false, motivo: "cambio-pendiente" };
  }
  if (opciones.rol && user.role !== opciones.rol) return { ok: false, motivo: "rol" };
  return { ok: true, user };
}

// The caller as an active user of any role, or null (refused).
export async function usuarioActivo(): Promise<SessionUser | null> {
  const acceso = await autorizarAccion();
  return acceso.ok ? acceso.user : null;
}

// The caller as an active user with the role, or null (refused). Actions
// answer with an error instead of redirecting.
export async function sessionWithRole(role: AppRole): Promise<SessionUser | null> {
  const acceso = await autorizarAccion({ rol: role });
  return acceso.ok ? acceso.user : null;
}

// Sign-out paths only: they must work for any session, even one the guard
// would refuse, and they touch nothing but the caller's own session.
export async function sesionParaCerrar(): Promise<SessionUser | null> {
  return getSessionUser();
}
