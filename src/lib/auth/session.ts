import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type AppRole = Database["public"]["Enums"]["app_role"];

export type SessionUser = {
  id: string;
  email: string;
  role: AppRole;
};

// Returns the signed-in user verified by the Auth server (getUser), plus the
// role from profiles (readable through RLS as the own row). Null without a
// valid session. Cached per request.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: user.email ?? "",
    // Least privilege for presentation if the profile cannot be read.
    role: profile?.role ?? "empleado",
  };
});
