"use server";

import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { CAMBIAR_PASSWORD_PATH, HOME_PATH, LOGIN_PATH } from "@/lib/auth/gate";
import { LOGIN_INACTIVIDAD } from "@/lib/auth/guardia";
import { rutaRetornoSegura, VOLVER_PARAM } from "@/lib/auth/retorno";
import { getSessionUser } from "@/lib/auth/session";
import { borrarActividad, sellarActividad } from "@/lib/sesion/marca-servidor";
import { sesionIdDeToken } from "@/lib/sesion/marca";
import { parseLoginInput } from "@/lib/auth/login-input";
import { parseCambioPassword } from "@/lib/auth/password";
import { verifyCurrentPassword } from "@/lib/auth/verify-password";
import { copy } from "@/lib/copy/es-AR";
import { createClient } from "@/lib/supabase/server";

// One generic message for every login failure (missing or malformed input,
// wrong credentials, unexpected errors): never reveal whether the email exists.
const LOGIN_FAILED: ActionResult = {
  ok: false,
  error: copy.auth.errors.invalidCredentials,
};

// An inactive account has its own message (PRD US-8). The Auth server answers
// "user_banned" for a banned account before it checks the password.
const CUENTA_INACTIVA: ActionResult = {
  ok: false,
  error: copy.auth.errors.cuentaInactiva,
};

export async function login(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const input = parseLoginInput(formData);
  if (!input) {
    return LOGIN_FAILED;
  }

  let outcome: ActionResult | { ok: true; destination: string } = LOGIN_FAILED;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword(input);
    if (error) {
      outcome = error.code === "user_banned" ? CUENTA_INACTIVA : LOGIN_FAILED;
    } else {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("estado_cuenta, debe_cambiar_password")
        .eq("id", data.user.id)
        .maybeSingle();

      if (profileError || !profile) {
        await supabase.auth.signOut();
        outcome = LOGIN_FAILED;
      } else if (profile.estado_cuenta === "inactiva") {
        await supabase.auth.signOut();
        outcome = CUENTA_INACTIVA;
      } else {
        // The activity marker starts with the session (server-side
        // inactivity limit, src/lib/sesion/marca.ts).
        const sesionId = sesionIdDeToken(data.session.access_token);
        if (!sesionId) {
          await supabase.auth.signOut();
          outcome = LOGIN_FAILED;
        } else {
          await sellarActividad(sesionId);
          // Back to the page that asked for the sign-in, when it is a safe,
          // known route; a pending password change comes first.
          const volver = rutaRetornoSegura(formData.get(VOLVER_PARAM));
          outcome = {
            ok: true,
            destination: profile.debe_cambiar_password ? CAMBIAR_PASSWORD_PATH : (volver ?? HOME_PATH),
          };
        }
      }
    }
  } catch {
    // Nothing is logged: the error may carry request details.
    outcome = LOGIN_FAILED;
  }

  if (!("destination" in outcome)) {
    return outcome;
  }

  // Outside try/catch: redirect() throws a control-flow signal Next.js must receive.
  redirect(outcome.destination);
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

  await borrarActividad();
  redirect(LOGIN_PATH);
}

// The explicit "Seguir conectado" and the throttled report of real input
// (src/app/(app)/SesionInactividad.tsx). The proxy has already checked the
// activity marker and re-stamped it for this request; an expired session
// arrives here without a session and gets ok: false.
export async function mantenerSesion(): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user || user.cuenta?.estadoCuenta !== "activa") {
    return { ok: false, error: copy.auth.errors.sesionInactividad };
  }
  return { ok: true };
}

// The client's inactivity limit was reached: end the session and show why.
export async function cerrarSesionPorInactividad(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // The marker goes below either way, and the proxy refuses the session.
  }
  await borrarActividad();
  redirect(LOGIN_INACTIVIDAD);
}

// Password change: forced (PRD US-9, temporary password) or voluntary.
// A voluntary change also needs the current password, checked without
// touching this session (verifyCurrentPassword). Whether the change is forced
// comes from the profile, never from the form. The Auth server keeps this
// session and ends the user's other sessions; confirmar_cambio_password clears
// the flag and records the event.
export async function cambiarPassword(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const messages = copy.password.errors;
  const generic: ActionResult = { ok: false, error: messages.guardarFallo };

  let result: ActionResult = generic;
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user?.email) return generic;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("debe_cambiar_password")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError || !profile) return generic;
    const requiereActual = !profile.debe_cambiar_password;

    const parsed = parseCambioPassword(formData, { requiereActual });
    if (!parsed.ok) return parsed;
    const { actual, password } = parsed.data ?? { actual: null, password: "" };

    if (requiereActual && !(await verifyCurrentPassword(user.email, actual ?? ""))) {
      return { ok: false, error: messages.actualIncorrecta };
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      result = {
        ok: false,
        error:
          error.code === "same_password"
            ? messages.igualActual
            : error.code === "weak_password"
              ? messages.demasiadoCorta
              : messages.guardarFallo,
      };
    } else {
      const { error: confirmError } = await supabase.rpc("confirmar_cambio_password");
      result = confirmError ? generic : { ok: true };
      // Keep the activity marker bound to the session the change leaves.
      const { data: sesion } = await supabase.auth.getSession();
      const sesionId = sesion.session ? sesionIdDeToken(sesion.session.access_token) : null;
      if (sesionId) await sellarActividad(sesionId);
    }
  } catch {
    // Nothing is logged: the error may carry the request body.
    result = generic;
  }

  if (!result.ok) return result;

  redirect(HOME_PATH);
}
