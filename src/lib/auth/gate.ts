import type { Database } from "@/lib/supabase/database.types";

// Account gate (Constitution §10, PRD US-8 and US-9), decided on every request
// for a signed-in user:
// - an account that cannot be verified (the profile read failed or found no
//   row) is signed out and sent to the login page with its own message: the
//   gate fails closed and never assumes an active account;
// - an inactive account is signed out and sent to the login page, which then
//   shows the inactive-account message;
// - a user who must change their password reaches only /cambiar-password.
// /cambiar-password is also where any user, an Admin included, changes their
// own password voluntarily.
// Pure: the proxy applies the decision, and the app layout repeats it for the
// path the proxy forwards.

type CuentaEstado = Database["public"]["Enums"]["cuenta_estado"];

export const CAMBIAR_PASSWORD_PATH = "/cambiar-password";
export const HOME_PATH = "/mi-legajo";
export const LOGIN_PATH = "/login";
// Signs the user out and sends them to the login page with the reason. Used by
// the app layout, which cannot clear cookies itself.
export const SALIR_PATH = "/auth/salir";

// Query parameter the login page reads to show why the session ended.
export const CUENTA_PARAM = "cuenta";
export const CUENTA_INACTIVA = "inactiva";
export const CUENTA_NO_VERIFICADA = "no-verificada";
export type MotivoSalida = typeof CUENTA_INACTIVA | typeof CUENTA_NO_VERIFICADA;

export function loginConMotivo(motivo: MotivoSalida): string {
  return `${LOGIN_PATH}?${CUENTA_PARAM}=${motivo}`;
}
export const LOGIN_CUENTA_INACTIVA = loginConMotivo(CUENTA_INACTIVA);
export const LOGIN_CUENTA_NO_VERIFICADA = loginConMotivo(CUENTA_NO_VERIFICADA);

// Request header with the pathname, set by the proxy for the app layout.
export const PATHNAME_HEADER = "x-tsm-pathname";

// The account state read from the own profile; null when it could not be read.
export type CuentaActual = {
  estadoCuenta: CuentaEstado;
  debeCambiarPassword: boolean;
} | null;

export type GateInput = {
  pathname: string;
  searchParams: URLSearchParams;
  method: string;
  cuenta: CuentaActual;
};

export type GateDecision =
  | { action: "continue" }
  | { action: "redirect"; to: string }
  // Clear the session; then go to `to`, or render the request as is when null.
  | { action: "signOut"; to: string | null };

// Redirects apply to page loads and navigations only; a form post keeps its
// own response (the Server Action decides).
function isNavigation(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function signOutTo(input: GateInput, motivo: MotivoSalida): GateDecision {
  const alreadyThere =
    input.pathname === LOGIN_PATH && input.searchParams.get(CUENTA_PARAM) === motivo;
  return { action: "signOut", to: alreadyThere ? null : loginConMotivo(motivo) };
}

// Why a session must end, or null when the account may continue.
export function motivoSalida(cuenta: CuentaActual): MotivoSalida | null {
  if (cuenta === null) return CUENTA_NO_VERIFICADA;
  if (cuenta.estadoCuenta !== "activa") return CUENTA_INACTIVA;
  return null;
}

export function decideAccountGate(input: GateInput): GateDecision {
  const cuenta = input.cuenta;
  if (cuenta === null) return signOutTo(input, CUENTA_NO_VERIFICADA);
  if (cuenta.estadoCuenta !== "activa") return signOutTo(input, CUENTA_INACTIVA);

  if (!isNavigation(input.method)) return { action: "continue" };

  if (cuenta.debeCambiarPassword && input.pathname !== CAMBIAR_PASSWORD_PATH) {
    return { action: "redirect", to: CAMBIAR_PASSWORD_PATH };
  }
  return { action: "continue" };
}
