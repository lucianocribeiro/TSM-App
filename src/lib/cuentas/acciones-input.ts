import { z } from "zod";

// Shapes the Usuarios Server Actions accept, with no other key
// (AUD-SEC-01-01). Only the shape is checked here;
// the rules (email format, password length, non-blank reason) are enforced by
// src/lib/admin/cuentas.ts, which answers with the es-AR message for each.

const profileId = z.uuid();

export const crearUsuarioInput = z.strictObject({
  email: z.string(),
  rol: z.enum(["empleado", "admin"]),
  passwordTemporal: z.string(),
});

export const restablecerInput = z.strictObject({ profileId, passwordTemporal: z.string() });
export const desactivarInput = z.strictObject({ profileId, motivo: z.string() });
export const reactivarInput = z.strictObject({ profileId });
export const purgarInput = z.strictObject({ profileId, emailConfirmacion: z.string() });

export type CrearUsuarioInput = z.infer<typeof crearUsuarioInput>;
export type RestablecerInput = z.infer<typeof restablecerInput>;
export type DesactivarInput = z.infer<typeof desactivarInput>;
export type ReactivarInput = z.infer<typeof reactivarInput>;
export type PurgarInput = z.infer<typeof purgarInput>;
