"use server";

import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { sessionWithRole } from "@/lib/auth/require-role";
import { copy } from "@/lib/copy/es-AR";
import { copyRecibos } from "@/lib/copy/recibos";
import { urlArchivoAdmin, urlFirmaAdmin } from "@/lib/recibos/estado";
import { createClient } from "@/lib/supabase/server";

// Server Actions of /recibos/estado, Estado de firmas (PRD Fase 2 RF-19 to
// RF-21, F2-06). Admin only: each checks for an active Admin first (the
// central guard), then parses its input with a strict schema, before any
// other I/O. Both only read, with the Admin's session client, and answer a
// 5-minute signed URL (never the file). Errors are es-AR, Admin only
// (src/lib/copy/recibos.ts).

const e = copyRecibos.estado.errors;
const noAutorizado: ActionResult<never> = { ok: false, error: copy.cuentas.errors.noAutorizado };

const ARCHIVO = z.strictObject({
  origen: z.enum(["actual", "historial"]),
  id: z.uuid(),
  modo: z.enum(["ver", "descargar"]),
});
const FIRMA = z.strictObject({ firmaId: z.uuid() });

// A receipt's current file (origen "actual", the receipt id) or a replaced
// one (origen "historial", the history row id). "descargar" serves it as
// Recibo-{Apellido}-{MM}-{AAAA}.pdf (-reemplazado-{n} for a replaced file).
export async function obtenerUrlArchivoReciboAdmin(input: unknown): Promise<ActionResult<{ url: string }>> {
  const admin = await sessionWithRole("admin");
  if (!admin) return noAutorizado;
  const parsed = ARCHIVO.safeParse(input);
  if (!parsed.success) return { ok: false, error: e.verFallo };
  return urlArchivoAdmin(await createClient(), parsed.data);
}

// A registered signature image (any version), shown in the receipt detail.
export async function obtenerUrlFirmaAdmin(input: unknown): Promise<ActionResult<{ url: string }>> {
  const admin = await sessionWithRole("admin");
  if (!admin) return noAutorizado;
  const parsed = FIRMA.safeParse(input);
  if (!parsed.success) return { ok: false, error: e.firmaFallo };
  return urlFirmaAdmin(await createClient(), parsed.data.firmaId);
}
