import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { barrerHuerfanosRecibos, type BarridoRecibosResultado } from "./limpieza";
import { parseReciboPath } from "./paths";
import { crearUrlSubidaRecibo, type UrlSubida } from "./signed-url";
import { MAX_RECIBO_BYTES, RECIBOS_BUCKET } from "./tipos";

// The receipts' privileged storage access (F2-04, Constitution §11). Neither
// receipts bucket has a write policy, so uploads, reads of the stored bytes,
// removals and the orphan sweep need the service-role client. This is the
// only module of src/lib/recibos and of the receipts Server Actions allowed
// to obtain it (ESLint no-restricted-imports), and it exposes only these
// operations, never the client itself.
//
// Authorization is the caller's job, before calling anything here: an
// active Admin (the central action guard), and the path checked against the
// employee and period it is for. F2-05 reuses it for the employee's own
// signature and signed PDF, after its own checks.

export type BytesRecibo = { ok: true; bytes: Uint8Array; mimeType: string } | { ok: false; motivo: "muy-grande" | "lectura" };

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
