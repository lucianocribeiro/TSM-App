"use server";

import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { copy } from "@/lib/copy/es-AR";
import { createClient } from "@/lib/supabase/server";

export async function login(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.trim() === "" ||
    password === ""
  ) {
    return { ok: false, error: copy.auth.errors.requiredFields };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  // One generic message for every failure: never reveal whether the email exists.
  if (error) {
    return { ok: false, error: copy.auth.errors.invalidCredentials };
  }

  redirect("/mi-legajo");
}

export async function logout(): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    return { ok: false, error: copy.auth.errors.logoutFailed };
  }
  redirect("/login");
}
