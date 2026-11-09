import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionResult } from "@/lib/action-result";
import { copyMisRecibos } from "@/lib/copy/mis-recibos";
import { copyRecibosServidor } from "@/lib/copy/recibos-servidor";
import { nombreCompleto } from "@/lib/cuentas/listado";
import type { Database } from "@/lib/supabase/database.types";
import {
  barrerHuerfanos,
  crearUrlSubidaFirmaPrivilegiada,
  descargarFirma,
  descargarRecibo,
  eliminarFirma,
  eliminarRecibo,
  subirRecibo,
} from "./cliente-privilegiado";
import { buildFirmaPath, buildReciboPath, parseFirmaPath } from "./paths";
import { EstampaError, estamparFirma } from "./pdf-firma";
import { crearUrlFirmadaFirma, crearUrlFirmadaRecibo } from "./signed-url";
import { FIRMAS_BUCKET } from "./tipos";
import { validarFirmaDeclarada, validarFirmaImagen, type MotivoArchivoInvalido } from "./validation";

// Mis Recibos, server side (F2-05, RF-13 to RF-18). Called by the
// /mis-recibos Server Actions only after the central guard confirmed an
// active Empleado (`yo`) and the input passed its strict schema. Reads go
// through the employee's session (RLS: own receipts in visible periods, own
// signatures); stored bytes, uploads and removals through the privileged
// client module, always on the caller's own paths. Logs carry no ids, paths,
// names or file content.

type Client = SupabaseClient<Database>;
const e = copyMisRecibos.errors;
const LOG = "[mis-recibos]";

const fallo = (error: string): { ok: false; error: string } => ({ ok: false, error });

// Signature image size limits, in pixels (the drawing canvas exports within them).
export const FIRMA_MIN_PX = { ancho: 100, alto: 40 } as const;
export const FIRMA_MAX_PX = { ancho: 2000, alto: 1000 } as const;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
// Width and height from the PNG header (IHDR, right after the signature), or
// null when the bytes are not a PNG header.
export function medidasPng(bytes: Uint8Array): { ancho: number; alto: number } | null {
  if (bytes.length < 24) return null;
  const tipo = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (tipo !== "IHDR") return null;
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { ancho: vista.getUint32(16), alto: vista.getUint32(20) };
}

export function medidasAceptables(medidas: { ancho: number; alto: number } | null): boolean {
  return (
    medidas !== null &&
    medidas.ancho >= FIRMA_MIN_PX.ancho &&
    medidas.alto >= FIRMA_MIN_PX.alto &&
    medidas.ancho <= FIRMA_MAX_PX.ancho &&
    medidas.alto <= FIRMA_MAX_PX.alto
  );
}

// Recibo-MM-AAAA.pdf
export function nombreDescarga(periodo: { anio: number; mes: number }): string {
  return `Recibo-${String(periodo.mes).padStart(2, "0")}-${periodo.anio}.pdf`;
}

function mensajeFirma(motivo: MotivoArchivoInvalido): string {
  switch (motivo) {
    case "vacio":
      return e.firmaVacia;
    case "muy-grande":
      return e.firmaMuyGrande;
    case "tipo":
      return e.firmaTipo;
    case "contenido":
      return e.firmaContenido;
  }
}

type ErrorFuncion = { hint?: string | null } | null;

// The recibo_firmar refusals (HINT) as es-AR copy.
export function mensajeDeFirmar(error: ErrorFuncion): string {
  switch (error?.hint) {
    case "recibo_ajeno":
    case "periodo_no_visible":
      return e.noEncontrado;
    case "recibo_ya_firmado":
      return e.yaFirmado;
    case "hora_invalida":
      return e.horaInvalida;
    default:
      return e.firmarFallo;
  }
}

// The name on the stamp (decision 12): the legajo's names and surname, else
// a fixed text; never an id or an email.
export function nombreParaEstampa(legajo: { nombres: string | null; apellido: string | null } | null): string {
  return nombreCompleto(legajo?.nombres ?? null, legajo?.apellido ?? null) ?? copyRecibosServidor.nombreSinLegajo;
}

// ---------------------------------------------------------------------------
// Signature: prepare, register, discard
// ---------------------------------------------------------------------------
export type FirmaPreparada = { bucket: string; path: string; token: string };

export async function prepararFirma(client: Client, yo: string, input: { tamano: number; tipo: string }): Promise<ActionResult<FirmaPreparada>> {
  const declarado = validarFirmaDeclarada({ mimeType: input.tipo, sizeBytes: input.tamano });
  if (!declarado.ok) return fallo(mensajeFirma(declarado.motivo));

  const barrido = await barrerHuerfanos();
  if (!barrido.ok) console.error(`${LOG} orphan sweep incomplete (${barrido.eliminados} removed, ${barrido.fallidos.length} failed)`);

  const versiones = await client.from("firmas_empleado").select("version").eq("empleado_id", yo).order("version", { ascending: false }).limit(1);
  if (versiones.error) return fallo(e.firmaFallo);
  const version = (versiones.data?.[0]?.version ?? 0) + 1;
  const path = buildFirmaPath({ empleadoId: yo, version, fileId: randomUUID() });
  if (!path) return fallo(e.firmaFallo);
  const url = await crearUrlSubidaFirmaPrivilegiada(path);
  if (!url.ok) return fallo(e.firmaFallo);
  return { ok: true, data: { bucket: FIRMAS_BUCKET, path, token: url.token } };
}

// The path, when it is a signature path in the caller's own folder.
function firmaPropia(path: string, yo: string): string | null {
  const ruta = parseFirmaPath(path);
  return ruta && ruta.empleadoId === yo.toLowerCase() ? path : null;
}

// Whether a registered signature holds the object. Null when the read fails.
async function firmaReferenciada(client: Client, path: string): Promise<boolean | null> {
  const { data, error } = await client.from("firmas_empleado").select("id").eq("imagen_path", path).limit(1);
  if (error) return null;
  return (data ?? []).length > 0;
}

async function fallarYLimpiarFirma(path: string, mensaje: string, paso: string): Promise<{ ok: false; error: string }> {
  if (await eliminarFirma(path)) return fallo(mensaje);
  console.error(`${LOG} signature cleanup failed after ${paso}; the orphan sweep will remove the object`);
  return fallo(e.firmaLimpiezaFallo);
}

export async function registrarFirma(client: Client, yo: string, input: { path: string }): Promise<ActionResult<{ version: number }>> {
  const path = firmaPropia(input.path, yo);
  if (!path) return fallo(e.firmaFallo);
  const enUso = await firmaReferenciada(client, path);
  if (enUso !== false) return fallo(e.firmaFallo);

  const archivo = await descargarFirma(path);
  if (!archivo.ok) return fallarYLimpiarFirma(path, archivo.motivo === "muy-grande" ? e.firmaMuyGrande : e.firmaFallo, "read");
  const valida = validarFirmaImagen({ mimeType: archivo.mimeType, bytes: archivo.bytes });
  if (!valida.ok) return fallarYLimpiarFirma(path, mensajeFirma(valida.motivo), "validation");
  if (!medidasAceptables(medidasPng(archivo.bytes))) return fallarYLimpiarFirma(path, e.firmaMedidas, "dimensions");

  const { data, error } = await client.rpc("firma_registrar", { p_imagen_path: path });
  if (error || data === null) return fallarYLimpiarFirma(path, e.firmaFallo, "registration");
  return { ok: true, data: { version: data } };
}

export async function descartarFirma(client: Client, yo: string, input: { path: string }): Promise<ActionResult> {
  const path = firmaPropia(input.path, yo);
  if (!path) return fallo(e.accionFallo);
  const enUso = await firmaReferenciada(client, path);
  if (enUso !== false) return fallo(e.accionFallo);
  if (await eliminarFirma(path)) return { ok: true };
  console.error(`${LOG} signature discard failed; the orphan sweep will remove the object`);
  return fallo(e.descarteFallo);
}

// ---------------------------------------------------------------------------
// Links (session client: RLS and storage policies decide)
// ---------------------------------------------------------------------------
type ReciboLeido = {
  id: string;
  periodo_id: string;
  archivo_path: string;
  estado: Database["public"]["Enums"]["recibo_estado"];
  recibo_periodos: { anio: number; mes: number } | null;
};

async function reciboPropio(client: Client, reciboId: string): Promise<ReciboLeido | null | "fallo"> {
  const { data, error } = await client
    .from("recibos")
    .select("id, periodo_id, archivo_path, estado, recibo_periodos(anio, mes)")
    .eq("id", reciboId)
    .maybeSingle();
  if (error) return "fallo";
  return (data as ReciboLeido | null) ?? null;
}

export async function urlRecibo(
  client: Client,
  input: { reciboId: string; modo: "ver" | "descargar" },
): Promise<ActionResult<{ url: string }>> {
  const recibo = await reciboPropio(client, input.reciboId);
  if (recibo === "fallo") return fallo(e.verFallo);
  if (!recibo || !recibo.recibo_periodos) return fallo(e.noEncontrado);
  if (input.modo === "descargar" && recibo.estado !== "firmado") return fallo(e.descargaNoDisponible);
  const url = await crearUrlFirmadaRecibo(
    recibo.archivo_path,
    input.modo === "descargar" ? { download: nombreDescarga(recibo.recibo_periodos) } : {},
  );
  return url.ok ? { ok: true, data: { url: url.url } } : fallo(e.verFallo);
}

export async function urlMiFirma(client: Client, yo: string, input: { version?: number }): Promise<ActionResult<{ url: string; version: number } | null>> {
  let consulta = client.from("firmas_empleado").select("version, imagen_path").eq("empleado_id", yo);
  consulta = input.version === undefined ? consulta.eq("activa", true) : consulta.eq("version", input.version);
  const { data, error } = await consulta.maybeSingle();
  if (error) return fallo(e.accionFallo);
  // No signature yet (or no such version): nothing to show.
  if (!data) return { ok: true, data: null };
  const url = await crearUrlFirmadaFirma(data.imagen_path);
  return url.ok ? { ok: true, data: { url: url.url, version: data.version } } : fallo(e.accionFallo);
}

// ---------------------------------------------------------------------------
// Sign
// ---------------------------------------------------------------------------
export type ResultadoFirma = { estado: "firmado"; firmadoAt: string } | { estado: "sin_firma" };

// Stamps the current signature on the receipt (RF-17) and replaces the
// unsigned file with the signed one (Constitution §11): the signed PDF is
// stored at a new path first, the database switches the receipt to it and
// writes the evidence, and only then is the unsigned file removed. The
// signing time is taken once here and is what both the PDF and the database
// get (decision 10).
export async function firmar(
  client: Client,
  yo: string,
  input: { reciboId: string },
  ahora: () => Date = () => new Date(),
): Promise<ActionResult<ResultadoFirma>> {
  const recibo = await reciboPropio(client, input.reciboId);
  if (recibo === "fallo") return fallo(e.firmarFallo);
  if (!recibo) return fallo(e.noEncontrado);
  if (recibo.estado !== "pendiente") return fallo(e.yaFirmado);

  const firma = await client.from("firmas_empleado").select("imagen_path").eq("empleado_id", yo).eq("activa", true).maybeSingle();
  if (firma.error) return fallo(e.firmarFallo);
  if (!firma.data) return { ok: true, data: { estado: "sin_firma" } };

  const legajo = await client.from("legajos").select("nombres, apellido").eq("profile_id", yo).maybeSingle();
  if (legajo.error) return fallo(e.firmarFallo);
  const nombre = nombreParaEstampa(legajo.data);

  const firmadoEn = ahora();
  const [pdf, png] = await Promise.all([descargarRecibo(recibo.archivo_path), descargarFirma(firma.data.imagen_path)]);
  if (!pdf.ok || !png.ok) return fallo(e.firmarFallo);

  let firmado: Uint8Array;
  try {
    firmado = await estamparFirma(pdf.bytes, png.bytes, { nombre, firmadoEn });
  } catch (error) {
    console.error(`${LOG} stamp refused${error instanceof EstampaError ? ` (${error.motivo})` : ""}`);
    return fallo(e.firmarFallo);
  }

  const nuevo = buildReciboPath({ empleadoId: yo, periodoId: recibo.periodo_id, fileId: randomUUID() });
  if (!nuevo || !(await subirRecibo(nuevo, firmado))) return fallo(e.firmarFallo);

  const { data, error } = await client.rpc("recibo_firmar", {
    p_recibo_id: recibo.id,
    p_archivo_path: nuevo,
    p_archivo_bytes: firmado.byteLength,
    p_firmado_at: firmadoEn.toISOString(),
  });
  if (error) {
    // Nothing changed in the database: the signed file must go.
    if (!(await eliminarRecibo(nuevo))) {
      console.error(`${LOG} cleanup of the signed file failed after a refused signing; the orphan sweep will remove it`);
      return fallo(e.limpiezaFallo);
    }
    if (error.hint === "sin_firma") return { ok: true, data: { estado: "sin_firma" } };
    return fallo(mensajeDeFirmar(error));
  }

  // Committed: the unsigned file is unreferenced now (null: a history row or
  // an override still holds it, so it stays). A failed removal does not undo
  // the signing; the employee cannot read that file, and the sweep removes it.
  if (typeof data === "string" && data !== "" && !(await eliminarRecibo(data))) {
    console.error(`${LOG} removal of the unsigned file failed after signing; the orphan sweep will remove it`);
  }
  return { ok: true, data: { estado: "firmado", firmadoAt: firmadoEn.toISOString() } };
}
