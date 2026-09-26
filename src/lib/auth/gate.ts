import type { Database } from "@/lib/supabase/database.types";

// Account gate (Constitution §10, PRD US-8 and US-9), decided on every request
// for a signed-in user whose profile could be read:
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
// Query parameter the login page reads to show the inactive-account message.
export const CUENTA_INACTIVA_PARAM = "cuenta";
export const CUENTA_INACTIVA_VALUE = "inactiva";
export const LOGIN_CUENTA_INACTIVA = `${LOGIN_PATH}?${CUENTA_INACTIVA_PARAM}=${CUENTA_INACTIVA_VALUE}`;
// Request header with the pathname, set by the proxy for the app layout.
export const PATHNAME_HEADER = "x-tsm-pathname";

export type GateInput = {
  pathname: string;
  searchParams: URLSearchParams;
  method: string;
  estadoCuenta: CuentaEstado;
  debeCambiarPassword: boolean;
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

export function decideAccountGate(input: GateInput): GateDecision {
  if (input.estadoCuenta === "inactiva") {
    const onInactiveLogin =
      input.pathname === LOGIN_PATH &&
      input.searchParams.get(CUENTA_INACTIVA_PARAM) === CUENTA_INACTIVA_VALUE;
    return { action: "signOut", to: onInactiveLogin ? null : LOGIN_CUENTA_INACTIVA };
  }

  if (!isNavigation(input.method)) return { action: "continue" };

  if (input.debeCambiarPassword && input.pathname !== CAMBIAR_PASSWORD_PATH) {
    return { action: "redirect", to: CAMBIAR_PASSWORD_PATH };
  }
  return { action: "continue" };
}
