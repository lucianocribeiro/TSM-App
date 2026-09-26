import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decideAccountGate, PATHNAME_HEADER } from "@/lib/auth/gate";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

// Auth session cookie names of @supabase/ssr (including chunked cookies).
const SESSION_COOKIE_PREFIX = "sb-";

// Refreshes the Supabase auth session cookies on every matched request, then
// applies the account gate (src/lib/auth/gate.ts). The gate runs here because
// the proxy sees every request, including client-side navigations that do not
// re-render the shared app layout. Role-based route guards arrive in F1-10.
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
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = next();
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) =>
          response.headers.set(key, value),
        );
      },
    },
  });

  // Do not run code between client creation and this call.
  // It validates the JWT and refreshes the session when needed.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return response;

  // Own row through RLS. On a read error the gate is skipped rather than
  // signing the user out: the app layout and RLS still apply.
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("estado_cuenta, debe_cambiar_password")
    .eq("id", userId)
    .maybeSingle();
  if (error || !profile) return response;

  const decision = decideAccountGate({
    pathname: request.nextUrl.pathname,
    searchParams: request.nextUrl.searchParams,
    method: request.method,
    estadoCuenta: profile.estado_cuenta,
    debeCambiarPassword: profile.debe_cambiar_password,
  });

  switch (decision.action) {
    case "continue":
      return response;

    case "redirect": {
      const redirect = NextResponse.redirect(new URL(decision.to, request.url));
      response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
      return redirect;
    }

    case "signOut": {
      // Ends this session on the Auth server too, when it still exists.
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // The cookies are cleared below either way.
      }
      const sessionCookies = request.cookies
        .getAll()
        .filter(({ name }) => name.startsWith(SESSION_COOKIE_PREFIX));
      sessionCookies.forEach(({ name }) => request.cookies.delete(name));

      const out = decision.to
        ? NextResponse.redirect(new URL(decision.to, request.url))
        : next();
      sessionCookies.forEach(({ name }) => out.cookies.delete(name));
      return out;
    }
  }
}
