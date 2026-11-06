import "server-only";
import { FIRMA_MIME_TYPE, MAX_FIRMA_BYTES, MAX_RECIBO_BYTES, RECIBO_MIME_TYPE } from "./tipos";

// File rules for receipts (PDF, at most 10 MB) and signatures (PNG, at most
// 1 MB). The buckets enforce type and size too; this also checks the file's
// first bytes, so a file is judged by its content and not only by the type
// it declares. Returns a reason code; the calling Server Action (F2-04,
// F2-05) maps it to its es-AR message.

export type MotivoArchivoInvalido = "vacio" | "muy-grande" | "tipo" | "contenido";
export type ArchivoValidado = { ok: true } | { ok: false; motivo: MotivoArchivoInvalido };

type Regla = { mimeType: string; maxBytes: number; firma: readonly number[] };

// "%PDF-"
const PDF_FIRMA = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;
// \x89 P N G \r \n \x1a \n
const PNG_FIRMA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const RECIBO: Regla = { mimeType: RECIBO_MIME_TYPE, maxBytes: MAX_RECIBO_BYTES, firma: PDF_FIRMA };
const FIRMA: Regla = { mimeType: FIRMA_MIME_TYPE, maxBytes: MAX_FIRMA_BYTES, firma: PNG_FIRMA };

export function empiezaCon(bytes: Uint8Array, firma: readonly number[]): boolean {
  return bytes.length >= firma.length && firma.every((byte, i) => bytes[i] === byte);
}

// Before the file exists: what the browser declares (type and size), to
// refuse early, before a signed upload URL is created.
function validarDeclarado(regla: Regla, mimeType: unknown, sizeBytes: unknown): ArchivoValidado {
  if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, motivo: "vacio" };
  }
  if (sizeBytes > regla.maxBytes) return { ok: false, motivo: "muy-grande" };
  if (mimeType !== regla.mimeType) return { ok: false, motivo: "tipo" };
  return { ok: true };
}

// The file itself: its size and its first bytes.
function validarContenido(regla: Regla, mimeType: unknown, bytes: Uint8Array): ArchivoValidado {
  const declarado = validarDeclarado(regla, mimeType, bytes.byteLength);
  if (!declarado.ok) return declarado;
  if (!empiezaCon(bytes, regla.firma)) return { ok: false, motivo: "contenido" };
  return { ok: true };
}

export function validarReciboDeclarado(input: { mimeType: unknown; sizeBytes: unknown }): ArchivoValidado {
  return validarDeclarado(RECIBO, input.mimeType, input.sizeBytes);
}

export function validarReciboArchivo(input: { mimeType: unknown; bytes: Uint8Array }): ArchivoValidado {
  return validarContenido(RECIBO, input.mimeType, input.bytes);
}

export function validarFirmaDeclarada(input: { mimeType: unknown; sizeBytes: unknown }): ArchivoValidado {
  return validarDeclarado(FIRMA, input.mimeType, input.sizeBytes);
}

export function validarFirmaImagen(input: { mimeType: unknown; bytes: Uint8Array }): ArchivoValidado {
  return validarContenido(FIRMA, input.mimeType, input.bytes);
}
