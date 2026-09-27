import "server-only";
import { cache } from "react";
import type { CuentaActual } from "@/lib/auth/gate";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type AppRole = Database["public"]["Enums"]["app_role"];

export type SessionUser = {
  id: string;
  email: string;
  role: AppRole;
  // Null when the own profile could not be read (error or no row). Never
  // replaced by defaults: the account gate treats null as "cannot verify" and
  // ends the session.
  cuenta: CuentaActual;
};

// Returns the signed-in user verified by the Auth server (getUser), plus the
// role and account state from profiles (readable through RLS as the own row).
// Null without a valid session. Cached per request.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, estado_cuenta, debe_cambiar_password")
    .eq("id", user.id)
    .maybeSingle();
  const read = !profileError && profile ? profile : null;

  return {
    id: user.id,
    email: user.email ?? "",
    // Least privilege when the profile cannot be read: no Admin menu. The
    // gate ends such a session before any page renders.
    role: read?.role ?? "empleado",
    cuenta: read
      ? { estadoCuenta: read.estado_cuenta, debeCambiarPassword: read.debe_cambiar_password }
      : null,
  };
});
