import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionResult } from "@/lib/action-result";
import { copyRecibos } from "@/lib/copy/recibos";
import type { Database } from "@/lib/supabase/database.types";
import type { Confirmaciones, DetalleNoVerificable, MotivoDni, ResultadoRegistro } from "./carga-flujo";
import { barrerHuerfanos, crearUrlSubidaReciboPrivilegiada, descargarRecibo, eliminarRecibo } from "./cliente-privilegiado";
import { buildReciboPath, parseReciboPath } from "./paths";
import { verificarDniEnPdf, type ResultadoDni } from "./pdf-texto";
import { crearUrlFirmadaRecibo } from "./signed-url";
import { RECIBOS_BUCKET } from "./tipos";
import { validarReciboArchivo, validarReciboDeclarado, type MotivoArchivoInvalido } from "./validation";

// Carga de recibos, server side (F2-04, RF-05 to RF-12). Called by the
// /recibos Server Actions only after the central guard confirmed an active
// Admin and the input passed its strict schema. Reads go through the Admin's
// session (RLS: an Admin reads every receipt row); stored bytes, uploads and
// removals through the privileged client module. Logs carry no ids, paths
// or file content.

type Client = SupabaseClient<Database>;
const e = copyRecibos.errors;
const LOG = "[recibos]";

const fallo = (error: string): { ok: false; error: string } => ({ ok: false, error });

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------
type ErrorFuncion = { code?: string | null; hint?: string | null; details?: string | null } | null;

// The typed refusals of the recibos_carga functions (their HINT), as es-AR
// copy. `porDefecto`: the action's generic error.
export function mensajeDeFuncion(error: ErrorFuncion, porDefecto: string): string {
  switch (error?.hint) {
    case "periodo_invalido":
      return e.periodoInvalido;
    case "periodo_existente":
      return e.periodoExistente;
    case "periodo_inexistente":
      return e.periodoInexistente;
    case "transicion_invalida":
      return e.transicionInvalida;
    case "periodo_cerrado":
      return e.periodoCerrado;
    case "empleado_no_elegible":
      return e.empleadoNoElegible;
    case "conflicto_concurrente":
      return e.conflicto;
    default:
      return porDefecto;
  }
}

export function mensajeDeArchivo(motivo: MotivoArchivoInvalido): string {
  switch (motivo) {
    case "vacio":
      return e.vacio;
    case "muy-grande":
      return e.muyGrande;
    case "tipo":
      return e.tipo;
    case "contenido":
      return e.contenido;
  }
}

// The DNI check result as the override reason the Admin must confirm, or
// null when the DNI was found.
export function motivoDeDni(resultado: ResultadoDni): { motivo: MotivoDni; detalle?: DetalleNoVerificable } | null {
  switch (resultado.estado) {
    case "encontrado":
      return null;
    case "no_encontrado":
      return { motivo: "dni_no_encontrado" };
    case "sin_dni":
      return { motivo: "sin_dni" };
    case "no_verificable":
      return { motivo: "no_verificable", detalle: resultado.motivo };
  }
}

// ---------------------------------------------------------------------------
// Reads (Admin session)
// ---------------------------------------------------------------------------
type EstadoPeriodo = "abierto" | "cerrado" | "inexistente";

async function estadoPeriodo(client: Client, periodoId: string): Promise<EstadoPeriodo | null> {
  const { data, error } = await client.from("recibo_periodos").select("estado").eq("id", periodoId).maybeSingle();
  if (error) return null;
  if (!data) return "inexistente";
  return data.estado === "cerrado" ? "cerrado" : "abierto";
}

// Decision 1: only active Empleado accounts receive receipts.
async function empleadoElegible(client: Client, empleadoId: string): Promise<boolean | null> {
  const { data, error } = await client.from("profiles").select("role, estado_cuenta").eq("id", empleadoId).maybeSingle();
  if (error) return null;
  return data?.role === "empleado" && data.estado_cuenta === "activa";
}

// Whether any receipt row (current, history or override) points at the
// object. Null when a read fails.
async function referenciado(client: Client, path: string): Promise<boolean | null> {
  const lecturas = await Promise.all([
    client.from("recibos").select("id").eq("archivo_path", path).limit(1),
    client.from("recibo_historial").select("id").eq("archivo_path", path).limit(1),
    client.from("recibo_overrides").select("id").eq("archivo_path", path).limit(1),
  ]);
  if (lecturas.some((lectura) => lectura.error)) return null;
  return lecturas.some((lectura) => (lectura.data ?? []).length > 0);
}

// The path, when it is a receipt path of exactly this employee and period.
function rutaDe(path: string, empleadoId: string, periodoId: string): string | null {
  const ruta = parseReciboPath(path);
  if (!ruta || ruta.empleadoId !== empleadoId.toLowerCase() || ruta.periodoId !== periodoId.toLowerCase()) return null;
  return path;
}

// Checks before an upload or a registration: the period accepts uploads and
// the employee can receive a receipt. Null when both hold.
async function destinoInvalido(client: Client, periodoId: string, empleadoId: string, porDefecto: string): Promise<string | null> {
  const [periodo, elegible] = await Promise.all([estadoPeriodo(client, periodoId), empleadoElegible(client, empleadoId)]);
  if (periodo === null || elegible === null) return porDefecto;
  if (periodo === "inexistente") return e.periodoInexistente;
  if (periodo === "cerrado") return e.periodoCerrado;
  if (!elegible) return e.empleadoNoElegible;
  return null;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
// The upload failed after the file reached storage: the object goes, and the
// error says so when it could not be removed (never a success after a failed
// cleanup; the sweep removes it later, as it is unreferenced).
async function fallarYLimpiar(path: string, mensaje: string, paso: string): Promise<{ ok: false; error: string }> {
  if (await eliminarRecibo(path)) return fallo(mensaje);
  console.error(`${LOG} cleanup failed after ${paso}; the orphan sweep will remove the object`);
  return fallo(e.limpiezaFallo);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
export type InputSubida = { periodoId: string; empleadoId: string; tamano: number; tipo: string };

export type SubidaPreparada = { bucket: string; path: string; token: string };

// 1. A fresh path and a signed upload URL for it (the browser uploads with
// its token). The declared type and size are checked first; the sweep runs
// before a new path (Fase 1 pattern).
export async function prepararSubida(client: Client, input: InputSubida): Promise<ActionResult<SubidaPreparada>> {
  const declarado = validarReciboDeclarado({ mimeType: input.tipo, sizeBytes: input.tamano });
  if (!declarado.ok) return fallo(mensajeDeArchivo(declarado.motivo));
  const invalido = await destinoInvalido(client, input.periodoId, input.empleadoId, e.subidaFallo);
  if (invalido) return fallo(invalido);

  const barrido = await barrerHuerfanos();
  if (!barrido.ok) console.error(`${LOG} orphan sweep incomplete (${barrido.eliminados} removed, ${barrido.fallidos.length} failed)`);

  const path = buildReciboPath({ empleadoId: input.empleadoId, periodoId: input.periodoId, fileId: randomUUID() });
  if (!path) return fallo(e.subidaFallo);
  const url = await crearUrlSubidaReciboPrivilegiada(path);
  if (!url.ok) return fallo(e.subidaFallo);
  return { ok: true, data: { bucket: RECIBOS_BUCKET, path, token: url.token } };
}

export type InputRegistro = { periodoId: string; empleadoId: string; path: string } & Confirmaciones;

// 2. The uploaded object becomes the employee's receipt, or the Admin is
// asked to confirm the DNI result and then the replacement (carga-flujo.ts).
// The DNI check runs again on the stored bytes at every call, and a
// confirmation must match the motivo computed now (decision 7).
export async function registrar(client: Client, input: InputRegistro): Promise<ActionResult<ResultadoRegistro>> {
  const path = rutaDe(input.path, input.empleadoId, input.periodoId);
  if (!path) return fallo(e.registroFallo);
  // Never act on an object a row already holds (an existing receipt's file).
  const enUso = await referenciado(client, path);
  if (enUso !== false) return fallo(e.registroFallo);

  const archivo = await descargarRecibo(path);
  if (!archivo.ok) {
    return fallarYLimpiar(path, archivo.motivo === "muy-grande" ? e.muyGrande : e.subidaFallo, "read");
  }
  const valido = validarReciboArchivo({ mimeType: archivo.mimeType, bytes: archivo.bytes });
  if (!valido.ok) return fallarYLimpiar(path, mensajeDeArchivo(valido.motivo), "validation");

  const legajo = await client.from("legajos").select("dni").eq("profile_id", input.empleadoId).maybeSingle();
  if (legajo.error) return fallarYLimpiar(path, e.registroFallo, "dni read");
  const dni = motivoDeDni(await verificarDniEnPdf(archivo.bytes, legajo.data?.dni ?? null));

  if (dni && !input.confirmarDni) {
    // The file stays until the Admin decides (Aceptar or Rechazar).
    return { ok: true, data: { estado: "confirmar_dni", motivo: dni.motivo, ...(dni.detalle ? { detalle: dni.detalle } : {}) } };
  }
  if ((input.confirmarDni ?? null) !== (dni?.motivo ?? null)) {
    return fallarYLimpiar(path, e.dniCambio, "dni confirmation mismatch");
  }

  const actual = await client
    .from("recibos")
    .select("estado")
    .eq("periodo_id", input.periodoId)
    .eq("empleado_id", input.empleadoId)
    .maybeSingle();
  if (actual.error) return fallarYLimpiar(path, e.registroFallo, "receipt read");
  if (actual.data && input.confirmarReemplazo !== true) {
    return { ok: true, data: { estado: "confirmar_reemplazo", firmado: actual.data.estado === "firmado" } };
  }

  const { data, error } = await client.rpc("recibo_registrar", {
    p_periodo_id: input.periodoId,
    p_empleado_id: input.empleadoId,
    p_archivo_path: path,
    p_archivo_bytes: archivo.bytes.byteLength,
    p_reemplazar: input.confirmarReemplazo === true,
    ...(dni ? { p_override_motivo: dni.motivo } : {}),
  });
  if (error?.hint === "requiere_reemplazo") {
    // A receipt appeared since the read above: ask, the file stays.
    return { ok: true, data: { estado: "confirmar_reemplazo", firmado: error.details === "firmado" } };
  }
  if (error || !data) return fallarYLimpiar(path, mensajeDeFuncion(error, e.registroFallo), "registration");
  return { ok: true, data: { estado: "registrado", reciboId: data } };
}

export type InputDescarte = { periodoId: string; empleadoId: string; path: string };

// 3. Rechazar or Cancelar: the uploaded object goes, unless a row holds it.
export async function descartar(client: Client, input: InputDescarte): Promise<ActionResult> {
  const path = rutaDe(input.path, input.empleadoId, input.periodoId);
  if (!path) return fallo(e.accionFallo);
  const enUso = await referenciado(client, path);
  if (enUso !== false) return fallo(e.accionFallo);
  if (await eliminarRecibo(path)) return { ok: true };
  console.error(`${LOG} discard failed; the orphan sweep will remove the object`);
  return fallo(e.descarteFallo);
}

// A 5-minute link to the current file, under the Admin's session (storage
// policies decide).
export async function urlRecibo(client: Client, reciboId: string): Promise<ActionResult<{ url: string }>> {
  const { data, error } = await client.from("recibos").select("archivo_path").eq("id", reciboId).maybeSingle();
  if (error || !data) return fallo(e.verFallo);
  const url = await crearUrlFirmadaRecibo(data.archivo_path);
  return url.ok ? { ok: true, data: { url: url.url } } : fallo(e.verFallo);
}
