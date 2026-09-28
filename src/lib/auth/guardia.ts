import type { Database } from "@/lib/supabase/database.types";
import {
  CAMBIAR_PASSWORD_PATH,
  HOME_PATH,
  LOGIN_PATH,
  loginConMotivo,
  motivoSalida,
  type CuentaActual,
} from "./gate";
import { VOLVER_PARAM } from "./retorno";
import { clasificarRuta, type ClaseRuta } from "./rutas";

// The central route guard (PRD session rules), decided in the proxy for every
// matched request. Pure. Checks, in order:
// 1. no session: public routes pass; anything else goes to the login page,
//    with the requested path as ?volver= (sanitized again on use);
// 2. the account is inactive or cannot be verified: sign out, login page
//    with the reason (the account gate of F1-07A);
// 3. a forced password change is pending: only /cambiar-password (and the
//    public routes, sign-out included);
// 4. role: Admin routes need an active Admin; a route not in the map is
//    denied; both go to /mi-legajo;
// 5. inactivity: a missing, invalid or expired activity marker ends the
//    session, login page with the inactivity message.
// Redirects apply to page loads and navigations (GET, HEAD). Any other
// request (a Server Action) is never redirected: a session that must end is
// cleared and the request goes on without it, and every action checks the
// session and role on its own (the action inventory test enforces it).

type AppRole = Database["public"]["Enums"]["app_role"];

export const SESION_PARAM = "sesion";
export const SESION_INACTIVIDAD = "inactividad";
export const LOGIN_INACTIVIDAD = `${LOGIN_PATH}?${SESION_PARAM}=${SESION_INACTIVIDAD}`;

export type SesionGuardia = {
  cuenta: CuentaActual;
  rol: AppRole | null;
  // The activity marker is present, genuine, of this session and recent.
  actividadVigente: boolean;
};

export type GuardiaInput = {
  pathname: string;
  search: string;
  searchParams: URLSearchParams;
  method: string;
  // Null: no session.
  sesion: SesionGuardia | null;
};

export type GuardiaDecision =
  // contarActividad: the request may re-stamp the activity marker (the proxy
  // still leaves prefetches out).
  | { accion: "seguir"; contarActividad: boolean }
  | { accion: "redirigir"; a: string }
  // Clear the session; then go to `a`, or let the request go on when null.
  | { accion: "cerrar"; a: string | null };

function esNavegacion(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function loginCon(pathname: string, search: string, clase: ClaseRuta | null): string {
  // Only mapped, non-public routes are worth coming back to; "/" is home anyway.
  if (clase === null || clase === "publica" || pathname === "/") return LOGIN_PATH;
  return `${LOGIN_PATH}?${VOLVER_PARAM}=${encodeURIComponent(pathname + search)}`;
}

// Sign out and show the reason, unless the login page already shows it.
function cerrarHacia(input: GuardiaInput, destino: string): GuardiaDecision {
  if (!esNavegacion(input.method)) return { accion: "cerrar", a: null };
  const url = new URL(destino, "http://x");
  const yaAhi =
    input.pathname === LOGIN_PATH &&
    [...url.searchParams].every(([clave, valor]) => input.searchParams.get(clave) === valor);
  return { accion: "cerrar", a: yaAhi ? null : destino };
}

export function decidirAcceso(input: GuardiaInput): GuardiaDecision {
  const clase = clasificarRuta(input.pathname);
  const navegacion = esNavegacion(input.method);
  const { sesion } = input;

  // 1. No session.
  if (sesion === null) {
    if (clase === "publica" || !navegacion) return { accion: "seguir", contarActividad: false };
    return { accion: "redirigir", a: loginCon(input.pathname, input.search, clase) };
  }

  // 2. Account inactive or not verifiable.
  const motivo = motivoSalida(sesion.cuenta);
  if (motivo) return cerrarHacia(input, loginConMotivo(motivo));

  // 5 (for requests that are not navigations): an expired session is cleared
  // before the action runs; nothing else is decided here for them.
  if (!navegacion) {
    return sesion.actividadVigente ? { accion: "seguir", contarActividad: true } : { accion: "cerrar", a: null };
  }

  if (clase !== "publica") {
    // 3. Forced password change.
    if (sesion.cuenta?.debeCambiarPassword && input.pathname !== CAMBIAR_PASSWORD_PATH) {
      return { accion: "redirigir", a: CAMBIAR_PASSWORD_PATH };
    }
    // 4. Role, and default deny.
    if (clase === null || (clase === "admin" && sesion.rol !== "admin")) {
      return { accion: "redirigir", a: HOME_PATH };
    }
  }

  // 5. Inactivity.
  if (!sesion.actividadVigente) return cerrarHacia(input, LOGIN_INACTIVIDAD);

  return { accion: "seguir", contarActividad: true };
}
