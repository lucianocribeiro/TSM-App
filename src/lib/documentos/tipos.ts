import type { Copy } from "@/lib/copy/es-AR";
import type { Database } from "@/lib/supabase/database.types";

// Legajo documents (PRD scope item 6). Codes match the database enum
// public.documento_tipo; labels come from copy.documentos.tipos.

export type DocumentoTipo = Database["public"]["Enums"]["documento_tipo"];

export const DOCUMENTOS_BUCKET = "legajo-docs";

export type DocumentoTipoConfig = {
  tipo: DocumentoTipo;
  required: boolean;
  labelKey: keyof Copy["documentos"]["tipos"];
};

export const DOCUMENTO_TIPOS = [
  { tipo: "dni_frente", required: true, labelKey: "dni_frente" },
  { tipo: "dni_dorso", required: true, labelKey: "dni_dorso" },
  { tipo: "licencia_conducir", required: false, labelKey: "licencia_conducir" },
] as const satisfies readonly DocumentoTipoConfig[];

export const DOCUMENTO_TIPO_CODES: readonly DocumentoTipo[] = DOCUMENTO_TIPOS.map(
  (config) => config.tipo,
);

export function isDocumentoTipo(value: unknown): value is DocumentoTipo {
  return (
    typeof value === "string" &&
    (DOCUMENTO_TIPO_CODES as readonly string[]).includes(value)
  );
}

// Same limit as the bucket and legajo_documentos.size_bytes (10 MB).
export const MAX_DOCUMENTO_BYTES = 10 * 1024 * 1024;

// Allowed MIME types with the extension used in storage paths and the
// extensions accepted on the original file name.
export const DOCUMENTO_MIME_TYPES = {
  "application/pdf": { pathExtension: "pdf", fileExtensions: ["pdf"] },
  "image/jpeg": { pathExtension: "jpg", fileExtensions: ["jpg", "jpeg"] },
  "image/png": { pathExtension: "png", fileExtensions: ["png"] },
} as const;

export type DocumentoMimeType = keyof typeof DOCUMENTO_MIME_TYPES;
export type DocumentoPathExtension =
  (typeof DOCUMENTO_MIME_TYPES)[DocumentoMimeType]["pathExtension"];

export const DOCUMENTO_MIME_LIST = Object.keys(
  DOCUMENTO_MIME_TYPES,
) as DocumentoMimeType[];

export function isDocumentoMimeType(value: unknown): value is DocumentoMimeType {
  return typeof value === "string" && Object.hasOwn(DOCUMENTO_MIME_TYPES, value);
}
