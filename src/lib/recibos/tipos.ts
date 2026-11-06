import "server-only";
import { MAX_DOCUMENTO_BYTES } from "@/lib/documentos/tipos";

// Receipts and signatures storage (F2-03, PRD Fase 2 §6). The buckets and
// their limits are created by the recibos_storage migration; these mirror it.

export const RECIBOS_BUCKET = "recibos";
export const FIRMAS_BUCKET = "firmas";

// Receipts: PDF, at most 10 MB (the legajo documents limit, RF-07).
export const RECIBO_MIME_TYPE = "application/pdf";
export const MAX_RECIBO_BYTES = MAX_DOCUMENTO_BYTES;

// Registered signatures: PNG exported from the drawing canvas, at most 1 MB.
export const FIRMA_MIME_TYPE = "image/png";
export const MAX_FIRMA_BYTES = 1024 * 1024;
