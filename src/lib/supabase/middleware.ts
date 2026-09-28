import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PATHNAME_HEADER } from "@/lib/auth/gate";
import { decidirAcceso, type SesionGuardia } from "@/lib/auth/guardia";
import { getPublicEnv, getServerEnv } from "@/lib/env";
import { claveMarca, firmarMarca, leerMarca, MARCA_COOKIE, opcionesMarca } from "@/lib/sesion/marca";
import type { Database } from "@/lib/supabase/database.types";

// Auth session cookie names of @supabase/ssr (including chunked cookies).
const SESSION_COOKIE_PREFIX = "sb-";

// Prefetches are made by the router in the background: they never count as
// user activity.
function esPrefetch(request: NextRequest): boolean {
  return (
    request.headers.has("next-router-prefetch") ||
    request.headers.get("purpose") === "prefetch" ||
    request.headers.get("sec-purpose")?.includes("prefetch") === true
  );
}

// The proxy for every matched request (src/proxy.ts): refreshes the Supabase
// session cookies (the @supabase/ssr pattern: getClaims right after creating
// the client, and every cookie it sets copied to the response), reads what
// the route guard needs, and applies its decision (src/lib/auth/guardia.ts).
// Per request: getClaims (JWT verification; a network call only when the
// session must be refreshed) and, with a session, one read of the own
// profile row (role, account state, forced password change). Nothing is
// cached across requests, so a deactivation takes effect on the next one.
export async function updateSession(request: NextRequest) {
  // Downstream requests carry the pathname for the app layout, and the
  // current cookies (refreshed below when needed).
  const next = () => {
    const headers = new Headers(request.headers);
    headers.set(PATHNAME_HEADER, request.nextUrl.pathname);
    return NextResponse.next({ request: { headers } });
  };

  let response = next();
  const { supabaseUrl, supabaseAnonKey } = getPublicEnv();

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = next();
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Do not run code between client creation and this call.
  // It validates the JWT and refreshes the session when needed.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const userId = claims?.sub;
  const sesionId = typeof claims?.session_id === "string" ? claims.session_id : null;

  let sesion: SesionGuardia | null = null;
  const ahora = Date.now();
  let clave: CryptoKey | null = null;
  let marcaARenovar = false;

  if (userId) {
    // Own row through RLS. A failed read or a missing row is passed on as
    // null: the gate fails closed and ends the session.
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role, estado_cuenta, debe_cambiar_password")
      .eq("id", userId)
      .maybeSingle();

    clave = await claveMarca(getServerEnv().supabaseServiceRoleKey);
    const marca = sesionId
      ? await leerMarca(clave, request.cookies.get(MARCA_COOKIE)?.value, sesionId, ahora)
      : ({ estado: "invalida" } as const);
    marcaARenovar = marca.estado === "vigente" && marca.renovar;

    const leido = !error && profile ? profile : null;
    sesion = {
      cuenta: leido ? { estadoCuenta: leido.estado_cuenta, debeCambiarPassword: leido.debe_cambiar_password } : null,
      rol: leido?.role ?? null,
      actividadVigente: marca.estado === "vigente",
    };
  }

  const decision = decidirAcceso({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    searchParams: request.nextUrl.searchParams,
    method: request.method,
    sesion,
  });

  switch (decision.accion) {
    case "seguir": {
      // Re-stamp the marker on a request the user made (not a prefetch).
      if (decision.contarActividad && marcaARenovar && clave && sesionId && !esPrefetch(request)) {
        const valor = await firmarMarca(clave, sesionId, ahora);
        response.cookies.set(MARCA_COOKIE, valor, opcionesMarca(request.nextUrl.protocol === "https:"));
      }
      return response;
    }

    case "redirigir": {
      const redirect = NextResponse.redirect(new URL(decision.a, request.url));
      response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
      return redirect;
    }

    case "cerrar": {
      // Ends this session on the Auth server too, when it still exists.
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // The cookies are cleared below either way.
      }
      const sessionCookies = request.cookies
        .getAll()
        .filter(({ name }) => name.startsWith(SESSION_COOKIE_PREFIX) || name === MARCA_COOKIE);
      sessionCookies.forEach(({ name }) => request.cookies.delete(name));

      const out = decision.a ? NextResponse.redirect(new URL(decision.a, request.url)) : next();
      sessionCookies.forEach(({ name }) => out.cookies.delete(name));
      return out;
    }
  }
}
