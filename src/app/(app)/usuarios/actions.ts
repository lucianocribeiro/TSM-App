"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import {
  crearUsuario,
  desactivarCuenta,
  purgarCuenta,
  reactivarCuenta,
  resetPasswordTemporal,
} from "@/lib/admin/cuentas";
import { sessionWithRole } from "@/lib/auth/require-role";
import {
  crearUsuarioInput,
  desactivarInput,
  purgarInput,
  reactivarInput,
  restablecerInput,
} from "@/lib/cuentas/acciones-input";
import { copy } from "@/lib/copy/es-AR";

// Server Actions of the Usuarios screen (PRD US-5, US-8, US-9). Each one
// checks that the caller is an active Admin before anything else, then calls
// the Admin account module, which checks again and answers with es-AR
// messages (cuentaErrorMessage). No password is returned or logged.

const USUARIOS_PATH = "/usuarios";
const errors = copy.cuentas.errors;

async function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  operation: (data: z.infer<S>) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  if (!(await sessionWithRole("admin"))) return { ok: false, error: errors.noAutorizado };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: errors.accionFallo };
  const result = await operation(parsed.data);
  if (result.ok) revalidatePath(USUARIOS_PATH, "layout");
  return result;
}

// The temporary password is not returned: the form that sent it shows it once.
export async function crearUsuarioAction(input: unknown): Promise<ActionResult<{ profileId: string }>> {
  return run(crearUsuarioInput, input, crearUsuario);
}

export async function restablecerPasswordAction(input: unknown): Promise<ActionResult> {
  return run(restablecerInput, input, resetPasswordTemporal);
}

export async function desactivarCuentaAction(input: unknown): Promise<ActionResult> {
  return run(desactivarInput, input, desactivarCuenta);
}

export async function reactivarCuentaAction(input: unknown): Promise<ActionResult> {
  return run(reactivarInput, input, reactivarCuenta);
}

export async function purgarCuentaAction(input: unknown): Promise<ActionResult> {
  const result = await run(purgarInput, input, purgarCuenta);
  // Counts stay on the server; the screen only needs the outcome.
  return result.ok ? { ok: true } : result;
}
