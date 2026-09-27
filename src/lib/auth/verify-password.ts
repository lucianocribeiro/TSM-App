import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";

// Checks a user's current password without touching their session.
//
// The Auth server only checks a current password on update when the project
// setting update_password_require_current_password is on, and that would also
// demand it in the forced first-login change. So the check is a sign-in on a
// separate, throwaway client: anon key, no cookies, nothing persisted. The
// user's cookie session is never read or written, and the Auth server's
// sign-in rate limits apply. On success the throwaway session is ended at
// once (scope local: only that session).
export async function verifyCurrentPassword(email: string, password: string): Promise<boolean> {
  if (!email || !password) return false;
  try {
    const { supabaseUrl, supabaseAnonKey } = getPublicEnv();
    const probe = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const { data, error } = await probe.auth.signInWithPassword({ email, password });
    if (error || !data.session) return false;
    await probe.auth.signOut({ scope: "local" });
    return true;
  } catch {
    // Nothing is logged: the error may carry the request body.
    return false;
  }
}
