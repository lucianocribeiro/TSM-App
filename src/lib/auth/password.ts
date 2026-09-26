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

export const cambioPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmacion: z.string({ error: messages.noCoinciden }),
  })
  .refine((value) => value.password === value.confirmacion, {
    error: messages.noCoinciden,
    path: ["confirmacion"],
  });

// Reads the change-password form. Returns the new password, or the first
// es-AR error message.
export function parseCambioPassword(formData: FormData): ActionResult<{ password: string }> {
  const parsed = cambioPasswordSchema.safeParse({
    password: formData.get("password") ?? undefined,
    confirmacion: formData.get("confirmacion") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? messages.guardarFallo };
  }
  return { ok: true, data: { password: parsed.data.password } };
}
