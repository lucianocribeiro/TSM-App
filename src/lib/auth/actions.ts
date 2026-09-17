"use server";

import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { parseLoginInput } from "@/lib/auth/login-input";
import { copy } from "@/lib/copy/es-AR";
import { createClient } from "@/lib/supabase/server";

// One generic message for every login failure (missing or malformed input,
// wrong credentials, unexpected errors): never reveal whether the email exists.
const LOGIN_FAILED: ActionResult = {
  ok: false,
  error: copy.auth.errors.invalidCredentials,
};

export async function login(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const input = parseLoginInput(formData);
  if (!input) {
    return LOGIN_FAILED;
  }

  let signedIn = false;
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword(input);
    signedIn = !error;
  } catch {
    // Nothing is logged: the error may carry request details.
    signedIn = false;
  }

  if (!signedIn) {
    return LOGIN_FAILED;
  }

  // Outside try/catch: redirect() throws a control-flow signal Next.js must receive.
  redirect("/mi-legajo");
}

export async function logout(): Promise<ActionResult> {
  let signedOut = false;
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();
    signedOut = !error;
  } catch {
    signedOut = false;
  }

  if (!signedOut) {
    return { ok: false, error: copy.auth.errors.logoutFailed };
  }

  redirect("/login");
}
