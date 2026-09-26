import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type CuentaEstado = Database["public"]["Enums"]["cuenta_estado"];

export type SessionUser = {
  id: string;
  email: string;
  role: AppRole;
  estadoCuenta: CuentaEstado;
  debeCambiarPassword: boolean;
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, estado_cuenta, debe_cambiar_password")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: user.email ?? "",
    // If the profile cannot be read: no Admin menu (least privilege), and no
    // account gate, so a transient error does not sign the user out. RLS
    // still decides every row.
    role: profile?.role ?? "empleado",
    estadoCuenta: profile?.estado_cuenta ?? "activa",
    debeCambiarPassword: profile?.debe_cambiar_password ?? false,
  };
});
