import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { barrerHuerfanosRecibos, type BarridoRecibosResultado } from "./limpieza";
import { parseFirmaPath, parseReciboPath } from "./paths";
import { crearUrlSubidaFirma, crearUrlSubidaRecibo, type UrlSubida } from "./signed-url";
import { FIRMAS_BUCKET, MAX_FIRMA_BYTES, MAX_RECIBO_BYTES, RECIBO_MIME_TYPE, RECIBOS_BUCKET } from "./tipos";

// The receipts' privileged storage access (F2-04, Constitution §11). Neither
// receipts bucket has a write policy, so uploads, reads of the stored bytes,
// removals and the orphan sweep need the service-role client. This is the
// only module of src/lib/recibos and of the receipts Server Actions allowed
// to obtain it (ESLint no-restricted-imports), and it exposes only these
// operations, never the client itself.
//
// Authorization is the caller's job, before calling anything here: an
// active Admin (the central action guard), and the path checked against the
// employee and period it is for. F2-05 (Mis Recibos): an active Empleado,
// and the path checked to be their own (signature images and their signed
// receipts).

export type BytesRecibo = { ok: true; bytes: Uint8Array; mimeType: string } | { ok: false; motivo: "muy-grande" | "lectura" };
export type BytesFirma = BytesRecibo;

function privilegiado() {
  return createAdminClient();
}

// A signed upload URL for a receipt path (upsert off: an existing object is
// never overwritten).
export async function crearUrlSubidaReciboPrivilegiada(path: string): Promise<UrlSubida> {
  if (!parseReciboPath(path)) return { ok: false };
  return crearUrlSubidaRecibo(privilegiado(), path);
}

// The stored bytes of a receipt object. A file over the receipt limit is not
// read into memory.
export async function descargarRecibo(path: string): Promise<BytesRecibo> {
  if (!parseReciboPath(path)) return { ok: false, motivo: "lectura" };
  try {
    const { data, error } = await privilegiado().storage.from(RECIBOS_BUCKET).download(path);
    if (error || !data) return { ok: false, motivo: "lectura" };
    if (data.size > MAX_RECIBO_BYTES) return { ok: false, motivo: "muy-grande" };
    return { ok: true, bytes: new Uint8Array(await data.arrayBuffer()), mimeType: data.type };
  } catch {
    return { ok: false, motivo: "lectura" };
  }
}

// Removes a receipt object. True only when Storage removed it (an answer
// with no objects is a removal it did not do).
export async function eliminarRecibo(path: string): Promise<boolean> {
  if (!parseReciboPath(path)) return false;
  try {
    const { data, error } = await privilegiado().storage.from(RECIBOS_BUCKET).remove([path]);
    return !error && (data ?? []).length > 0;
  } catch {
    return false;
  }
}

// The lazy orphan sweep of both receipts buckets (F2-03).
export async function barrerHuerfanos(): Promise<BarridoRecibosResultado> {
  try {
    return await barrerHuerfanosRecibos(privilegiado());
  } catch {
    return { ok: false, eliminados: 0, fallidos: [] };
  }
}

// ---------------------------------------------------------------------------
// F2-05: signatures and signed receipts
// ---------------------------------------------------------------------------
// A signed upload URL for a signature image path (upsert off).
export async function crearUrlSubidaFirmaPrivilegiada(path: string): Promise<UrlSubida> {
  if (!parseFirmaPath(path)) return { ok: false };
  return crearUrlSubidaFirma(privilegiado(), path);
}

// The stored bytes of a signature image. Its size is read first: an object
// over the signature limit is never downloaded.
export async function descargarFirma(path: string): Promise<BytesFirma> {
  if (!parseFirmaPath(path)) return { ok: false, motivo: "lectura" };
  try {
    const store = privilegiado().storage.from(FIRMAS_BUCKET);
    const info = await store.info(path);
    if (info.error || !info.data) return { ok: false, motivo: "lectura" };
    if ((info.data.size ?? Number.POSITIVE_INFINITY) > MAX_FIRMA_BYTES) return { ok: false, motivo: "muy-grande" };
    const { data, error } = await store.download(path);
    if (error || !data) return { ok: false, motivo: "lectura" };
    if (data.size > MAX_FIRMA_BYTES) return { ok: false, motivo: "muy-grande" };
    return { ok: true, bytes: new Uint8Array(await data.arrayBuffer()), mimeType: data.type };
  } catch {
    return { ok: false, motivo: "lectura" };
  }
}

// Stores a PDF the server made (the signed receipt) at a new receipt path.
// Never overwrites: an existing object makes it fail.
export async function subirRecibo(path: string, bytes: Uint8Array): Promise<boolean> {
  if (!parseReciboPath(path)) return false;
  try {
    const { error } = await privilegiado()
      .storage.from(RECIBOS_BUCKET)
      .upload(path, bytes, { contentType: RECIBO_MIME_TYPE, upsert: false });
    return !error;
  } catch {
    return false;
  }
}

// Removes a signature image. True only when Storage removed it.
export async function eliminarFirma(path: string): Promise<boolean> {
  if (!parseFirmaPath(path)) return false;
  try {
    const { data, error } = await privilegiado().storage.from(FIRMAS_BUCKET).remove([path]);
    return !error && (data ?? []).length > 0;
  } catch {
    return false;
  }
}
