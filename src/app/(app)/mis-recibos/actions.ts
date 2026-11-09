"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { sessionWithRole } from "@/lib/auth/require-role";
import { copy } from "@/lib/copy/es-AR";
import { copyMisRecibos } from "@/lib/copy/mis-recibos";
import {
  descartarFirma,
  firmar,
  prepararFirma,
  registrarFirma as registrar,
  urlMiFirma,
  urlRecibo,
  type FirmaPreparada,
  type ResultadoFirma,
} from "@/lib/recibos/firma";
import { createClient } from "@/lib/supabase/server";

// Server Actions of /mis-recibos (PRD Fase 2 RF-13 to RF-18). Empleado only:
// every action checks for an active Empleado first (the central guard; an
// Admin is refused like any role mismatch), then parses its input with a
// strict schema, before any other I/O. Writes go through the firma_registrar
// and recibo_firmar functions, which check the caller again in the database.
// Errors are es-AR (src/lib/copy/mis-recibos.ts).

const e = copyMisRecibos.errors;
const noAutorizado: ActionResult<never> = { ok: false, error: copy.cuentas.errors.noAutorizado };

const FIRMA_PATH = z.string().min(1).max(255);
const SUBIDA = z.strictObject({ tamano: z.number().int(), tipo: z.string().max(255) });
const FIRMA = z.strictObject({ path: FIRMA_PATH });
const URL_RECIBO = z.strictObject({ reciboId: z.uuid(), modo: z.enum(["ver", "descargar"]) });
const MI_FIRMA = z.strictObject({ version: z.number().int().min(1).optional() });
const FIRMAR = z.strictObject({ reciboId: z.uuid() });

function revalidar() {
  revalidatePath("/mis-recibos");
  // The menu counter lives in the app layout.
  revalidatePath("/", "layout");
}

export async function prepararSubidaFirma(input: unknown): Promise<ActionResult<FirmaPreparada>> {
  const yo = await sessionWithRole("empleado");
  if (!yo) return noAutorizado;
  const parsed = SUBIDA.safeParse(input);
  if (!parsed.success) return { ok: false, error: e.firmaFallo };
  return prepararFirma(await createClient(), yo.id, parsed.data);
}

export async function registrarFirma(input: unknown): Promise<ActionResult<{ version: number }>> {
  const yo = await sessionWithRole("empleado");
  if (!yo) return noAutorizado;
  const parsed = FIRMA.safeParse(input);
  if (!parsed.success) return { ok: false, error: e.firmaFallo };
  const result = await registrar(await createClient(), yo.id, parsed.data);
  if (result.ok) revalidatePath("/mis-recibos");
  return result;
}

export async function descartarSubidaFirma(input: unknown): Promise<ActionResult> {
  const yo = await sessionWithRole("empleado");
  if (!yo) return noAutorizado;
  const parsed = FIRMA.safeParse(input);
  if (!parsed.success) return { ok: false, error: e.accionFallo };
  return descartarFirma(await createClient(), yo.id, parsed.data);
}

export async function obtenerUrlRecibo(input: unknown): Promise<ActionResult<{ url: string }>> {
  const yo = await sessionWithRole("empleado");
  if (!yo) return noAutorizado;
  const parsed = URL_RECIBO.safeParse(input);
  if (!parsed.success) return { ok: false, error: e.verFallo };
  return urlRecibo(await createClient(), parsed.data);
}

export async function obtenerUrlMiFirma(input: unknown): Promise<ActionResult<{ url: string; version: number } | null>> {
  const yo = await sessionWithRole("empleado");
  if (!yo) return noAutorizado;
  const parsed = MI_FIRMA.safeParse(input);
  if (!parsed.success) return { ok: false, error: e.accionFallo };
  return urlMiFirma(await createClient(), yo.id, parsed.data);
}

export async function firmarRecibo(input: unknown): Promise<ActionResult<ResultadoFirma>> {
  const yo = await sessionWithRole("empleado");
  if (!yo) return noAutorizado;
  const parsed = FIRMAR.safeParse(input);
  if (!parsed.success) return { ok: false, error: e.firmarFallo };
  const result = await firmar(await createClient(), yo.id, parsed.data);
  if (result.ok && result.data?.estado === "firmado") revalidar();
  return result;
}
