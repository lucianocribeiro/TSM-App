import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { copy } from "@/lib/copy/es-AR";

// Password rules shared by temporary passwords (Admin) and new passwords
// (forced change): at least 8 characters, and at most 72 bytes, the limit of
// the Auth server's password hashing. Never trimmed: spaces are characters.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

const messages = copy.password.errors;

export const passwordSchema = z
  .string({ error: messages.demasiadoCorta })
  .min(PASSWORD_MIN_LENGTH, { error: messages.demasiadoCorta })
  .refine((value) => new TextEncoder().encode(value).length <= PASSWORD_MAX_BYTES, {
    error: messages.demasiadoLarga,
  });

const actualSchema = z
  .string({ error: messages.actualRequerida })
  .min(1, { error: messages.actualRequerida });

// The current password is asked only in a voluntary change. In the forced
// change the user has just signed in with their temporary password.
export function cambioPasswordSchema({ requiereActual }: { requiereActual: boolean }) {
  return z
    .object({
      actual: requiereActual ? actualSchema : z.unknown().transform(() => null),
      password: passwordSchema,
      confirmacion: z.string({ error: messages.noCoinciden }),
    })
    .refine((value) => value.password === value.confirmacion, {
      error: messages.noCoinciden,
      path: ["confirmacion"],
    });
}

export type CambioPassword = { actual: string | null; password: string };

// Reads the change-password form. Returns the passwords (actual is null when
// not required), or the first es-AR error message. Whether the current
// password is required comes from the server-side session, never the form.
export function parseCambioPassword(
  formData: FormData,
  options: { requiereActual: boolean },
): ActionResult<CambioPassword> {
  const parsed = cambioPasswordSchema(options).safeParse({
    actual: formData.get("actual") ?? undefined,
    password: formData.get("password") ?? undefined,
    confirmacion: formData.get("confirmacion") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? messages.guardarFallo };
  }
  return { ok: true, data: { actual: parsed.data.actual, password: parsed.data.password } };
}
