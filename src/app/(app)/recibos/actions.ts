"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { sessionWithRole } from "@/lib/auth/require-role";
import { copy } from "@/lib/copy/es-AR";
import { copyRecibos } from "@/lib/copy/recibos";
import { descartar, mensajeDeFuncion, prepararSubida, registrar, urlRecibo, type SubidaPreparada } from "@/lib/recibos/carga";
import { MOTIVOS_DNI, type ResultadoRegistro } from "@/lib/recibos/carga-flujo";
import { createClient } from "@/lib/supabase/server";

// Server Actions of /recibos, Carga de recibos (PRD Fase 2 RF-01 to RF-12).
// Admin only: every action checks for an active Admin first (the central
// guard), then parses its input with a strict schema (no unknown key at any
// level), before any other I/O. Periods change only through the recibos_carga
// functions, which check the caller again inside the database. Errors are
// es-AR (src/lib/copy/recibos.ts, Admin only).

const e = copyRecibos.errors;
const noAutorizado: ActionResult<never> = { ok: false, error: copy.cuentas.errors.noAutorizado };
const RUTA = "/recibos";

const uuid = z.uuid();
const PERIODO = z.strictObject({ periodoId: uuid });
const NUEVO_PERIODO = z.strictObject({
  anio: z.number().int().min(2000).max(2100),
  mes: z.number().int().min(1).max(12),
});
const SUBIDA = z.strictObject({
  periodoId: uuid,
  empleadoId: uuid,
  tamano: z.number().int(),
  tipo: z.string().max(255),
});
const PATH = z.string().min(1).max(255);
const REGISTRO = z.strictObject({
  periodoId: uuid,
  empleadoId: uuid,
  path: PATH,
  confirmarDni: z.enum(MOTIVOS_DNI).optional(),
  confirmarReemplazo: z.boolean().optional(),
});
const DESCARTE = z.strictObject({ periodoId: uuid, empleadoId: uuid, path: PATH });
const RECIBO = z.strictObject({ reciboId: uuid });

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------
type Transicion = "recibo_periodo_publicar" | "recibo_periodo_cerrar" | "recibo_periodo_reabrir";

async function transicion(funcion: Transicion, input: unknown): Promise<ActionResult> {
  const admin = await sessionWithRole("admin");
  if (!admin) return noAutorizado;
  const parsed = PERIODO.safeParse(input);
  if (!parsed.success) return { ok: false, error: e.accionFallo };
  const supabase = await createClient();
  const { error } = await supabase.rpc(funcion, { p_periodo_id: parsed.data.periodoId });
  if (error) return { ok: false, error: mensajeDeFuncion(error, e.accionFallo) };
  revalidatePath(RUTA);
  return { ok: true };
}

export async function crearPeriodoRecibos(input: unknown): Promise<ActionResult<{ periodoId: string }>> {
  const admin = await sessionWithRole("admin");
  if (!admin) return noAutorizado;
  const parsed = NUEVO_PERIODO.safeParse(input);
  if (!parsed.success) return { ok: false, error: e.accionFallo };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recibo_periodo_crear", { p_anio: parsed.data.anio, p_mes: parsed.data.mes });
  if (error || !data) return { ok: false, error: mensajeDeFuncion(error, e.accionFallo) };
  revalidatePath(RUTA);
  return { ok: true, data: { periodoId: data } };
}

export async function publicarPeriodoRecibos(input: unknown): Promise<ActionResult> {
  return transicion("recibo_periodo_publicar", input);
}

export async function cerrarPeriodoRecibos(input: unknown): Promise<ActionResult> {
  return transicion("recibo_periodo_cerrar", input);
}

export async function reabrirPeriodoRecibos(input: unknown): Promise<ActionResult> {
  return transicion("recibo_periodo_reabrir", input);
}

// ---------------------------------------------------------------------------
// Uploads: prepare, register, discard (src/lib/recibos/carga.ts)
// ---------------------------------------------------------------------------
export async function prepararSubidaRecibo(input: unknown): Promise<ActionResult<SubidaPreparada>> {
  const admin = await sessionWithRole("admin");
  if (!admin) return noAutorizado;
  const parsed = SUBIDA.safeParse(input);
  if (!parsed.success) return { ok: false, error: e.subidaFallo };
  return prepararSubida(await createClient(), parsed.data);
}

export async function registrarRecibo(input: unknown): Promise<ActionResult<ResultadoRegistro>> {
  const admin = await sessionWithRole("admin");
  if (!admin) return noAutorizado;
  const parsed = REGISTRO.safeParse(input);
  if (!parsed.success) return { ok: false, error: e.registroFallo };
  const { confirmarReemplazo, ...resto } = parsed.data;
  const result = await registrar(await createClient(), {
    ...resto,
    ...(confirmarReemplazo === true ? { confirmarReemplazo: true as const } : {}),
  });
  if (result.ok && result.data?.estado === "registrado") revalidatePath(RUTA);
  return result;
}

export async function descartarSubidaRecibo(input: unknown): Promise<ActionResult> {
  const admin = await sessionWithRole("admin");
  if (!admin) return noAutorizado;
  const parsed = DESCARTE.safeParse(input);
  if (!parsed.success) return { ok: false, error: e.accionFallo };
  return descartar(await createClient(), parsed.data);
}

// The current file of a receipt, for "Ver".
export async function obtenerUrlReciboAdmin(input: unknown): Promise<ActionResult<{ url: string }>> {
  const admin = await sessionWithRole("admin");
  if (!admin) return noAutorizado;
  const parsed = RECIBO.safeParse(input);
  if (!parsed.success) return { ok: false, error: e.verFallo };
  return urlRecibo(await createClient(), parsed.data.reciboId);
}
