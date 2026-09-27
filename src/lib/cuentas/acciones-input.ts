import { z } from "zod";

// Shapes the Usuarios Server Actions accept. Only the shape is checked here;
// the rules (email format, password length, non-blank reason) are enforced by
// src/lib/admin/cuentas.ts, which answers with the es-AR message for each.

const profileId = z.uuid();

export const crearUsuarioInput = z.object({
  email: z.string(),
  rol: z.enum(["empleado", "admin"]),
  passwordTemporal: z.string(),
});

export const restablecerInput = z.object({ profileId, passwordTemporal: z.string() });
export const desactivarInput = z.object({ profileId, motivo: z.string() });
export const reactivarInput = z.object({ profileId });
export const purgarInput = z.object({ profileId, emailConfirmacion: z.string() });

export type CrearUsuarioInput = z.infer<typeof crearUsuarioInput>;
export type RestablecerInput = z.infer<typeof restablecerInput>;
export type DesactivarInput = z.infer<typeof desactivarInput>;
export type ReactivarInput = z.infer<typeof reactivarInput>;
export type PurgarInput = z.infer<typeof purgarInput>;
