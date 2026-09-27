import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { HOME_PATH, LOGIN_PATH, loginConMotivo, motivoSalida } from "@/lib/auth/gate";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

// Auth session cookie names of @supabase/ssr (including chunked cookies).
const SESSION_COOKIE_PREFIX = "sb-";

// Ends a session the account gate rejects, for the app layout (a layout
// cannot clear cookies). The reason is decided here, from the account state,
// never from the request, and a healthy session is left alone: a link to this
// route cannot sign out a user whose account is fine.
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.redirect(new URL(LOGIN_PATH, request.url));
  }

  const motivo = motivoSalida(user.cuenta);
  if (!motivo) {
    return NextResponse.redirect(new URL(HOME_PATH, request.url));
  }

  try {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // The cookies are cleared below either way.
  }
  const store = await cookies();
  store
    .getAll()
    .filter(({ name }) => name.startsWith(SESSION_COOKIE_PREFIX))
    .forEach(({ name }) => store.delete(name));

  return NextResponse.redirect(new URL(loginConMotivo(motivo), request.url));
}
